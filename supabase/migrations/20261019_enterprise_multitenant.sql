-- ---------------------------------------------------------------------------
-- LeadFlow AI — enterprise multi-tenant upgrade. Additive and idempotent: safe to
-- re-run, keeps every existing column (the dashboard and webhook depend on them).
-- Run in the Supabase SQL editor after supabase/schema.sql and rate-limit.sql.
--
-- Spec name            -> column used here
--   tenants.name               -> business_name
--   tenants.phone              -> whatsapp_phone
--   tenants.instance_id        -> whatsapp_instance_id
--   tenants.system_instructions-> system_prompt
--   conversations 'human_handled' -> status 'muted_by_human'
--   messages.role              -> sender
--   leads.full_name            -> customer_name
--   leads.requested_treatment  -> service_requested
-- ---------------------------------------------------------------------------

-- Tenants: business hours, price list, FAQ, staff notification targets ---------

alter table public.tenants
  add column if not exists business_hours jsonb
    default '{"days":[0,1,2,3,4],"open":"09:00","close":"19:00","timezone":"Asia/Jerusalem"}'::jsonb,
  add column if not exists price_list jsonb not null default '[]'::jsonb,
  add column if not exists faq jsonb not null default '[]'::jsonb,
  add column if not exists notification_phone text,
  add column if not exists notification_email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_business_hours_object') then
    alter table public.tenants add constraint tenants_business_hours_object
      check (business_hours is null or jsonb_typeof(business_hours) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_price_list_array') then
    alter table public.tenants add constraint tenants_price_list_array
      check (jsonb_typeof(price_list) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_faq_array') then
    alter table public.tenants add constraint tenants_faq_array
      check (jsonb_typeof(faq) = 'array');
  end if;
end $$;

-- Phones: production already has whatsapp_phone / owner_phone NOT NULL; schema.sql
-- installs did not. Normalize to digits-only international format (05XXXXXXXX ->
-- 9725XXXXXXXX, the same rule as normalizePhone in api/_lib/supabase.ts), then add
-- NOT NULL and format checks only when every row conforms; otherwise report and skip,
-- because a check on non-conforming rows would make every later UPDATE of them fail.
update public.tenants t
set whatsapp_phone = n.whatsapp_phone,
    owner_phone = n.owner_phone
from (
  select
    id,
    case
      when whatsapp_phone is null then null
      when regexp_replace(whatsapp_phone, '\D', '', 'g') ~ '^0[0-9]{9}$'
        then '972' || substr(regexp_replace(whatsapp_phone, '\D', '', 'g'), 2)
      else regexp_replace(whatsapp_phone, '\D', '', 'g')
    end as whatsapp_phone,
    case
      when owner_phone is null then null
      when regexp_replace(owner_phone, '\D', '', 'g') ~ '^0[0-9]{9}$'
        then '972' || substr(regexp_replace(owner_phone, '\D', '', 'g'), 2)
      else regexp_replace(owner_phone, '\D', '', 'g')
    end as owner_phone
  from public.tenants
) n
where t.id = n.id
  and (t.whatsapp_phone is distinct from n.whatsapp_phone or t.owner_phone is distinct from n.owner_phone);

do $$
begin
  if exists (select 1 from public.tenants where whatsapp_phone is null or owner_phone is null) then
    raise notice 'Some tenants lack whatsapp_phone/owner_phone; fill them and re-run to add NOT NULL.';
  else
    alter table public.tenants
      alter column whatsapp_phone set not null,
      alter column owner_phone set not null;
  end if;

  if exists (
    select 1 from public.tenants
    where whatsapp_phone !~ '^[0-9]{9,15}$' or owner_phone !~ '^[0-9]{9,15}$'
  ) then
    raise notice 'Some tenant phones are not 9-15 digits; fix them and re-run to add the format checks.';
  else
    if not exists (select 1 from pg_constraint where conname = 'tenants_whatsapp_phone_format') then
      alter table public.tenants add constraint tenants_whatsapp_phone_format
        check (whatsapp_phone ~ '^[0-9]{9,15}$');
    end if;
    if not exists (select 1 from pg_constraint where conname = 'tenants_owner_phone_format') then
      alter table public.tenants add constraint tenants_owner_phone_format
        check (owner_phone ~ '^[0-9]{9,15}$');
    end if;
  end if;
end $$;

-- One tenant per Green API instance, so webhook routing is unambiguous.
do $$
begin
  create unique index if not exists tenants_whatsapp_instance_id_key
    on public.tenants (whatsapp_instance_id) where whatsapp_instance_id is not null;
exception when unique_violation then
  raise notice 'Duplicate whatsapp_instance_id values exist; resolve them and re-run to add the unique index.';
end $$;

-- Conversations: free-form metadata ------------------------------------------

alter table public.conversations
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists conversations_tenant_last_message_idx
  on public.conversations (tenant_id, last_message_at desc);

-- Messages: raw_message_id for idempotency ------------------------------------

alter table public.messages
  add column if not exists raw_message_id text;

-- Backfill from the Green API id kept in raw_payload; only the earliest row per id,
-- so pre-existing duplicates cannot block the unique index below.
update public.messages m
set raw_message_id = d.id_message
from (
  select distinct on (raw_payload->>'idMessage') id, raw_payload->>'idMessage' as id_message
  from public.messages
  where coalesce(raw_payload->>'idMessage', '') <> ''
  order by raw_payload->>'idMessage', created_at
) d
where m.id = d.id
  and m.raw_message_id is null
  and not exists (select 1 from public.messages x where x.raw_message_id = d.id_message);

create unique index if not exists messages_raw_message_id_key
  on public.messages (raw_message_id);

-- Leads: lookups by conversation / phone, one open lead per conversation -------

create index if not exists leads_conversation_id_idx on public.leads (conversation_id);
create index if not exists leads_tenant_phone_idx on public.leads (tenant_id, customer_phone);

do $$
begin
  create unique index if not exists leads_one_open_per_conversation
    on public.leads (conversation_id)
    where conversation_id is not null and status in ('new', 'in_progress');
exception when unique_violation then
  raise notice 'Some conversations have several open leads; merge them and re-run to add the unique index.';
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: tenant membership via auth.uid()
-- The webhook and /api run with the service role (bypasses RLS). Browser clients
-- using the anon key see nothing unless signed in as a member of the tenant.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_members (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id);

alter table public.tenant_members enable row level security;
alter table public.tenants enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;

-- security definer so policies can consult tenant_members without recursing into its RLS.
create or replace function public.is_tenant_member(p_tenant_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

revoke all on function public.is_tenant_member(uuid, text[]) from public, anon;
grant execute on function public.is_tenant_member(uuid, text[]) to authenticated, service_role;

-- The demo-era policies allowed anyone with the anon key to read and write everything.
drop policy if exists "tenants_anon_all" on public.tenants;
drop policy if exists "conversations_anon_all" on public.conversations;
drop policy if exists "messages_anon_all" on public.messages;
drop policy if exists "leads_anon_all" on public.leads;

drop policy if exists "tenant_members_select_own" on public.tenant_members;
create policy "tenant_members_select_own" on public.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "tenants_member_select" on public.tenants;
create policy "tenants_member_select" on public.tenants
  for select to authenticated
  using (public.is_tenant_member(id));

drop policy if exists "tenants_owner_update" on public.tenants;
create policy "tenants_owner_update" on public.tenants
  for update to authenticated
  using (public.is_tenant_member(id, array['owner']))
  with check (public.is_tenant_member(id, array['owner']));

drop policy if exists "conversations_member_select" on public.conversations;
create policy "conversations_member_select" on public.conversations
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists "conversations_member_update" on public.conversations;
create policy "conversations_member_update" on public.conversations
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "messages_member_select" on public.messages;
create policy "messages_member_select" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_tenant_member(c.tenant_id)
    )
  );

drop policy if exists "leads_member_select" on public.leads;
create policy "leads_member_select" on public.leads
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists "leads_member_insert" on public.leads;
create policy "leads_member_insert" on public.leads
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "leads_member_update" on public.leads;
create policy "leads_member_update" on public.leads
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "leads_owner_delete" on public.leads;
create policy "leads_owner_delete" on public.leads
  for delete to authenticated
  using (public.is_tenant_member(tenant_id, array['owner']));

-- ---------------------------------------------------------------------------
-- Seed: Glow Clinic price list (only if none was configured yet)
-- ---------------------------------------------------------------------------

update public.tenants
set price_list = $json$[
  {"service": "בוטוקס לאזורי הבעה (מצח, בין הגבות, צידי עיניים)", "price_from": 800, "unit": "לאזור"},
  {"service": "מילוי ועיצוב שפתיים / הדגשת קו לסת בחומצה היאלורונית", "price_from": 1400, "unit": "למזרק"},
  {"service": "סקין בוסטר וחידוש מרקם העור", "price_from": 1200, "unit": "לטיפול"}
]$json$::jsonb,
  faq = case when faq = '[]'::jsonb then $json$[
  {"question": "האם פגישת הייעוץ בתשלום?", "answer": "פגישת הייעוץ הראשונית עם הרופא/ה ללא עלות."},
  {"question": "מי מבצע את הטיפולים?", "answer": "כל הטיפולים מבוצעים על ידי רופא/ה מוסמך/ת, לאחר פגישת ייעוץ והתאמה אישית."}
]$json$::jsonb else faq end
where whatsapp_instance_id = '710722751571'
  and price_list = '[]'::jsonb;

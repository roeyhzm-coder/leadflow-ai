-- LeadFlow AI — multi-tenant WhatsApp sales & lead capture schema
-- Run this in the Supabase SQL editor (or via CLI) on a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_name text not null,
  whatsapp_instance_id text,
  whatsapp_phone text,
  owner_phone text,
  system_prompt text,
  target_goal text,
  is_active boolean not null default true
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_phone text not null,
  customer_name text,
  status text not null default 'active'
    check (status in ('active', 'muted_by_human', 'closed')),
  muted_until timestamptz,
  last_message_at timestamptz not null default now(),
  unique (tenant_id, customer_phone)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender text not null check (sender in ('customer', 'bot', 'human')),
  message_type text not null default 'text' check (message_type in ('text', 'audio')),
  content text not null default '',
  raw_payload jsonb
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  customer_name text,
  customer_phone text,
  service_requested text,
  preferred_time text,
  notes text,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'converted', 'dismissed'))
);

create index if not exists conversations_tenant_id_idx on public.conversations (tenant_id);
create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id, created_at);
create index if not exists leads_tenant_id_idx on public.leads (tenant_id, created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists tenants_whatsapp_instance_id_idx on public.tenants (whatsapp_instance_id);
create index if not exists tenants_whatsapp_phone_idx on public.tenants (whatsapp_phone);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Dashboard traffic goes through /api with the service role (bypasses RLS).
-- Anon policies below are intentionally open for a first demo; lock them down
-- with auth.uid() tenant membership before going to production.
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;

drop policy if exists "tenants_anon_all" on public.tenants;
drop policy if exists "conversations_anon_all" on public.conversations;
drop policy if exists "messages_anon_all" on public.messages;
drop policy if exists "leads_anon_all" on public.leads;

create policy "tenants_anon_all" on public.tenants for all using (true) with check (true);
create policy "conversations_anon_all" on public.conversations for all using (true) with check (true);
create policy "messages_anon_all" on public.messages for all using (true) with check (true);
create policy "leads_anon_all" on public.leads for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Seed — שקד אינסטלציה ושיפוצים (demo tenant)
-- ---------------------------------------------------------------------------

insert into public.tenants (
  id,
  business_name,
  whatsapp_instance_id,
  whatsapp_phone,
  owner_phone,
  system_prompt,
  target_goal,
  is_active
) values (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'שקד אינסטלציה ושיפוצים',
  '1101234567',
  '972501112222',
  '972509998887',
  $prompt$אתה נציג מכירות ומזכיר של "שקד אינסטלציה ושיפוצים" — עסק משפחתי לאינסטלציה, נזילות, התקנת כלים סניטריים ושיפוצי חדרי רחצה ומטבח באזור המרכז.

סגנון:
- ענה תמיד בעברית טבעית, חמה ומקצועית. משפטים קצרים. בלי אימוג'ים מוגזמים.
- אתה לא רובוט משעמם: תהיה אנושי, ישיר, ותשמור על טון של בעל מקצוע אמין.
- אל תמציא מחירים מדויקים. אפשר לתת טווח כללי ולקבוע ביקור.

מטרה:
לאסוף ליד מוסמך: שם מלא, טלפון לחזרה, סוג השירות, מועד מועדף, ופרטים רלוונטיים (כתובת/עיר, דחיפות, דירה/בית).

תהליך שיחה:
1. ברך לפי השעה והבן במה אפשר לעזור.
2. שאל שאלות הבהרה (מה קרה, מתי התחיל, האם יש מים / חשמל / גישה).
3. אסוף שם, טלפון, אזור/עיר, וחלון זמן לביקור.
4. כשיש מספיק מידע — אשר בקצרה שבעל המקצוע יחזור עם שעה מדויקת.

אם הלקוח מבקש נציג אנושי, נציג, בנאדם או שיחה עם אדם — הפסק למכור, תאשר שהפניה הועברה, ואל תמשיך לשאול שאלות הסמכה.

כשליד הושלם (שם + שירות + דרך חזרה), סמן lead_captured=true עם כל השדות.$prompt$,
  'קביעת ביקור טכנאי / הצעת מחיר לשיפוץ',
  true
) on conflict (id) do update set
  business_name = excluded.business_name,
  system_prompt = excluded.system_prompt,
  target_goal = excluded.target_goal,
  is_active = true;

insert into public.conversations (
  id, tenant_id, customer_phone, customer_name, status, last_message_at
) values
  (
    'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    '972501234567',
    'דוד לוי',
    'active',
    now() - interval '2 hours'
  ),
  (
    'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    '972502345678',
    'מיכל כהן',
    'active',
    now() - interval '1 day'
  ),
  (
    'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    '972503456789',
    'אבי מזרחי',
    'muted_by_human',
    now() - interval '3 days'
  ),
  (
    'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    '972504567890',
    'נועה שפירא',
    'closed',
    now() - interval '8 days'
  )
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, sender, message_type, content, created_at) values
  ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'שלום, יש לי נזילה מהכיור במטבח, מטפטף כבר יומיים', now() - interval '2 hours 20 minutes'),
  ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'היי, כאן שקד אינסטלציה 🔧 סליחה על הבלאגן. הנזילה מהברז, מהסיפון מתחת לכיור, או מהקיר? ובאיזו עיר אתם?', now() - interval '2 hours 18 minutes'),
  ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'מהסיפון, ברמת גן. אני דוד לוי, אפשר מחר אחרי 16:00', now() - interval '2 hours 10 minutes'),
  ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'מעולה דוד. רשמתי ביקור מחר אחרי 16:00 ברמת גן — נזילת סיפון במטבח. הטכנאי יחזור אליכם עם שעה מדויקת. מספר לחזרה הוא המספר הזה, נכון?', now() - interval '2 hours 8 minutes'),
  ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'כן, 050-123-4567 תודה', now() - interval '2 hours'),

  ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'היי, אנחנו רוצים לשפץ את חדר הרחצה בבית בהרצליה', now() - interval '1 day 3 hours'),
  ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'שלום! שיפוץ חדר רחצה זה בדיוק התחום שלנו. זה החלפת כלים סניטריים בלבד, או גם ריצוף/חיפוי? כמה בערך מ״ר החדר?', now() - interval '1 day 2 hours 50 minutes'),
  ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'audio', '[הודעה קולית] חדר של בערך 6 מטר, רוצים גם מקלחון חדש וארון. אני מיכל, אפשר ביום ראשון בבוקר', now() - interval '1 day 2 hours'),
  ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a04', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'קיבלתי מיכל. ביקור מדידה ביום ראשון בבוקר בהרצליה — שיפוץ חדר רחצה ~6 מ״ר כולל מקלחון וארון. נחזור עם חלון שעות.', now() - interval '1 day 1 hour 50 minutes'),

  ('c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'יש סתימה קשה בשירותים, מים עולים. צריך מישהו היום', now() - interval '3 days 4 hours'),
  ('c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'הבנתי, זה דחוף. באיזו עיר, ומה מספר לחזרה? ננסה לשבץ טכנאי היום.', now() - interval '3 days 3 hours 55 minutes'),
  ('c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'פתח תקווה, אבי מזרחי. תעביר אותי לנציג בבקשה', now() - interval '3 days 3 hours 40 minutes'),
  ('c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a04', 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'כמובן. מעביר את השיחה לנציג אנושי עכשיו — יחזרו אליכם בהקדם.', now() - interval '3 days 3 hours 39 minutes'),
  ('c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a05', 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'human', 'text', 'אבי שלום, כאן שקד. אני בדרך, אגיע תוך שעה.', now() - interval '3 days 3 hours'),

  ('c4eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'צריכים החלפת דוד שמש ברחובות', now() - interval '8 days 5 hours'),
  ('c4eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'שמחים לעזור עם דוד שמש. זה דוד קיים להחלפה או התקנה חדשה? באיזו קומה, ויש גישה לגג?', now() - interval '8 days 4 hours 50 minutes'),
  ('c4eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'customer', 'text', 'החלפה, קומה 3 עם גג משותף. נועה שפירא, עדיף באמצע השבוע בבוקר', now() - interval '8 days 4 hours'),
  ('c4eebc99-9c0b-4ef8-bb6d-6bb9bd380a04', 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'bot', 'text', 'רשום. תיאום החלפת דוד שמש ברחובות, אמצע שבוע בבוקר. נחזור לאישור סופי.', now() - interval '8 days 3 hours 50 minutes')
on conflict (id) do nothing;

insert into public.leads (
  id, tenant_id, conversation_id, customer_name, customer_phone,
  service_requested, preferred_time, notes, status, created_at
) values
  (
    'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'דוד לוי',
    '972501234567',
    'תיקון נזילת סיפון במטבח',
    'מחר אחרי 16:00',
    'רמת גן. נזילה מהסיפון כבר יומיים. טלפון לחזרה 050-123-4567.',
    'new',
    now() - interval '2 hours'
  ),
  (
    'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'מיכל כהן',
    '972502345678',
    'שיפוץ חדר רחצה כולל מקלחון וארון',
    'יום ראשון בבוקר',
    'הרצליה. חדר כ-6 מ״ר. הודעה קולית.',
    'in_progress',
    now() - interval '1 day'
  ),
  (
    'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'אבי מזרחי',
    '972503456789',
    'פתיחת סתימה דחופה בשירותים',
    'היום, בהקדם',
    'פתח תקווה. הלקוח ביקש נציג אנושי. הועבר לטיפול ידני.',
    'in_progress',
    now() - interval '3 days'
  ),
  (
    'd4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'נועה שפירא',
    '972504567890',
    'החלפת דוד שמש',
    'אמצע השבוע בבוקר',
    'רחובות, קומה 3, גג משותף. העבודה בוצעה.',
    'converted',
    now() - interval '8 days'
  ),
  (
    'd5eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    null,
    'רון אלבז',
    '972505678901',
    'התקנת ברז מטבח',
    'לא צוין',
    'פנה דרך האתר הישן. אין היסטוריית וואטסאפ.',
    'dismissed',
    now() - interval '12 days'
  )
on conflict (id) do nothing;

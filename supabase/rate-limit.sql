-- ---------------------------------------------------------------------------
-- Paid-API rate limiter (Gemini / WhatsApp). Idempotent — safe to re-run.
-- Run in the Supabase SQL editor BEFORE deploying the API that calls it:
-- api/_lib/rate-limit.ts fails closed (HTTP 503, no paid call) if it is missing.
-- ---------------------------------------------------------------------------

create table if not exists public.api_rate_limits (
  bucket_key    text        not null,
  window_start  timestamptz not null,
  request_count integer     not null default 0,
  primary key (bucket_key, window_start)
);

alter table public.api_rate_limits enable row level security;
-- Intentionally no policies: anon/authenticated get nothing; only service_role touches it.

create or replace function public.check_rate_limit(
  p_key            text,
  p_limit          integer default 5,
  p_window_seconds integer default 60
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.api_rate_limits as r (bucket_key, window_start, request_count)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = r.request_count + 1
  returning r.request_count into v_count;

  -- Opportunistic cleanup (~1% of calls) keeps the table small without a cron job.
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '1 hour';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

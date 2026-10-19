# LeadFlow AI

Multi-tenant WhatsApp AI sales and lead capture dashboard. React + Vite frontend, Vercel serverless API, Supabase, and Gemini.

## Setup

1. Copy `.env.example` to `.env` and fill in keys.
2. In the Supabase SQL editor run, in order: `supabase/schema.sql`, `supabase/rate-limit.sql`, `supabase/migrations/20261019_enterprise_multitenant.sql` (all idempotent). Until the rate limiter exists the webhook falls back to a weaker per-instance in-memory limit; until the migration runs, night mode and the strict price list are off and idempotency relies on `raw_payload`.
3. Point your Green API webhook to `https://<your-domain>/api/webhook`.
4. `npm install` then `npm run dev` for the dashboard, or deploy to Vercel.

The dashboard works with local demo data if environment variables are not configured yet.

## Bot pipeline (`api/webhook.ts`)

Per incoming message: tenant routing (Green API `instanceId`, then recipient phone) → idempotency (`messages.raw_message_id`, unique) → human-takeover mute (a staff reply from the clinic device mutes the bot for 24h) → rate limit (5/min per customer, 60/min per tenant, HTTP 429 + `Retry-After`) → prompt-injection pre-filter → human-handoff request → business hours (first off-hours message gets the night greeting; follow-ups run the AI in after-hours mode) → Gemini (`temperature 0.2`, `maxOutputTokens 250`, last 8 messages) → output guard (unlisted prices, prompt/secret leaks) → lead upsert (one open lead per conversation, fields merged across turns, staff notified once when name + treatment + time are known). If Gemini fails, the customer gets "הודעתך התקבלה, נציג יחזור אליך בהקדם" and staff are alerted.

Tenant config lives in `tenants.business_hours`, `price_list`, `faq`, `notification_phone` (editable via `PATCH /api/tenants`).

## Tests

- `npm test` runs offline and deterministic (stubbed Gemini, in-memory store, no paid calls).
- `npm run test:live` also hits real Gemini and Supabase (paid; the lead test creates and deletes a throwaway inactive tenant).

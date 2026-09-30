# LeadFlow AI

Multi-tenant WhatsApp AI sales and lead capture dashboard. React + Vite frontend, Vercel serverless API, Supabase, and Gemini.

## Setup

1. Copy `.env.example` to `.env` and fill in keys.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Point your Green API webhook to `https://<your-domain>/api/webhook`.
4. `npm install` then `npm run dev` for the dashboard, or deploy to Vercel.

The dashboard works with local demo data if environment variables are not configured yet.

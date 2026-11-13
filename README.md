# Usual & Unusual

Usual & Unusual is a campus marketplace built with Next.js Pages Router and
Supabase. The active application target is the single canonical Supabase
project, `uqhyjpjiznpgomuizfqe`; archived Staging and B32 launchers are not
valid fallbacks for the unified app.

## Local development

1. Use Node 24 and install locked dependencies with `npm ci`.
2. Copy `.env.uu.example` to ignored `.env.uu.local`.
3. Populate `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the canonical project's
   `sb_publishable_...` key and `SUPABASE_SECRET_KEY` with its server-only
   `sb_secret_...` key from an approved secret manager. Do not copy old
   credentials or use a legacy JWT-based service-role key.
4. Run `npm run dev:v1:uu` and open `http://localhost:3000`.

The launcher verifies the exact project URL and opaque key formats, clears inherited
payment variables, rejects live Stripe keys, and forces Payment, Refund,
Transfer, Payout, Places, and worker execution flags off.

## System boundaries

- Supabase Auth owns account confirmation and OTP validity. The Confirm signup
  template must render `{{ .Token }}`, not a confirmation URL.
- The browser receives only the Supabase publishable key. The Supabase secret,
  Stripe, Resend, webhook, and worker secrets are server-only.
- Stripe stays Test-mode-only and disabled by default. The UI never invents a
  paid order; webhook and database state remain authoritative.
- Notification email is a separately deployed worker. No worker, cron, SMTP,
  or notification sender is enabled by this setup.

See [architecture](docs/architecture.md), [deployment](docs/deployment.md),
and module documents under `docs/`. Historical acceptance reports remain for
audit context and are not current deployment instructions.

## Current unified-runtime status

The local runtime has passed anonymous public/read isolation smoke checks and
a server-only Node Supabase RPC check against the canonical project. No real
Buyer/Seller account, hosted Auth OTP, listing, conversation, order, email, or
payment has been created in this environment. Those flows remain E2E pending.

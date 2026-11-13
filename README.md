# Usual & Unusual

Usual & Unusual is a campus marketplace built with Next.js Pages Router and
Supabase. The active application target is the single canonical Supabase
project, `uqhyjpjiznpgomuizfqe`; archived Staging and B32 launchers are not
valid fallbacks for the unified app.

## Local development

1. Use Node 24 and install locked dependencies with `npm ci`.
2. Copy `.env.uu.example` to ignored `.env.uu.local`.
3. Populate only the canonical project’s public key and server-only service
   role key from an approved secret manager. Do not copy old credentials.
4. Run `npm run dev:v1:uu` and open `http://localhost:3000`.

The launcher verifies the exact project URL and JWT claims, clears inherited
payment variables, rejects live Stripe keys, and forces Payment, Refund,
Transfer, Payout, Places, and worker execution flags off.

## System boundaries

- Supabase Auth owns account confirmation and OTP validity. The Confirm signup
  template must render `{{ .Token }}`, not a confirmation URL.
- The browser receives only the Supabase publishable/anon key. Service-role,
  Stripe, Resend, webhook, and worker secrets are server-only.
- Stripe stays Test-mode-only and disabled by default. The UI never invents a
  paid order; webhook and database state remain authoritative.
- Notification email is a separately deployed worker. No worker, cron, SMTP,
  or notification sender is enabled by this setup.

See [architecture](docs/architecture.md), [deployment](docs/deployment.md),
and module documents under `docs/`. Historical acceptance reports remain for
audit context and are not current deployment instructions.

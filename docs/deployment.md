# Unified UU deployment checklist

## Environment

Use `.env.uu.example` only as a variable-name template. The real
`.env.uu.local` is ignored. `npm run dev:v1:uu` accepts only
`uqhyjpjiznpgomuizfqe` and refuses live Stripe keys or enabled money flags.
Use `NEXT_PUBLIC_SUPABASE_ANON_KEY` only for the project's
`sb_publishable_...` key and `SUPABASE_SECRET_KEY` only for the matching
server-side `sb_secret_...` key. The secret key is opaque rather than a JWT;
the server binds it to the exact canonical URL instead of decoding it. Legacy
API keys are disabled and are not a runtime fallback.

For hosting, configure equivalent secrets in the deployment provider; never in
Git. Set Auth site and redirect URLs to the exact hosted origin before email.

## Phase 4B local smoke status

On 2026-11-13, the unified local runtime passed homepage, anonymous Auth
session, public Listing/Shop, and anonymous private-route denial checks. A
server-side Node `@supabase/supabase-js` call using the opaque secret completed
an existing read-only service RPC successfully. A raw command-line request may
receive 401 because Supabase deliberately rejects secret keys in browser-like
contexts; validate server secrets through a Node server client instead.

These are runtime smoke results, not Buyer/Seller E2E. Hosted Auth email/OTP,
SMTP/Resend delivery, authenticated RLS participant paths, Realtime sessions,
notification delivery, and all transaction flows remain pending explicit
manual-account testing.

## Auth and email

Keep Email Confirmations enabled. The Supabase **Confirm signup** template must
display `{{ .Token }}` because the application verifies an email OTP with
`verifyOtp({ type: 'email' })`. Password recovery uses its own template and
verification type. Never use an Admin confirmation bypass.

Published Resend aliases are retained: `uu-account-verification-v1`,
`uu-password-reset-v1`, `uu-uwo-email-verification-v1`, and
`uu-order-notification-v1`. Do not recreate them. A verified sender domain,
SMTP choice, and notification worker secrets remain manual prerequisites.

## Deferred activation

Do not configure notification cron, worker URL, Stripe webhooks, or Stripe
execution flags in initial deployment. Before enabling one, run its focused
authorization, idempotency, and negative-path regression tests.

Google Places is also intentionally disabled at bootstrap. The Meeting flow
continues to accept manual location text when `GOOGLE_PLACES_API_KEY` is unset.
If it is enabled later, add a server-only, Google-restricted key to the ignored
runtime environment, retain the Canada/Western-London request bounds, and run
the focused Places regression; never expose that key to the browser.

## Deferred email activation

The checked-in `send-email` and `uwo-email` Edge Functions are implemented but
not deployed. Keep Auth's Send Email Hook disabled until both functions are
deployed and their protected secrets are set. The test sender
`onboarding@resend.dev` is restricted to the Resend account-authorized
recipient; a verified sender domain is required before sending real Seller or
Buyer mail. Notification Worker and Cron remain disabled.

## Verification order

1. Run TypeScript, targeted lint, the canonical environment guard test, and a
   production build.
2. Check canonical migration history; never reset the project.
3. Configure Auth and the public browser key.
4. Perform manual account, listing, conversation, and order tests.
5. Separately authorize Test-mode Stripe and worker integration tests.

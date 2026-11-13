# Unified UU deployment checklist

## Environment

Use `.env.uu.example` only as a variable-name template. The real
`.env.uu.local` is ignored. `npm run dev:v1:uu` accepts only
`uqhyjpjiznpgomuizfqe` and refuses live Stripe keys or enabled money flags.

For hosting, configure equivalent secrets in the deployment provider; never in
Git. Set Auth site and redirect URLs to the exact hosted origin before email.

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

## Verification order

1. Run TypeScript, targeted lint, the canonical environment guard test, and a
   production build.
2. Check canonical migration history; never reset the project.
3. Configure Auth and the public browser key.
4. Perform manual account, listing, conversation, and order tests.
5. Separately authorize Test-mode Stripe and worker integration tests.

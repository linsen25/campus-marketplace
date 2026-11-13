# Authentication and UWO verification

Signup sends Supabase’s confirmation email and records a pending username only
until email ownership is proven. The UI, API, and Send Email Hook accept only a
decimal 6–10 digit Supabase OTP; the project’s configured length remains
authoritative. The API uses `verifyOtp` with `type: 'email'`; a confirmed session is then required
before marketplace access. Resend invalidates older provider OTPs according to
Supabase Auth rules.

The browser is configured only with Supabase's opaque `sb_publishable` key.
Server-side recovery and UWO verification require the matching opaque
`sb_secret` key; neither key is parsed as a JWT by application code.

## Auth email hook

`supabase/functions/send-email` verifies Supabase's
Standard Webhooks signature before mapping `signup` to the published account
OTP template and `recovery` to the published reset-link template. Email-change
and unsupported actions fail closed pending separately reviewed dual-recipient
templates. It requires Edge Function secrets `RESEND_API_KEY`,
`SEND_EMAIL_HOOK_SECRET`, and `AUTH_EMAIL_FROM`; no secret belongs in Next.js
or Git. It emits only fixed, non-sensitive validation codes for malformed signed
payloads and never records an email address, OTP, token hash, or secret.

UWO uses the separate `uwo-email` Edge Function and its own shared webhook
secret. It retains the existing HMAC, ten-minute expiry, rate limit and unique
binding database flow; it is not an Auth Hook.

Any confirmed email can use the marketplace. UWO identity is separate: a
private server-managed verification record derives only an approved public
boolean badge. The UWO address itself is not included in public projections.

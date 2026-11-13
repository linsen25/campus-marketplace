# Authentication and UWO verification

Signup sends Supabase’s confirmation email and records a pending username only
until email ownership is proven. The UI accepts the six-digit OTP and the API
uses `verifyOtp` with `type: 'email'`; a confirmed session is then required
before marketplace access. Resend invalidates older provider OTPs according to
Supabase Auth rules.

Any confirmed email can use the marketplace. UWO identity is separate: a
private server-managed verification record derives only an approved public
boolean badge. The UWO address itself is not included in public projections.

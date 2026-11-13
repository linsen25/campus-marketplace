# Payments and financial safety

Settings contains the shared buyer payment-method and seller onboarding
surfaces; orders use only configured payment information. PaymentIntent, signed
webhook, binding reconciliation, B31 protection, refund, and settlement code
remain present but disabled in the unified launcher.

No `.env.uu.example` value enables Provider, Payment, Refund, Transfer, or
Payout execution. Before Test-mode activation, configure separate server-only
Stripe/webhook secrets, verify canonical project binding, run focused
idempotency/authorization tests, and obtain explicit approval. Live keys are
rejected locally.

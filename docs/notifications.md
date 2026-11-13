# Notifications

Database notification events and preferences are part of the canonical schema.
Delivery is intentionally dormant: no edge function, worker URL, scheduler,
SMTP setting, or notification secret is configured in this phase.

The source worker is target-locked to the canonical project, verifies a worker
credential or database authorization, accepts no caller-selected content, and
uses idempotency keys for Resend. Deployment and scheduling require separate
authorization and an end-to-end delivery test.

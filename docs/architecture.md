# Architecture

## Runtime

The Next.js Pages Router application renders UI V1 and exposes same-origin API
routes. Browser components call those routes; the routes create request-scoped
Supabase clients from HTTP-only cookies. Browser Realtime uses a short-lived
application-issued session and never receives a service-role credential.

`lib/marketplace-test-environment.ts` defines the canonical UU project and the
`configuredUuProjectRef` guard. Server capabilities require `APP_ENV=uu`, the
exact canonical URL, and a matching key claim. A missing or mismatched
configuration fails closed rather than selecting a legacy project.

## Data boundary

The canonical release contains 120 migrations. Public tables use RLS; private
operational tables are not client grants and are reached only through reviewed
RPCs. SECURITY DEFINER RPCs use fixed search paths and perform actor,
participant, and state checks. Storage buckets and Realtime policies are part
of the same migration chain.

## External systems

- **Supabase Auth:** signup, confirmation OTP, and session cookies.
- **Resend:** notification delivery only after a separately configured worker.
  Auth mail is configured in Supabase, not through the notification templates.
- **Stripe:** Settings setup and order payment surfaces share the existing
  backend. Execution, refunds, transfers, payouts, webhooks, and worker remain
  disabled until separately approved.

## Lifecycle

Listings create conversations; participants negotiate offers and form orders.
Order/RPC state is authoritative for agreement, fulfillment, Direct and
Interac. For Stripe flows, a PaymentIntent plus signed webhook produces payment
state, while B31 protection remains distinct from completion and settlement.

# Business V1 B28 — Worker Scheduling & Runtime Reliability

Status (2026-10-23): **B28 LOCAL DEVELOPMENT COMPLETE (A/B) — REMOTE RUNTIME ACCEPTANCE DEFERRED TO B30**.

This document inventories the current worktree. It does not prove that a hosted
schedule, webhook endpoint, Vault secret or provider subscription is installed.
No remote environment was inspected or changed during B28-A.

## Worker inventory

| Work                                     | Trigger / runtime                                                                                                         | Authentication and gate                                                                                                   | Bound, lease and retry                                                                                                                                                                                                                                                                                   | Provider / deployment status                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Transaction due work                     | Supabase `pg_cron`, `marketplace-v2-transaction-due-work`, every minute; `marketplace_private.run_transaction_due_work()` | Private `SECURITY DEFINER`, empty `search_path`; no client EXECUTE                                                        | Transaction advisory lock prevents overlap. B28 migration bounds Offer expiry, held-Order settlement and reminders independently to 50 per invocation. Existing row locks, event source keys and domain idempotency remain authoritative.                                                                | No provider. Existing schedule is documented; B28 migration is local only and requires B30 deployment/verification.                  |
| Notification email                       | Supabase `pg_cron`, `marketplace-notification-email`, every minute, calling the Supabase Edge Function                    | Vault bearer or service-role authentication; exact Staging URL; browser cannot choose recipient, subject, HTML or content | Edge batch 3; database claim/lease and frozen envelope; stable provider idempotency key; 429/5xx/timeout retry; unsafe or exhausted delivery stops. Provider timeout 10 seconds.                                                                                                                         | Calls Resend only when configured. No real email was sent. Hosted secret, schedule and delivery are **NOT VERIFIED / B30 REQUIRED**. |
| Notification inbox retention             | Supabase `pg_cron`, hourly at minute 15                                                                                   | Private function; service-role only                                                                                       | `FOR UPDATE SKIP LOCKED`; default 1,000 and hard maximum 10,000 per invocation; 90-day API/RLS visibility boundary applies immediately                                                                                                                                                                   | No provider. Hosted execution is **NOT VERIFIED / B30 REQUIRED**.                                                                    |
| Stripe webhook intake                    | Provider POST to `/api/stripe/webhook`, `/connect-webhook`, `/account-webhook`                                            | Three independent signing secrets; raw signed body; channel/account/test-mode validation                                  | 256 KiB body cap, 2,048-character signature cap; durable deduplicated inbox before HTTP 200. Failure to persist returns non-2xx. Events are hints; consumers reread Stripe objects.                                                                                                                      | Provider-triggered, not cron. Endpoint/subscription delivery is **NOT VERIFIED / B30 REQUIRED**.                                     |
| Stripe financial worker                  | Authenticated POST `/api/stripe/worker` in the Next.js server runtime                                                     | Constant-time bearer comparison; secret length >=32; POST only; no-store                                                  | Route passes batch 2 to recovery. Six families are individually bounded and fenced by their existing leases/tokens. Partial failure returns HTTP 503 while preserving successful step results. Status distinguishes disabled, idle, completed, needs-attention, busy and degraded/configuration failure. | No `vercel.json` or other repository schedule exists. Hosted schedule and duration are **NOT CONFIGURED / B30 REQUIRED**.            |
| Setup / Connect inbox                    | Stripe worker step                                                                                                        | `STRIPE_PROVIDER_ENABLED`; Staging/test-mode Stripe guard                                                                 | Maximum 20 per direct call, batch 2 from scheduled route; inbox claim, lease and provider reread                                                                                                                                                                                                         | May call Stripe when enabled. Disabled now claims no work.                                                                           |
| Order Payment reconciliation             | Stripe worker step                                                                                                        | `STRIPE_ORDER_PAYMENTS_ENABLED`; service-role RPC and frozen B21/B22 binding                                              | Maximum 20 per direct call, batch 2 from route; durable event/due leases and unknown-outcome recovery                                                                                                                                                                                                    | May read Stripe when enabled; create authority remains separately gated. Disabled now claims no work.                                |
| Refund execution/reconciliation          | Stripe worker step                                                                                                        | `STRIPE_ORDER_REFUNDS_ENABLED`; B23 authorization and current fenced lease                                                | Maximum 10 per internal phase, batch 2 from route; same operation/idempotency key; reconcile never creates                                                                                                                                                                                               | May call Stripe in Test Mode only when enabled. Default off.                                                                         |
| Seller Transfer execution/reconciliation | Stripe worker step                                                                                                        | `STRIPE_ORDER_TRANSFERS_ENABLED` plus separate create approval; B24 authorization                                         | Maximum 10, batch 2 from route; provider evidence and fenced lease; reconcile cannot create                                                                                                                                                                                                              | May call Stripe only with both approved gates. Defaults off.                                                                         |
| Connected Payout observation             | Stripe worker step                                                                                                        | `STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED`; connected-account event scope                                              | Maximum 20, batch 2 from route; read-only provider reconciliation and fenced event lease                                                                                                                                                                                                                 | Read-only Stripe observation; no payout create/cancel path. Default off.                                                             |
| Stripe Dispute observation               | Stripe worker step                                                                                                        | `STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED`; platform event scope                                                          | Maximum 20, batch 2 from route; provider reread, event dedupe and fenced lease                                                                                                                                                                                                                           | Read-only Stripe observation; no dispute action. Default off.                                                                        |
| Operational recovery/case sweep          | Wraps the six Stripe worker steps                                                                                         | `STRIPE_OPERATIONAL_RECOVERY_ENABLED`; service-role only                                                                  | Optional global run lease, append-only run audit, bounded case sweep and stale-token rejection. Each family remains isolated and reports its own result.                                                                                                                                                 | Does not grant any provider mutation authority. Default off.                                                                         |
| Shop suspension lifecycle                | Runs independently beside financial recovery in `/api/stripe/worker`                                                      | `SHOP_SUSPENSION_LIFECYCLE_ENABLED`; service-role-only RPC                                                                | RPC limit 20, singleton cursor lease plus per-Shop advisory lock and stable cycle identities; missed cycles are recoverable                                                                                                                                                                              | No provider. Default off; no hosted schedule installed.                                                                              |
| Hosted order-media cleanup               | Existing `sweepOrderSnapshotMedia` helper and database cleanup lease                                                      | Server/service-role and Staging guards                                                                                    | Candidate bounds, delete lease/reclaim, bind/delete exclusion and idempotent finish already exist                                                                                                                                                                                                        | No hosted entry point or schedule. Remains the accepted external/operations backlog item.                                            |
| Realtime notification refresh            | PostgreSQL broadcast after durable notification/message changes                                                           | Per-user private topic and authenticated session                                                                          | Signal only. The client refetches durable rows; reconnect/logout cleanup prevents stale-account reuse                                                                                                                                                                                                    | Not a worker and not a source of truth. Temporary broadcast failure cannot erase persisted Inbox/message facts.                      |

## B28-A corrections

1. `20261023190043_worker_runtime_reliability.sql` replaces only the existing
   transaction due-work function. It preserves every expiry, settlement,
   Protection, reminder, authorization and idempotency rule while placing an
   independent 50-row selection bound on each of its three scans. The Order scan
   now selects only delivery/meetup/Protection records whose authoritative deadline
   is due, so future Orders cannot occupy the batch and starve later due work. The
   advisory overlap guard and original private ACL remain unchanged.
2. Disabled Setup/Connect and Order Payment families now return before obtaining
   Stripe configuration or claiming database work. Other B23–B25 families already
   had equivalent default-off gates.
3. The Stripe HTTP worker now rejects wrong methods with 405, rejects absent or
   invalid credentials with 401, reports `no-store`, and executes financial and
   Shop-lifecycle coordinators with failure isolation.
4. A failed family or coordinator produces a degraded result and HTTP 503. A
   successful independent family remains visible in the response. Empty,
   disabled, busy, completed, needs-attention, configuration-missing and
   retryable-failure outcomes are no longer collapsed into a generic success.
5. `.env.sample` documents all financial, observation, recovery, Shop admission
   and lifecycle gates as disabled. It contains no credential value.

## Reliability boundaries

- Webhooks acknowledge only after durable inbox persistence. Duplicate or
  out-of-order delivery does not directly change financial state.
- Provider 429, 5xx, timeout and unknown acknowledgements retain the existing
  operation identity. Reconciliation must look up the provider object before any
  possible retry; it cannot invent a new payment, refund or transfer.
- Database claims use bounded batches, leases and fencing tokens. Expired work is
  recoverable and old tokens cannot overwrite a newer worker result.
- Payment, Refund, Transfer, Payout and Dispute facts remain separate. Payout
  failure does not rewrite Transfer success, and Dispute status does not release
  Protection.
- Email OFF does not suppress durable in-app notifications. B27 event types remain
  Inbox-only. Realtime remains an invalidation signal.
- Worker responses expose stable classifications and sanitized error codes only;
  they do not return provider secrets, raw objects, email addresses or messages.

## Scheduling contract and open runtime limits

- Keep database-local due work and retention in Supabase. Do not move all tasks to
  Vercel cron.
- If authorized later, invoke `/api/stripe/worker` about once per minute with one
  controlled caller and the dedicated bearer. Duplicate invocations are safe by
  leases, but they waste provider/database capacity.
- Enable Shop suspension processing only after its migration and admission policy
  are accepted. A one-to-five-minute trigger is sufficient; the RPC remains
  bounded at 20 Shops.
- The hosted platform's actual function timeout and concurrency policy are absent
  from this repository. The current route deliberately uses batch 2, but a Stripe
  SDK call can still consume its configured timeout. B30 must prove the chosen
  hosting duration handles enabled families, or split invocations by an approved
  server-controlled family selector without exposing browser authority.
- Media cleanup needs a separate authenticated hosted executor, schedule,
  monitoring and deletion-budget decision. It is not silently added in B28-A.

## B28-B implemented observability

`20261023224905_worker_observability.sql` adds one private, service-role-only
runtime receipt. It records the Stripe coordinator and Email worker without
duplicating their domain queues. A run has a unique identity, stage, enabled bit,
fenced ten-minute lease, explicit terminal result, bounded counts, safe error
classifications and a small projected phase result. Terminal receipts are
immutable. A concurrent invocation produces its own terminal `busy` receipt; an
expired running receipt becomes `interrupted`, so a crash cannot appear successful.

`marketplace_worker_observability(..., 'summary', ...)` is read-only and returns
latest run/duration/last success; capped due counts and oldest-due times; stale
leases and attention counts for Stripe inbox purposes, Payment, Refund, Transfer,
Email, operational cases and media cleanup; the Shop lifecycle cursor; and actual
pg_cron receipts. It derives deterministic anomaly keys for stale workers,
consecutive failure, old work, stale leases, manual review and missing schedules.

Thresholds are caller-supplied within strict bounds for qualification. They are
not production SLAs. The RPC sends no alert and performs no recovery or money
movement. Alert recipients, channels, repeat policy and retention remain policy
decisions for B30. Payout and Dispute pending work remains separated by the
existing Stripe inbox `purpose` values.

The Stripe route persists completed, idle, disabled, busy, degraded and failed
outcomes. A 503 stores sanitized partial-success facts before responding. The
Email Edge worker uses the same audit boundary. The database Email scheduler
wrapper now raises on non-2xx Edge responses instead of allowing pg_cron to record
a false success. Provider acceptance remains distinct from final delivery.

See [B28 operations runbook](BUSINESS-V1-B28-OPERATIONS-RUNBOOK.md).

## B30 required acceptance

Verify the explicit Staging project and applied migration hashes; install and
inspect only separately approved schedules; confirm webhook endpoint/channel
secrets in Stripe Test Mode; exercise duplicate, delayed and out-of-order events;
test provider 429/5xx/timeout and process termination; verify lease recovery and
old-token rejection; measure route duration under enabled families; confirm email
preference/idempotency with an approved test recipient; test Shop suspension cycle
recovery; verify Realtime reconnect/account-switch behavior; and qualify the hosted
media-cleanup executor if it is brought into scope. Real provider actions and any
feature activation require their own approval.

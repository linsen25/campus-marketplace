# Business V1 B28 — Worker Operations Runbook

Status: **LOCAL CONTRACT ONLY — HOSTED CONFIGURATION NOT VERIFIED**.

This runbook describes code in the current worktree. It contains no secret,
provider payload or command that authorizes a financial operation.

## 1. Worker inventory and deployment boundary

- Supabase pg_cron owns transaction due work, Email invocation and notification
  inbox retention.
- Authenticated `/api/stripe/worker` coordinates Setup, Payment, Refund, Transfer,
  Payout observation, Dispute observation, recovery and Shop lifecycle families.
- The Email Edge Function claims the existing outbox. Realtime is only a refresh
  signal. Media cleanup has leases but no approved hosted schedule.
- No hosted schedule, webhook subscription or runtime secret was verified in B28.

## 2. Configuration prerequisites

Verify exact Staging identity, migration hashes, service-role project claim,
worker bearer length, platform account, three webhook secrets, Stripe API version,
application origin, Email sender/origin and Edge Vault bearer. Compare names with
`.env.sample`; never print values.

## 3. Feature-flag defaults

Payment, Refund, Transfer, Payout/Dispute observation, operational recovery, Shop
admission and Shop lifecycle default OFF. `disabled` is a valid result and must not
page an operator. Financial execution requires separate approval.

## 4. Stripe webhook channels

Check platform Order Payment, connected-account onboarding/Payout, and account
event channels separately. Verify raw-body signature, test mode, account scope,
purpose and durable inbox insertion. HTTP 200 proves receipt only; reconciliation
must reread the provider object.

## 5. Worker authentication failures

For 401, verify caller ownership and secret name/length, without logging headers.
For database 42501, verify service-role and project-ref claims. Never grant a
browser role access to make a worker succeed.

## 6. Repeated 503 degraded responses

Read the latest private receipt and projected phase statuses. A 503 can retain
successful independent phases. Follow the safe classification to its domain
operation and lease; do not infer that every phase failed.

## 7. Queue backlog

Use the service-role summary with an approved platform and documented thresholds.
Review capped due count, overflow marker, oldest due, stale leases and attention
count. Future work is excluded. Inspect a private domain only after the summary
identifies it.

## 8. Expired leases and crashes

A running receipt past its lease becomes `interrupted` on the next start. Confirm
the old token is rejected and use the existing domain reconciliation path. Never
edit a terminal receipt or manufacture success.

## 9. Provider 429, 5xx and timeout

Keep the same operation identity and idempotency key. Timeout/lost acknowledgement
is unknown, not failure; reread the provider object before any side-effect retry.
Exhausted or repeated failures require an operational case.

## 10. Financial unknown outcomes

Do not create a replacement PaymentIntent, Refund or Transfer. `reconcile` cannot
create money movement. Payment, Refund, Transfer, Reversal, Payout and Dispute
facts remain independent, with existing Protection/dispute blocks intact.

## 11. Notification Email outbox

Check runtime receipt and private delivery status. Provider `accepted` is not final
delivery. Retryable work uses the frozen envelope/key. Permanent failure requires
review. The pg_cron wrapper fails on Edge non-2xx. Email OFF never removes the
in-app Inbox.

## 12. Delayed Shop suspension

Check lifecycle cursor, lease, entitlement time and suspension-cycle identity.
Run only the bounded existing coordinator. Offer closure/system messages are
idempotent. Never affect Order-backed conversations, Resale Offers or admission.

## 13. Transaction due work stopped

Check the named pg_cron job/receipt and sanitized function error. The function has
an advisory overlap lock and independent 50-row bounds. Repair runtime/config only;
never rewrite transaction states or bypass Protection/settlement.

## 14. Media cleanup risk

Database candidates and deletion leases exist, but no hosted executor is approved.
Accumulation is expected. Never delete an object from age alone; confirm no bound
Order snapshot reference.

## 15. Safe automatic recovery

Allowed automation is existing provider reread, lease reclaim, same-operation
reconciliation, case synchronization, Shop lifecycle compensation and idempotent
reminders/messages. Preserve gates, batch bounds and fencing.

## 16. Mandatory human escalation

Escalate binding conflicts, long unknown results, exhausted retries, unattributed
Payout/Dispute, Refund/Transfer conflict, paid-to-failed facts, negative balance,
permanent Email failure and unexplained financial holds. Resolving a case cannot
release funds.

## 17. Actions blocked pending policy

Human finance roles, dual approval, chargeback/loss responsibility, negative
balance recovery, forced money movement, Stripe Dispute submission, Protection
release, alert recipients/channels/repeat cadence and audit retention are
**BLOCKED** until explicitly approved.

## 18. B30 acceptance order and rollback

1. Verify project identity, source hashes and migration order read-only.
2. Deploy approved migrations and verify RLS, grants, definitions and archive.
3. Configure secrets, webhook channels, database cron, hosted Worker and Email one
   component at a time; enable a business flag only under its own approval.
4. Prove disabled/idle/busy/success/degraded/crash receipts and bounded summaries.
5. Exercise duplicate/out-of-order events, 429/5xx/timeout, lost response, lease
   expiry, restart and concurrency in Stripe Test Mode.
6. Use approved temporary accounts/resources and an approved Email recipient.
7. Verify Shop suspension, due work, retention, Realtime and any approved cleanup.
8. Pass only with correct durable facts, no duplicate effects, no secret leakage,
   no bypassed hold and complete scoped cleanup.

On a material mismatch, keep finance/Shop gates OFF, stop writes and inspect
read-only. Roll back runtime configuration/application deployment; never delete
immutable financial evidence or reverse money automatically.

## Deployment preflight checklist

- Migration files exist in exact order and approved hashes are unchanged.
- Environment variable names are complete; values are not printed.
- Required schedules exist once and do not duplicate hosted responsibility.
- Worker runtime limits accommodate its bounded batch.
- Webhook channels map only to intended purposes.
- Feature flags retain safe defaults.
- Queue, oldest-due and lease states are explainable before activation.
- Alert ownership is approved, or external alerts remain OFF.
- Remote status remains **NOT VERIFIED** until B30 records evidence.

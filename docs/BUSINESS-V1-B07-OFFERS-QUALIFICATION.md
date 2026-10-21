# B07 — Offers local qualification

2026-10-19. Scope: the existing V2 Offer / Counter / Revise / Deny / Withdraw /
Accept authority and snapshot atomicity, as defined in
`BUSINESS-V1-TASK-BREAKDOWN.md`. This is not another project audit or B06
revalidation. Only local source inspection and isolated local tests were run.
Staging acceptance is NOT performed or implied by this document.
Current status: LOCAL VERIFICATION PASSED; REAL STAGING ACCEPTANCE DEFERRED DUE TO
IMMUTABLE TRANSACTION-HISTORY RETENTION. Corrected static assertions passed under
explicit approval, as recorded in the follow-up below. Earlier failure/approval
notes are historical evidence, not current instructions. B07 is not Completed.

Final environment/data decision (2026-10-19): existing infrastructure only; no new
environment is required or authorized. No B07 real Accept, test Orders or permanent
Offer/transaction history may be created in Staging. All existing Staging and local
data, including demo/manual test records, must remain untouched; no user-data
cleanup is authorized. Do not infer deletion permission from names or prefixes.
No protection bypass, reset or demo fixture generation. Historical private-media
downloads remain excluded. Future Staging writes require separate explicit
authorization after identifying side effects and immutable residues. Do not start
B08. See [final environment decision](BUSINESS-V1-B07-STAGING-ACCEPTANCE-PLAN.md).

## Existing implementation reused

| Concern | Current authority | Local evidence |
|---|---|---|
| API and identity | `pages/api/offers/[[...segments]].ts`, `lib/server/offers-service.ts`; existing Auth and same-origin guard | Server owns sender/recipient/status/protocol. Unexpected body fields and malformed UUID rejected. Existing `offers-api.cjs` covers real route guards and environment boundary. |
| Offer storage and negotiation | `public.order_requests` with `protocol_version=2`; `marketplace_submit_offer` -> `marketplace_private.mutate_offer_revision`; `marketplace_private.offer_commands` | Actual current SQL validates actor/Conversation/Listing relationships; one current proposal per sender; Counter compares recipient's active opposite proposal; Revise compares own current proposal; former versions persist. |
| Terms and changes | `validate_offer_terms`, `normalize_offer_terms`, `offer_changed_fields`; `lib/offers-api.ts`, `lib/offer-amount.ts`, `lib/offer-changes.ts` | Integer CAD cents, bounds, allowed fields, Meeting time/reference, payment mode and Delivery restriction; saved comparison basis and changed fields. Existing compatibility defaults remain intact. |
| Roles and transitions | `marketplace_deny_offer`, `marketplace_withdraw_offer`, immutable trigger/command receipts | Recipient-only Deny/Accept; sender-only Withdraw; 5-minute withdrawal window; exact duplicate actions emit one event. Unauthorized direct table mutation denied. |
| Expiry | `expire_conversation_offers`, `marketplace_offer_history`, `offer_accept_eligibility` | Meeting Offer expires at its scheduled time. Delivery has no invented arbitrary TTL. History reconciliation is idempotent; Offer expiry does not change inventory. No cron invoked. |
| Accept | `marketplace_offer_accept_preflight`, `marketplace_accept_offer`, `offer_accept_commands`, shared Listing locks / unique hold index | Exactly one Order/winner, losing Offers close, stale price/material/comparison conflicts, original command replay, frozen terms/channel/media. No Agreement confirmation or payment execution. |
| Seller readiness | `require_seller_payout_ready` and existing `financial_capabilities` | Missing Ready blocks uu_pay; external Meeting does not require readiness. Buyer payment setup is not required at Offer acceptance. Local positive gate fixture is explicitly NOT proof of Stripe/provider readiness. |
| Media | `lib/server/order-snapshot-media.ts`; `order_media_batches`, `order_media_commands`, `order_media_assets`, `order_snapshot_media`; existing prepare/verify/bind/lease RPCs | Private/legacy source bucket frozen; exact destination and SHA/length/MIME reconciliation; incomplete copy prevents Accept; retries retain batch; bound media cannot be cleaned; partial cleanup failure cannot claim success. |
| Conversation/notification integration | `transaction_events`, `emit_offer_event`, `project_transaction_notification`, recipient projections / invalidation | Counter classification and recipient, Deny/Withdraw/expiry event uniqueness and history retention checked using actual SQL. Realtime is a local recording stand-in; no hosted socket claim. |

Key migration definitions (unchanged):

- `202610100001_order_requests.sql`, `202610110004_offer_protocol_isolation.sql`:
  existing tables, participant RLS and protocol separation.
- `202610120001_offer_mutations.sql`, `202610130011_offer_revision_domain.sql`:
  immutable revisions, role commands, expiry and history.
- `202610160005_dual_payment_paths.sql`: latest validator/mutation/preflight and
  existing mode-aware gates/economics. The test does not execute external exchange,
  Agreement, settlement or payment commands.
- `202610160008_order_shop_provenance.sql`: current Accept freezes channel/name.
- `202610120003_order_snapshot_media.sql`,
  `202610190001_listing_image_isolation.sql`: snapshot lifecycle and actual source
  bucket. No historical image data is accessed or rewritten.

## Findings and actual changes

No confirmed B07 application/business defect has been reproduced in the covered
cases. Consequently no application, UI, SQL/RPC/RLS, migration or provider logic
was changed. A second Offer state machine/table was not introduced.

Added tests:

- `tests/offers-b07-api.cjs`: actual API + service + media copier, only their
  Auth/SDK transport boundary mocked in memory; network forbidden. Covers failed
  auth/recipient preflight, forged authority fields, malformed UUID, payout gate
  error propagation, partial-copy continuation, immutable destination uploads,
  private and legacy source use, SHA mismatch, post-commit response-loss replay
  that skips further media work, and safe conflict errors.
- `tests/offers-b07-db.cjs`: isolated native PostgreSQL on `127.0.0.1`, explicit
  local port/user/database, no environment file or Supabase CLI. Replays existing
  schema prerequisites and runs real separate-connection races. Stops the cluster
  in finally, including failure paths.
- `tests/offers-b07-db.sql`: real current RPC/trigger/constraint/RLS assertions,
  including role symmetry, invalid terms, expiry, immutable history, frozen
  economics and snapshots, media bind/cleanup and direct-write denial.

Only local fixture time-boundary setup temporarily bypasses the isolated test
row's immutable trigger to advance its timestamps; the trigger is re-enabled
before commands are tested. No deployed trigger, migration or business rule is
modified. This is not a proposal to change timestamps/guards in Staging.

The concurrency suite uses 11 two-connection scenarios: same UUID creation,
same-sender creation/replacement, Accept replay, competing Buyers, both orderings
of Revise/Accept, Withdraw/Accept and Deny/Accept, plus simultaneous Counter with
an obsolete comparison. Before releasing the first transaction, the runner
requires PostgreSQL `pg_stat_activity` to show the second connection waiting on
a lock. Outcomes are checked against canonical rows/commands/holds, not client
optimistic state.

## Validation results

PASS:

- `node tests/offers-b07-api.cjs` (actual API/service/media, network forbidden).
- `node tests/offers-b07-db.cjs` (native PostgreSQL, sequential assertions and all
  11 server-observed lock-wait races; cluster stopped in finally).
- `node tests/offers-api.cjs`.
- `node tests/offer-terms.cjs`.
- `node tests/offer-ux-recovery.cjs`.
- `node tests/order-snapshot-media.cjs`.
- `node tests/offer-protocol-static.cjs`.
- `node tests/offer-mutations-static.cjs`.
- Application TypeScript (`tsc --noEmit --incremental false`), focused ESLint,
  `git diff --check` and explicit new-file whitespace checks.

FAIL, retained and explained below: `node tests/offer-accept-static.cjs`, line 58.
No hosted, browser, real Auth, Storage or WebSocket B07 result is claimed here.

## Evidence boundaries

The local cluster runs current business definitions; managed Auth/Storage/Realtime
schemas are stand-ins. Storage object metadata is populated in the test cluster,
not by a hosted Storage server. Byte copying and SHA comparisons run separately
through the actual application service with local approved test-picture bytes.
This combination does not replace real Staging prepare/copy/verify/bind acceptance.

Cron registration is inert. The pg_cron installation and email HTTP/Vault transport
migrations are excluded; the notification foundation is installed only before its
external transport section. Notification email worker ACL/delivery and scheduler
operation are not certified by this test. No email/HTTP worker is invoked.
Later schema prerequisites are loaded solely to reproduce current Offer Accept
invariants; B08+ Agreement, payment, handoff, Protection, refund and payout commands
are neither implemented nor tested here.

One pre-existing test is still failing:
`tests/offer-accept-static.cjs:58` forbids `<OrderProgress>`, `<OrderCountdown>` or
`<FormalOrderPayment>` anywhere in `formal-v2-order-detail.tsx`. That assertion
describes the historical C2-only UI boundary, while the current approved component
already renders `<OrderProgress>` (line 209 at inspection). No B07 edit caused
this mismatch. The test and frozen UI were left unchanged; its remaining assertions
after line 58 are not reported passed. This is recorded test debt, not evidence of
a newly reproduced Offer business defect. No all-tests-green claim is made.

Local harness setup corrections: provide the existing migration's pgcrypto
dependency and inert cron registration; avoid a duplicate test variable name;
expect the authoritative immutable Order denial SQLSTATE `42501` rather than
`23514`. These corrections affect only new tests, not product behavior.

## Separately authorized Staging acceptance still required

Target only `pcaqxezdfxofysghssyo`, always explicit project ref, never the default
Production link. Before any write, compare deployed B07 functions/ACL/RLS with
these exact source definitions and inspect notification/worker side effects.

Authorization would be needed for unique temporary Buyer/Seller/outsider accounts,
fresh test Listings and media, Conversations, Offers/revisions/events/notifications,
Accept-created temporary Orders, private snapshot batches/assets/objects, and
precisely scoped cleanup. Do not send emails or execute actual payments.

1. Use independent real sessions and current frozen UI to send/counter/revise,
   deny/withdraw, reopen history and verify persistence/recipient notifications.
2. Reproduce UUID/changed-input/stale comparison races, competing Buyer accepts,
   Counter/Revise/Deny/Withdraw against Accept; verify exactly one winning Order,
   frozen terms/provenance, hold integrity and unrelated Listing invariance.
3. Use ONLY newly created B07 images for real private source -> snapshot copy,
   SHA verification, prepare/bind and participant-only read; test partial copy and
   lost response with client-local faults, never shared function/config changes.
   B05's excluded historical snapshot byte downloads remain excluded; do not ask
   for them again.
4. Exercise external Meeting positive acceptance and uu_pay missing-readiness
   denial. Positive uu_pay Ready must use a separately authorized, legitimately
   ready test Seller; never forge provider readiness to make a demo pass. No Stripe
   setup/payment side effect is authorized by this plan.
5. Existing immutable Order/event/economics references can restrict cleanup.
   Inspect the exact dependency graph and submit a narrowly guarded cleanup plan
   before Staging writes; do not disable deployed triggers or delete broad scopes.
   If cleanup would require a maintenance exception, obtain explicit approval.
6. Check current UI at 390/430/820/1280/1536 without changing it, then verify exact
   test resource residue. Report uncleaned IDs rather than expanding deletion.

No new database or UI change approval is currently requested because no such
change is proposed. Remote test data writes and any necessary maintenance cleanup
remain a separate approval boundary. B07 is not Staging Completed. Do not start B08.

## Strict Staging acceptance preflight — stopped (2026-10-19)

The user subsequently authorized narrowly scoped real Staging acceptance, including
temporary resources, but no trigger/policy/configuration changes or historical media
downloads. No B07 fixtures have been created. The earlier local results above remain
local evidence only; they are not hosted acceptance results.

`tests/b07-staging-preflight.cjs` reads metadata in a read-only transaction using the
existing guarded helper with explicit project ref `pcaqxezdfxofysghssyo`. It does not
execute business RPCs. Its ignored receipt is
`tests/artifacts/b07-strict-preflight.json`; no account secrets or raw cron commands
are emitted. Verified 31 function definitions/ACLs, seven relevant policies, 63
relevant foreign keys, private source/snapshot buckets, and active minute-level
transaction and notification-email workers. This is a partial preflight; account
creation and absence of external effects have not been certified end to end.

The deployed `order_request_immutable`, `orders_immutable`,
`transaction_events_immutable` and `v2_order_economics_immutable` triggers are enabled
(`tgenabled = O`). Their functions reject deletion of Request/Order history and
mutation of append-only events/frozen economics (SQLSTATE 23514). Restrictive foreign
keys further bind commands, events, media batches and Orders. Existing older hosted
test runners disable triggers during cleanup and MUST NOT be used under this
authorization. No cleanup has been attempted and no test resources were created;
there is no remote B07 run ID or newly created resource ledger. Any subsequent run
must account for potentially retained immutable test records rather than promise
complete deletion or use an unapproved maintenance exception.

The user explicitly authorized replacing only the obsolete `OrderProgress` assertion
after checking the real approved component. `formal-v2-order-detail.tsx` renders
`OrderProgress`; the test now positively requires it and retains the exclusions for
`OrderCountdown` and `FormalOrderPayment`. No application file changed.

Running the entire `tests/offer-accept-static.cjs` then FAILS at line 60:
`assert(detail.includes('OfferTermsSummary'))`. The current component delegates
details to `OrderStageDetails` and cancellation to `OrderFlowCancellation`; it does
not reference `OfferTermsSummary`. The following `OrderCancellation` assertion also
does not match the current component name but has not been reached by this run.
Neither assertion was removed or weakened. Per the strict stop condition, no real
fixtures or further acceptance actions were started. Proposed next step, requiring
approval: update these remaining legacy UI composition checks to positively verify
the actual approved delegation, keeping all business/protocol assertions intact.

Hosted lifecycle A–E, concurrent Accept/Revise, new snapshot prepare/bind/hash,
refresh/re-login, in-app notification deduplication and third-party denial are all
NOT EXECUTED in this attempt. No historical image was read, no scheduler invoked,
no email/payment initiated, no database/configuration/UI change made, and no Git
mutation performed. B07 remains acceptance-blocked, not Completed. B08 not started.

Validation of this attempt: application TypeScript (`--noEmit --incremental false`)
PASS; focused ESLint for `b07-staging-preflight.cjs` and `offer-accept-static.cjs`
PASS; `git diff --check` PASS (existing line-ending notices only). The full static
test remains FAIL at the unchanged `OfferTermsSummary` assertion. Earlier local
PostgreSQL/API suites were not rerun after the mandatory acceptance stop and are
not claimed as newly executed results.

## Limited approval follow-up — static checks resolved (2026-10-19)

The user subsequently approved precisely the remaining two obsolete references.
They now positively require rendered `<OrderStageDetails` and
`<OrderFlowCancellation`; the real components' stage/cancellation responsibilities
were inspected first. All other assertions remain intact. Complete static test
and seven related local regressions PASS; application TypeScript and focused
ESLint PASS. No application/UI change or remote fixture was made.

The authorized cleanup investigation remains metadata-only, explicitly Staging.
Its findings, deletion/retention matrix, expected Accept footprint and separate
historical proposal and final superseding environment decision are in
[the B07 Staging acceptance plan](BUSINESS-V1-B07-STAGING-ACCEPTANCE-PLAN.md).
Normal external cancellation can release a test hold but does not purge history.
Unique B07 labels do not remove released/public test Listings from shared browsing.
B07 real acceptance is now deferred due to immutable transaction-history retention
under the final user decision above; no new environment, retained-fixture run or
user-data cleanup is authorized. No Staging write or B08 started.

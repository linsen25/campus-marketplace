# B07 verification evidence and final environment/data protection decision

Date: 2026-10-19. Current status: local verification passed; real Staging acceptance
deferred due to immutable transaction-history retention. Not Completed.
No Staging fixtures or business actions were created/executed by this B07 run.

The final user decision below supersedes earlier acceptance/cleanup proposals.
The technical deletion matrix is read-only evidence, not permission to delete any
existing record or run cleanup. No environment/retained-fixture choice is pending.

## Executed scope and evidence

Only two remaining obsolete assertions in `tests/offer-accept-static.cjs` changed:
`OfferTermsSummary` -> `<OrderStageDetails`, and `OrderCancellation` ->
`<OrderFlowCancellation`. These positively check rendered JSX, not merely imports.
`OrderStageDetails` handles Agreement/review, price, fulfillment, Protection and
outcome details; the parent supplies the Order, role, terms and authoritative flow.
`OrderFlowCancellation` uses the server cancellation projection, authenticated
cancel/respond APIs, action UUIDs and refresh/reconciliation; the parent supplies
the existing callbacks. No component changed. All other assertions are unchanged.

PASS: complete `offer-accept-static.cjs`, `offers-api.cjs`, `offer-terms.cjs`,
`offer-ux-recovery.cjs`, `order-snapshot-media.cjs`, `offer-protocol-static.cjs`,
`offer-mutations-static.cjs`, `offers-b07-api.cjs` (8/8). Application TypeScript and
focused ESLint PASS. These are local results, not live Accept acceptance.

Read-only metadata inspection explicitly targeted `pcaqxezdfxofysghssyo` using
`scripts/v2-maintenance-staging.cjs` and its project guard, never the default CLI
link. The ignored receipt `tests/artifacts/b07-cleanup-review.json` contains 57
trigger definitions/enabled flags, 70 foreign keys, 20 relevant functions/ACLs,
28 policies and B07 domain column metadata. No existing user rows or historical
media bytes were read. No RPC was executed, account created, config changed or
remote data written. The ignored helper and receipt contain no test credentials.

## A. Resources conditionally removable through existing mechanisms

These are supported deletion paths established by code/metadata, not claims of
successful remote deletion in this task. Every future operation needs an exact
run ledger, ownership and reference check plus separate write authorization.

| Resource | Existing path and prerequisite | Important limit |
| --- | --- | --- |
| Standalone test Listing and original images | Owner `DELETE /api/listings/{id}` -> `deleteListing`; delete database parent, cascade manifest, remove exact Storage objects | Only when unreserved and without Offer/Order/media FK references. Removing published image children independently is forbidden. Storage failure must remain tracked. |
| Test Listing favorites | Existing owner favorite removal; parent/account cascade where permitted | Does not remove the Listing or transaction history. |
| Conversation/messages without transaction references | Existing authorized administrative parent deletion; messages/image submissions cascade, image cleanup queue records exact paths | Not a general participant delete-conversation UI/API. Sent messages cannot be independently deleted; an Offer or transaction event can block parent deletion. Storage still needs its supported cleanup/reconciliation path. |
| Test recipient inbox rows | `marketplace_mutate_notifications(p_ids,'delete')` under recipient session | Does not delete domain events. Unattempted delivery rows are retired/deleted; attempted delivery audit may remain. Never use global inbox cleanup as run cleanup. |
| Expired, unbound snapshot objects | Existing claim -> lease -> Storage API remove -> finish RPCs, via `cleanupOrderSnapshotMedia` | Not before expiry/while leased; never bound/referenced batches. Finishing keeps deleted tombstones, assets and command references. No timestamp manipulation. |
| Unreferenced temporary Auth account | Existing admin deletion and normal profile cascades | Open Orders block profile deletion. Retained seller Listings have NOT NULL seller_id and an FK without cascade; they can block deletion even after an Order ends. Buyer deletion must be separately checked, not assumed safe. |
| Temporary sessions | Existing Auth session revocation for the exact test users | Does not remove accounts or history. No current authorization to perform it. |

## B. Records that must be retained under current rules

Enabled triggers `order_request_immutable`, `orders_immutable`,
`transaction_events_immutable`, `v2_order_economics_immutable` reject history
deletion/mutation with SQLSTATE 23514. Service-role access does not bypass triggers.
Closing, declining, withdrawing, expiring or cancelling is a state transition,
not deletion permission; terminal history remains protected.

`orders.request_id`, `orders.conversation_id`, `orders.listing_id`,
`order_requests.conversation_id/listing_id` and transaction event dependencies
use RESTRICT; media batch dependencies use NO ACTION. Thus even non-immutable
Listing/Conversation rows become retained dependencies once Offers/Orders exist.
Deleting messages or source media to break that graph is not safe cleanup.

Bound `order_media_batches`, assets, commands, snapshot links and snapshot Storage
objects must remain together. The existing claim RPC explicitly excludes bound
batches, any order_id and snapshot references. It cannot purge cancelled Orders.
Unbound cleanup also retains tombstones; it is not a delete-all-history mechanism.

Primary source references:

- `202610160005_dual_payment_paths.sql`: latest Order/Request guards, cancellation,
  external exchange and inventory authority.
- `202610100002_order_accept.sql`: unfinished-Order participant retention trigger.
- `202610120003_order_snapshot_media.sql`: media lifecycle, bind and cleanup leases.
- `202610160008_order_shop_provenance.sql`: current Offer Accept and frozen source.
- `202610190001_listing_image_isolation.sql`: private source-bucket authority.
- `202610160001_notification_inbox_management.sql`: recipient inbox deletion.
- `lib/server/supabase-listings-repository.ts`: supported Listing deletion path.
- `lib/server/order-snapshot-media.ts`: trusted byte verification and cleanup.

## C. Expected durable footprint of a real Accept run

Each successful Accept creates one Order and acceptance command linked to the
winning Offer/Conversation/Listing, one frozen economics record, one media batch
binding with its assets/snapshot links/objects, an initial Agreement record,
Meeting revision zero for Meeting terms, and an external-exchange record for
external mode. Order/Offer transitions create immutable transaction events and
notification domain facts/inbox projections. Other competing active Offers may
close and remain in history. Publishing also records seller account activity.

Four independent concurrency scenarios need their own Listings/Offers. The exact
Order total depends on whether Accept or Revise wins each race; it must be observed,
not hardcoded as a pass expectation. Duplicate/lost-response Accept must reuse the
same Order/binding/hold. All lifecycle-only Offers also remain immutable history;
retention starts with Offer creation, not only after Accept.

Potential further retained rows include reminder receipts, first-contact/activity
facts, offer command history, cancellation commands/events and natural-expiry
receipts. Not every possible row is guaranteed in every scenario. A ledger must
record actual IDs, links and counts rather than infer a zero-residue result.

## D. Legitimate business end states exist; full purge/isolation does not

Offer Deny/Withdraw end the appropriate proposal while preserving history.
Meeting expiration is handled naturally by existing cron; no manual execution or
clock changes are proposed.

For a new Meeting + external Order with neither exchange attestation, handoff,
Protection nor shipment, existing `marketplace_cancel_order` checks participant,
reason, action UUID, lock and cutoff. Its external branch sets cancelled, clears
holds and the Listing reservation pointer, and emits `external_exchange_cancelled`.
It does not enter the UU payment cancellation-intent/settlement authorization path.
It still calls its own supported meetup reconciliation and creates history.
Cancellation therefore needs explicit future authorization; it has NOT been run.
Never fabricate exchange attestations, a completed sale or payment to release a hold.

No B07 domain test-run/is_test/archive/hide field or run-aware public RLS filter was
found. `listings_public_read` exposes published available Resale Listings;
`getListings` also queries available Listings. Cancellation/natural expiry releases
them back to available. Publication cannot be reversed. Listing deletion is then
blocked by retained Offer/Order references. A unique title is not access isolation.
Deleting the seller is not a workaround: Listings require that seller profile.

The existing system therefore cannot promise both full history retention and zero
visibility/count effects on shared Staging. Only test-owned account analytics and
inboxes should change, but published test Listings can appear in the shared Market.
Do not claim that naming alone prevents unrelated users from encountering them.

## E. Final user decision: existing infrastructure only

Use the existing local development/PostgreSQL test infrastructure and existing
Staging `pcaqxezdfxofysghssyo` only. No additional Supabase project, branch,
disposable cloud environment or database environment is required or authorized.
Never reset the user's existing local development/Supabase database.

The user does not accept additional permanent B07 test transaction history in
Staging. Do not create B07 Offers/history, perform real Accept, create test Orders
or bypass/disable/weaken immutable protections. Prior proposals for an extra
environment or retained Staging fixtures are withdrawn, not awaiting approval.
Historical private-media downloads remain excluded; do not request them again.

Preserve every existing account/profile, Resale Listing/card, Shop/product, image,
Storage object, favorite, Conversation/Message, Offer/Order/history, notification
and local development record. This includes existing demo and manually created
test data. A title containing test/demo or a recognizable prefix never establishes
disposability. Exact user authorization is required before classifying identified
resources as deletion targets. No cleanup, reset, truncate, bulk deletion,
overwriting, reorganization or destructive migration is authorized.

Clean Staging means avoiding unnecessary test pollution, not emptying the database.
Preserve current content for the user's continuing tests and future demonstration
video. Do not generate new demo fixtures, replace existing content, prepare a demo
environment or fabricate Orders to populate UI. Demo preparation is a separate task.

## Future Business V1 authorization boundary

Local work/tests may continue only without damaging/resetting existing user data.
Staging read-only verification and separately authorized, understood tests may use
the existing project. Before proposing any future Staging write:

1. Enumerate all records and external/worker side effects it would create.
2. Check technical and business-rule removability using existing mechanisms.
3. Separate removable resources from immutable retained history.
4. Explain impacts on the user's current accounts, cards, Listings and other data.
5. Obtain explicit authorization before execution. Do not run tests that leave
   permanent records the user has not accepted.

UI V1 remains frozen. Never access Production or use the default Production-linked
CLI target. No unapproved schema/RLS/RPC/Storage/Auth/cron changes, emails, payments
or Git stage/commit/push/reset/clean. Do not start B08 automatically.

No tests or remote calls were rerun for this final documentation-only update.
B07 local PostgreSQL/concurrency/API/corrected static checks passed previously;
real Staging Accept, concurrency and new transaction snapshots remain unverified.
No user-data cleanup or new environment is authorized, and B07 is not Completed.

# Orders backend staging design

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

## Phase C implementation precedence (2026-10-11)

The [Phase C financial gate](FINANCIAL_CAPABILITIES_STAGING.md#phase-c---seller-payout-gate-2026-10-11)
is now implemented on staging with function-only migration `202610110001`.
Seller Create/Replace and first Buyer Accept serialize against current payout
Ready using the same user/capability advisory lock as trusted financial changes,
including absent/Unset rows. Cancel has no gate; completed idempotent retries return
unchanged before checking readiness. Denials are zero-write domain errors, not
Request status changes. No readiness snapshot/backfill, retrospective Order
invalidation or payment state. Prior statements below describing this as future
work are historical. Existing reservation/Shipping pending semantics stay intact.

V1 decision closure is now [approved](ORDER_PAYMENT_PRODUCT_DESIGN.md#13-decision-closure-and-next-phase-boundary).
The contract locks default terminal visibility, separate Request acceptance/Order
outcome, Order Completed independent of payout Paid, shipping reimbursement,
tracked shipping with carrier Delivered OR Buyer receipt, issue payout holds,
late-success reconciliation/refund, six-digit single-use handoff and optional Maps.
Earlier proposals below do not reopen these rules. This documentation update
changes no deployed schema/RPC/RLS or staging rows.


## Product precedence (2026-10-10 finalization)

The [finalized Payment/Payout product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md)
is authoritative for future financial work. Sections 1-16 below are an earlier
technical proposal, not implemented financial schema or a competing product
contract. It does not settle concrete financial tables/enums. Account-level
Payment/Payout settings, Seller payout Ready before Request send, Buyer method
setup after Accept, distinct financial lifecycles, role-specific progress,
24-hour Protection and Buyer-only persisted staging simulation supersede conflicting
proposal rules. The A-H roadmap in that contract replaces section 15's older
financial implementation ordering. Current evidence is in
[Accept staging](ORDERS_ACCEPT_STAGING.md) and [detail parity](FORMAL_ORDER_DETAIL_PARITY.md).


Design date: 2026-10-10. **PHASE 1 AND MINIMAL AUTHORITATIVE ACCEPT IMPLEMENTED ON STAGING.**
The [Accept implementation record](ORDERS_ACCEPT_STAGING.md) supersedes the earlier
Phase 1 no-Accept boundary. User clarification: Shipping pending Accept creates an
Order but does not reserve inventory or start any countdown. Later payments,
quotes, handoff and protection remain design only.

The [local preview](ORDERS_PAYMENT_UI_PREVIEW.md) is **LOCAL PREVIEW QUALIFIED / FROZEN**. Sections 1-16 preserve the design proposal; the Phase 1 implementation record below takes precedence for shipped staging behavior. Implementation targets only `western-marketplace-staging` (`pcaqxezdfxofysghssyo`). Production `campus-marketplace` (`yzvchumzyonegujucyqs`) remains untouched until separate explicit approval. Requests, atomic Accept, Orders, reservations and expiry are now staging implemented. Payment, handoff, protection and provider integration remain unimplemented.

## 1. Repository evidence and frozen baseline

Reviewed local migrations from `202609290001_marketplace.sql` through `202610090001_auth_pending_username.sql`, current preview helpers/context/timeline, schedule and amount helpers, and preview qualification documentation. These are repository observations, not a new live-database audit.

- Migrations use explicit transactions, constrained text statuses, UUID keys, `marketplace_private` helpers, `marketplace_*` public RPCs, `security definer set search_path = ''`, fully qualified references, explicit revokes/grants and guarded triggers.
- Profiles reference Auth with deletion cascade. Verified eligibility is authoritative `marketplace_private.is_western_user()`, reading confirmed UWO Auth state. Username identity/cooldown protections are already established and must remain intact.
- Listings currently allow only `available` and `sold`. Sellers have direct status UPDATE and DELETE permissions. Publication and image-manifest triggers protect published images and sold terms. Public reads expose only published available listings. Reservation integration therefore requires deliberate compatibility work; a new Order table alone cannot protect inventory.
- Conversations identify original Listing + Buyer + Seller, snapshot listing terms, retain history when live listing/profile references become NULL, and serialize message sends with a conversation lock.
- Messages permit only TEXT/IMAGE, with immutable rows, guarded writes, client UUID idempotency, per-conversation sequences and sender-excluding unread counts. Transaction items currently have no message sequence.
- Listing images use public `listing-images` with metadata/path ownership and API cleanup. Durable chat images use private `chat-images`, staged submissions/receipts and guarded finalization. Neither bucket is a shipping-address/code store.
- Realtime uses private per-user Broadcast invalidations, not raw transaction rows or Postgres Changes. One mounted Messages channel and authenticated refetch are the existing lifecycle.

Actual preview values:

| Concern | Current values / behavior |
| --- | --- |
| Request | `active`, `superseded` (display Replaced), `accepted`, `expired`, `cancelled` |
| Order | `reserved`, `paid`, `shipped`, `delivered`, `protection`, `completed`, `cancelled`, `expired` |
| Issue | Optional overlay on Order, not a separate preview Order enum |
| Fulfillment | `pickup`, `meet`, `shipping` |
| Shipping cost | `included`, `flat`, `arranged`; arranged produces no payable total |
| Scope | Buyer + Seller + Listing; legacy isolated tests may fall back to conversation identity |
| Cancellation | Seller cancels Active Request; either participant cancels unexpired unpaid Order; Accepted Request never changes back |
| Scheduling | Pickup/Meet required fixed location/time, 60-minute creation notice, 30-day maximum, 15-minute increments; Accept currently requires only a future scheduled time |
| Expiry | Pickup/Meet Request expires at scheduled time; Shipping Request has no current time-based expiry |

Local objects clear on refresh/logout, never reserve live inventory and cannot synchronize sessions. Frozen UI is an interaction specification, not a security implementation.

## 2. Recommended minimal model

Use constrained text values instead of PostgreSQL enums, matching this repository. Core public tables are `order_requests`, `orders`, `transaction_events`, `order_issues`, `order_payments` and `order_shipping_addresses`. Two private infrastructure tables support secure codes and command retries. The original proposal avoided extra infrastructure tables. This is not a prohibition on a distinct financial capability/payout model: Phase A of the finalized product contract must design that model. No financial schema is implemented by this proposal.

Common conventions:

- UUID PKs default server-generated; all dates `timestamptz`. Capture action time once **after locks are acquired**, using server clock, and reuse it across records/events. Do not trust browser times or transaction-start `now()` after a long lock wait.
- Monetary columns use bigint integer CAD cents, validated nonnegative and within JS-safe range, with safe checked sums. Currency fixed `CAD`. No float money or formatted display strings.
- Immutable historical actor/listing origin UUIDs have no cascading Auth FK. Nullable live `buyer_id`/`seller_id` profile FKs may SET NULL on deletion; immutable origin IDs and name snapshots preserve history. All current authorization uses live membership plus verified Auth, never historical names or client role input.
- Live listing FKs use deletion restriction for transaction history in version 1. Conversation references also RESTRICT deletion; ordinary message cascades must not erase transaction records. Terminal listing removal and account deletion require an explicit later retention/admin policy. Version 1 must block deletion of participants with unfinished Orders before Auth/profile deletion; do not strand a paid Order silently.
- No ordinary client INSERT/UPDATE/DELETE grants. Private tables also revoke service-role direct access where practical; narrowly granted definer entry points handle privileged operations. Owner/admin bypass remains an operational trust boundary.
- Request terms, identity, original creation times and finalized monetary terms are trigger-protected. Mutable lifecycle fields change only through approved transitions; arbitrary service-role row edits are not the test interface.

### 2.1 `public.order_requests`

Purpose: immutable seller offer plus terminal lifecycle, linked to one real conversation.

| Group | Proposed columns |
| --- | --- |
| Identity | `id` PK; `conversation_id` FK RESTRICT; `listing_id` FK RESTRICT; `listing_origin_id`; live `buyer_id`, `seller_id` FKs; immutable `buyer_origin_id`, `seller_origin_id` |
| Listing snapshot | `listing_title_snapshot`, `listing_description_snapshot`, `listing_category_snapshot`, `listing_subcategory_snapshot`, `listing_condition_snapshot`, `listing_price_cents_snapshot`, `listing_currency_snapshot`; ordered `listing_media_snapshot` JSON manifest of image ID/path/slot; buyer/seller username snapshots |
| Agreed terms | `item_amount_cents`, `currency`, `fulfillment_type`, optional trimmed `seller_note` |
| Location | `location_source`, `place_id`, `place_name`, `formatted_address`, `latitude`, `longitude`, `meeting_details` |
| Schedule | `scheduled_at`, `schedule_timezone` (proposed `America/Toronto`) |
| Shipping | `shipping_cost_mode`, nullable `shipping_amount_cents`, optional `shipping_method`, optional `shipping_note` |
| Lifecycle | `status`, `created_at`, `updated_at`, nullable `request_expires_at`, `replaced_at`, `accepted_at`, `expired_at`, `cancelled_at`; nullable `replacement_request_id` self FK |
| Cancellation | `cancelled_by` historical UUID, `cancelled_by_role`, `cancel_reason_code`, `cancel_reason_label_snapshot`, optional `cancel_note` |

Constraints: distinct participants; identities derived from locked conversation/listing, not payload; `listing_origin_id` matches conversation original identity. Partial UNIQUE `(listing_origin_id,buyer_origin_id,seller_origin_id)` WHERE status=`active`. Expired physical Active rows must be settled inside create/replace/Accept before enforcing a new Active slot. Time-dependent uniqueness predicates are not used.

Pickup/Meet requires schedule/location; shipping schedule/location fields are NULL. Included amount=0; flat-rate amount>=0 and non-NULL; pending amount=NULL. Non-shipping shipping mode/amount are NULL, with Order calculation treating shipping as zero. One terminal timestamp consistent with terminal status; `replacement_request_id` only for superseded, immutable after transition. Terminal states cannot reactivate or be deleted through user APIs.

Indexes: conversation `(conversation_id,created_at,id)`; participant history `(buyer_id,created_at DESC,id)` and seller equivalent; FK indexes; partial expiry `(request_expires_at,id)` for Active timed requests. Create key lives in command ledger, not a second divergent client ID mechanism.

Media paths are stable snapshot references, **not byte-retention guarantees**. Listing deletion is restricted; Storage cleanup must also respect transaction references. Until media retention is formally implemented, detail must tolerate an unavailable historical image. Do not copy private chat-image URLs into public snapshots.

### 2.2 `public.orders`

Purpose: accepted transaction, inventory claim, server deadlines and fulfillment facts.

| Group | Proposed columns |
| --- | --- |
| Identity | `id` PK; `request_id` UNIQUE FK RESTRICT; conversation/listing/live participant FKs and immutable origin IDs matching the Request |
| Terms | Copy Request scalar terms/location/media/name snapshots at Accept, with `terms_schema_version`; never query current listing/profile to reconstruct old terms |
| Money | `item_amount_cents`, nullable `shipping_amount_cents`, `service_fee_amount_cents`, `seller_fee_amount_cents`, `total_amount_cents`, `currency`, `service_fee_rule_version`, `money_status`, `money_finalized_at`, `shipping_quote_version`, `shipping_quote_confirmed_at` |
| Lifecycle | `lifecycle_status`, `holds_listing`, `version`, `created_at`, `updated_at`, `accepted_at`, `reservation_started_at`, `reservation_expires_at`, `reservation_ended_at`, `paid_at`, `completed_at`, `expired_at`, `cancelled_at` |
| Fulfillment | `fulfillment_status`, `carrier`, `tracking_number`, `shipped_at`, `delivered_at`, `delivery_evidence_source`, `buyer_received_at`, `handoff_confirmed_at` |
| Protection | `protection_status`, `protection_started_at`, `protection_expires_at`, `completion_eligible_at` |
| Cancellation | Same immutable actor/reason/note snapshot fields as Request |

`request_id` ensures exactly one Order per Accepted Request. Partial UNIQUE `listing_origin_id` WHERE `holds_listing` is the cross-buyer inventory backstop. Partial UNIQUE `(buyer_origin_id,listing_origin_id)` WHERE lifecycle_status=`open` enforces same-buyer unfinished gate even if future inventory semantics change. These predicates use materialized fields, never current time.

Indexes: Buyer/Seller workspaces `(participant_id,created_at DESC,id)`; conversation history; partial reservation deadline for open/unpaid holds; partial protection deadline for running protection; FK indexes. All status/deadline consistency CHECKs are static; current-time eligibility belongs in locked RPCs.

For fixed costs, money finalizes once at Accept. Pending shipping leaves shipping/fee/total NULL, `money_status=shipping_pending`; item price and rule version are fixed. Locked future quote confirmation finalizes unresolved money after Seller quote and Buyer approval, atomically rechecks available inventory, claims the Listing and starts a 30-minute server reservation/payment window; unavailable inventory fails without partial finalization. It must never rewrite original Request terms. No quote negotiation implementation is authorized here.

### 2.3 `public.order_payments`

Purpose: small provider-ready payment-attempt record, separated from Order lifecycle and fulfillment. One Order may have multiple failed/retried attempts, at most one succeeded.

Columns: `id` PK, `order_id` FK RESTRICT, `provider` (`staging_test` initially, provider identifiers added only with integration), nullable `provider_payment_id`, `status`, immutable `amount_cents`, `currency`, `money_version`, `created_at`, `updated_at`, `paid_at`, optional sanitized failure code. UNIQUE `(provider,provider_payment_id)` when non-NULL; partial UNIQUE `order_id` WHERE status=`succeeded`; partial UNIQUE `order_id` for `pending` attempt if a single live checkout is chosen. Order index `(order_id,created_at,id)`.

No card data, secrets, raw webhook payloads or provider session URLs in participant-readable rows. Authoritative payment state is this table; Order `paid_at` is a transactionally consistent milestone maintained by the same trusted transition, not another editable payment enum. Browser-facing DTO may expose payment summary only.

### 2.4 `public.transaction_events`

Purpose: append-only shared transaction history, including pre-Order Request events.

Columns: `id` PK, `conversation_id` FK RESTRICT, required `request_id` FK RESTRICT, optional `order_id` FK RESTRICT, nullable historical `actor_id`, `actor_role` (`buyer`,`seller`,`system`,`admin`), `event_type`, `created_at`, `transition_key` UNIQUE, `metadata_schema_version`, bounded immutable JSON `metadata`.

Kinds: `request_created`, `request_replaced`, `request_cancelled`, `request_expired`, `request_accepted`, `order_created`, `order_cancelled`, `reservation_expired`, `payment_succeeded`, `shipping_address_submitted`, `order_shipped`, `delivery_recorded`, `buyer_received`, `handoff_confirmed`, `issue_opened`, `issue_resolved`, `order_completed`; future quote events added only when implemented.

Indexes `(conversation_id,created_at,id)`, `(order_id,created_at,id)`, `(request_id,created_at,id)`. Metadata contains nonsecret terms/status/reason snapshots or record references; never code/address/token/card material. Actor derived server-side. Events cannot be updated/deleted normally. Transition keys distinguish Request and Order events from one Accept without double-inserting retries.

### 2.5 `public.order_issues`

Purpose: minimal manual-review hold, not a dispute center.

Columns: `id` PK; `order_id` FK RESTRICT; historical `opened_by`, `opened_by_role`; `reason_code`, `reason_label_snapshot`, bounded `description`; `status`; `created_at`, `resolved_at`, nullable historical `resolved_by`, bounded `resolution_note`, `resolution_outcome`.

Partial UNIQUE `order_id` WHERE status=`open` means one current case; a second participant may read the case and contact support, not overwrite its opener/evidence. Future multi-party comments need separate design. Index `(order_id,created_at,id)` and partial `(created_at,id)` for admin open queue. Resolution is privileged, audited and cannot fabricate refund/payment/payout success.

### 2.6 `public.order_shipping_addresses`

Purpose: sensitive one-row-per-Order address, isolated because RLS filters rows, not conditional columns within an Order row.

`order_id` PK/FK RESTRICT; `recipient_name`, `address_line1`, optional `address_line2`, `city`, `province`, `postal_code`, `country_code` (CAD-first proposed CA), `created_at`, `updated_at`, `locked_at`. Order membership derives ownership; no client owner field. Buyer submits after Accept and may edit before successful payment; trusted pay transition locks the current address. Seller SELECT allowed only after Order payment succeeded. No address in events, Broadcast, public views, general list DTOs or logs. Later retention/redaction policy is required. No extra address index beyond PK is needed.

### 2.7 `marketplace_private.order_handoff_controls`

Purpose: secure code material and attempt lifecycle, outside participant SELECT.

`order_id` PK/FK RESTRICT, keyed `code_digest`, server-encrypted `code_ciphertext`, `key_version`, `generated_at`, `expires_at`, `failed_attempt_count`, `locked_until`, `consumed_at`, `last_attempt_at`. No plain code column. Encryption permits eligible Buyer re-display; hash alone cannot reproduce a random code. Secrets/keys stay server-only, separate from the database dump, with documented rotation and recovery. Revoke direct access from public/anon/authenticated/service_role; use tightly scoped internal functions/server boundary.

### 2.8 `marketplace_private.order_commands`

Purpose: shared successful-command idempotency across create/replace/cancel and future transitions, avoiding repeated ad hoc nonce columns.

`id` PK (command UUID), `actor_key` (derived user UUID or trusted provider namespace), `action`, `idempotency_key` UUID/text, `input_digest`, optional `request_id`/`order_id` FKs RESTRICT, `created_at`, bounded result references/status. UNIQUE `(actor_key,action,idempotency_key)`. Store normalized digest, never raw address/code input or credentials. No participant SELECT. Concurrent identical keys serialize with a transaction advisory lock before domain locks; committed success is replayable. Same key/different input returns conflict. Failures normally roll back the command row; security-attempt accounting is handled separately as described below. Retain successful keys for the record lifetime in version 1.

## 3. Explicit state representation

| Dimension | Proposed constrained values |
| --- | --- |
| Request status | `active`, `superseded`, `accepted`, `expired`, `cancelled`; UI still says Replaced |
| Order lifecycle | `open`, `completed`, `cancelled`, `expired` |
| Payment attempt status | `pending`, `succeeded`, `failed`, `cancelled` |
| Money readiness | `finalized`, `shipping_pending` |
| Fulfillment | `awaiting_payment`, `awaiting_fulfillment`, `shipped`, `delivered`, `confirmed` |
| Protection | `not_started`, `running`, `elapsed` |
| Issue | `open`, `resolved` |
| Shipping cost | `included`, `flat_rate`, `pending` |

Issue hold is derived from an open issue; do not add an independently writable hold boolean. Payout eligibility must follow confirmed fulfillment, successful payment, elapsed Protection and no blocking issue. The old eligibility-only payout proposal is superseded: Payment and Payout have distinct conceptual lifecycles; Eligible -> Processing -> Paid must not be collapsed into Order completion. Concrete financial representation remains Phase A work. Completion cannot fabricate payout execution.

UI adapter maps open/unpaid to Reserved, succeeded/awaiting_fulfillment to Paid, shipped/delivered to their labels, confirmed+running to Protection; open issue overlays On hold. Terminal lifecycle maps to Completed/Cancelled/Reservation expired. This earlier adapter sketch does not prescribe one universal progress timeline: future presentation derives from authoritative facts, fulfillment and authenticated role under the finalized contract.

Request transitions only `active -> superseded|accepted|expired|cancelled`. Terms never change. Order terminal lifecycle never reactivates; accepted Request remains accepted after Order cancellation/expiry. Completion requires succeeded payment, confirmed fulfillment, elapsed protection, no open issue and an atomic inventory sale. Payment failures do not complete or release a paid Order.

## 4. Location and schedule contracts

Pickup/Meet location supports `location_source=free_text|google_places`; `meeting_details` stores entrance/meeting instructions. Free-text fallback requires a nonblank place name or formatted address, with place_id/coordinates NULL. Future Places selection requires place_id, place_name, formatted_address and paired latitude/longitude, checked within valid ranges. No client-provided place identity is a safety/authenticity guarantee.

Store `scheduled_at` as UTC timestamptz and IANA `schedule_timezone`. Proposed campus timezone is America/Toronto, replacing accidental dependence on each browser timezone. Validate nonexistent/ambiguous DST times deliberately; reject nonexistent times and require explicit offset for ambiguous ones. Fifteen-minute step is validated in the chosen timezone, seconds/subseconds zero. At create/replace, validate minimum notice >=60 elapsed minutes and maximum 30 campus-local calendar days; rounding matches the existing wheel helper. At Accept retain the current future-only rule; do not silently impose another 60-minute notice.

Pickup/Meet `request_expires_at=scheduled_at`; scheduled requests cannot Accept at or after that time. Shipping NULL expiry preserves preview behavior but requires a product decision on offer age. Future Places integration: autocomplete -> structured snapshot -> small detail map; server-restricted lookup key and browser-restricted map key only when selected, attribution and provider retention rules reviewed then. No live location, navigation, routing or tracking. No Google key/dependency now.

## 5. Locking and atomic Accept

All inventory-affecting commands use a common lock order: idempotency-key lock, Listing row, Conversation row if needed, Request rows in stable UUID order, Order rows in stable UUID order, payment/address/control/issue rows. Resolve IDs with a nonlocking lookup first, then **revalidate identity after locks**. Existing listing/share and conversation/message locks must be checked in integration tests; no Order path may lock an Order then request a Listing lock. Background tasks select IDs first and follow the same lock order, rather than holding an Order lock while taking Listing locks.

Proposed public name: `marketplace_accept_order_request(p_request_id uuid, p_client_action_id uuid)`. Returns an authoritative role-safe Order DTO, server time/version and transition result. Authenticated verified Buyer only; never accept a buyer/seller parameter as authority.

Inside one transaction:

1. Recheck membership before replaying even a prior successful command. Unknown/inaccessible targets share a nondisclosing error.
2. Lock Listing, conversation, target Request, and any inventory-holding Order. Settle an expired prior unpaid reservation if present using the same locked internal transition.
3. Read server action time after waits. If this Request already has an Order for this Buyer, return that same Order; do not reserve again or reset deadlines, including after its terminal outcome.
4. Validate Active/future Request, real published available Listing, seller identity, conversation identity, no inventory claim and no unfinished same-Buyer+Listing Order. A stale Request from an edited listing retains its agreed snapshot; listing title/price need not match current terms, but ownership/publication/availability must.
5. Insert exactly one copied Order. Fixed costs use `holds_listing=true`, `reservation_started_at=t`, `reservation_expires_at=t+30 minutes` and finalized money. Shipping pending uses `holds_listing=false`, NULL reservation timestamps and NULL shipping/fee/total; no inventory acquisition.
6. Mark Request Accepted with `accepted_at=t`; only fixed-cost inventory-holding Orders set Listing reserved and `reservation_order_id`. Shipping pending leaves Listing available. Insert request_accepted/order_created events and successful command reference.
7. Commit all or none. Return immutable snapshot plus authoritative current state.

Cross-buyer races serialize on the **same Listing row**. First successful transaction claims it; second sees reserved/holding Order and receives `LISTING_UNAVAILABLE` conflict (HTTP409 at future API boundary). Partial unique inventory claim is the DB race backstop; unique request_id prevents duplicate Orders. Conditional status updates must affect exactly one expected row. Unauthorized 42501, validation 23514 and internal uniqueness/serialization outcomes are mapped to stable public errors without raw SQL/provider text.

Other Buyers' Active Requests remain historical offers, cannot Accept while reserved/sold, and are not silently cancelled. They can become actionable if an unpaid hold releases, provided still unexpired. Rejecting a losing Accept must not mutate the losing Request or leak the other Buyer's identity.

## 6. Inventory reservation and deletion compatibility

Recommended first version: extend existing Listing status with `reserved`, add nullable `reservation_order_id` FK to Orders RESTRICT. The Listing row/status/pointer is authoritative inventory; the Order is authoritative reservation terms/deadline. Deferred consistency checks ensure reserved implies pointer to the same listing's open holding Order and at most one hold; available/sold have NULL pointer. These are one atomic state, not two independent APIs.

Fixed-cost Accept: available -> reserved. Shipping-pending Accept leaves available inventory unchanged. Trusted payment success: remain reserved, keep holds_listing even after the original deadline. Reservation timeout or unpaid cancellation: reserved -> available, clear pointer and hold only if pointer still equals this Order. Successful protection completion: reserved -> sold, clear pointer and hold. Issue keeps inventory reserved. Refund/relist decisions after paid failure are deferred to privileged resolution/provider design, never normal cancellation.

Sellers must not directly bypass reservations using existing status UPDATE, DELETE, or content edits. Future staging migration must revoke direct status UPDATE, introduce compatible verified-owner manual mark-sold RPC for unreserved listings, and add guards against editing/deleting a reserved/paid listing. Public available-only read remains compatible. Existing Listing mutation API must be adapted and regression-tested when implementation begins; this design does not change it today. Seller history/transaction read uses snapshots; Buyer must not need public access to a reserved/sold Listing.

Sold-listing existing TEXT/IMAGE conversations remain readable/sendable as before. No Orders path changes `marketplace_send_text`, IMAGE finalization or read-sequence semantics. No FK cascade from Listing/Profile/Auth may erase transaction history.

## 7. Expiry, cancellation and replacement contracts

Recommend **lazy authoritative evaluation plus a bounded scheduled server sweep**, using the same private transitions. Lazy actions ensure correctness even when a scheduled task is down. Scheduler ensures idle datasets eventually materialize expiry/completion. Time cannot be a CHECK constraint that automatically changes a row.

- Every pay/cancel/Accept-related command rechecks server time after locks. At `t >= reservation_expires_at` an unpaid Order cannot pay or cancel normally. Materialize `expired`, release inventory and write one event. Return a structured conflict result without raising after the expiry writes, or those writes would roll back. Request remains Accepted.
- Scheduled sweep processes bounded candidates with the common locking order, rechecks eligibility and is retry-safe. Record operational lag without secrets. Staging-only job activation and hosted scheduling capability review happen later; no job is installed now.
- Unfinished requests with elapsed schedules materialize Expired through lazy/create/replace/read-boundary evaluation and the same sweep. Read-only direct SELECT does not mutate; a future server list boundary may call the expiry evaluator or return effective eligibility separately.

| Proposed RPC / command | Authority and atomic outcome |
| --- | --- |
| `marketplace_create_order_request(conversation_id, terms, client_action_id)` | Verified real Seller; lock live Listing/conversation; derive Buyer; validate schedule/terms; reject unfinished same-Buyer+Listing Order and existing actionable Active; insert immutable Request + creation event |
| `marketplace_replace_order_request(old_request_id, terms, client_action_id)` | Same Seller/scope; explicit expected old ID; old must still Active/unexpired; old -> superseded with replaced_at/new ID, insert independent Active snapshot and replacement/creation events; no reservation/Order |
| `marketplace_cancel_order_request(request_id, reason_code, note, client_action_id)` | Real Seller only; Active/unexpired/no linked Order; -> cancelled, immutable reason/actor/time + event; terminal retry returns existing result only for matching command |
| `marketplace_cancel_unpaid_order(order_id, reason_code, note, client_action_id)` | Buyer or Seller; open, unexpired, no succeeded payment or unresolved live provider attempt; -> cancelled + snapshot/event, conditional release inventory, reservation_ended_at; Request stays Accepted |

Concurrent replacement vs Accept/cancel: same Listing/Request locks, recheck terminal state; losing command returns REQUEST_CHANGED409. No implied replacement when old ID changed. Expired old Request cannot be labelled Replaced. Client must refresh and explicitly choose a fresh creation action. Reason is a stable code plus historical label and bounded optional note, not arbitrary mutable UI copy. Initial length proposals: note1000, issue description2000, method/carrier120, tracking200; confirm during contract implementation.

## 8. Payment boundary and fee snapshots

No authenticated `mark_paid` function. Future provider adapter verifies signed webhook/authenticity, resolves its provider attempt, validates Order/amount/currency/money version, and invokes a private trusted success transaction. No browser amount/provider ID is trusted. Provider success is idempotent by payment identity plus command/webhook identity; conflicting payloads are quarantined for review, never overwrite succeeded facts.

The operator-only simulation recommendation is superseded. Future staging must provide an explicitly labelled **Buyer-only Simulate successful payment** action: exact staging/project guard, real authenticated Order Buyer, server-authoritative persisted transition, idempotency and normal Seller reads/refetch. No client mark-paid mutation or privileged browser key. Production must not expose the simulator; its deployment/server boundary is separate future design. Provider success remains a trusted server transition. No simulator exists yet.

Before trusting payment success: money finalized, shipping address present if shipping, Order open/unexpired, inventory pointer matches and payment attempt matches frozen total. Mark attempt succeeded + paid_at, Order paid_at/fulfillment awaiting_fulfillment, address locked_at, payment event in one transaction. Paid inventory remains held; reservation deadline no longer releases it.

Fee rule snapshot proposed `preview_cad_v1`: integer half-up 4% of item+fixed shipping, clamped100..1500 cents; seller fee0. Central private server calculator owns rule version, validation and overflow handling; all RPC/provider paths call it, never duplicate formula. The existing calculator is a versioned staging snapshot, not a provider integration. Locked V1 Seller economics: item earnings equal agreed item price; Buyer-paid shipping is separate Seller reimbursement; expected payout is item earnings plus shipping reimbursement; platform fee zero and processing costs are platform economics, with no hidden deduction. Store computed item/shipping/service/seller/total/currency/version in Order. Requests fix item/shipping terms; accepted Order fixes fee rule even if a pending quote finalizes later. Unknown pending shipping has NULL total, **not zero shipping**.

Real provider integration must handle asynchronous attempts before enabling production payment: live pending attempt blocks ordinary cancellation; timeout cannot simply release inventory while a provider may still succeed. Provider cancellation/reconciliation and late-success refund/hold policy are a separate mandatory design gate. Late success after authoritative expiry must never revive the Order, recreate its reservation, steal inventory from a newer Order or reactivate its Request. Use automatic refund where supported, otherwise persist refund/reconciliation-pending financial state; expired Order lifecycle and current Listing stay unchanged. The first staging synchronous simulator has no such external ambiguity, but its rules do not qualify a real provider rollout.

## 9. Handoff code and fulfillment

Locked V1 code: server-generated cryptographically random zero-padded six digits, bound to Order and Buyer eligibility, generated when eligible Buyer requests display after payment. Keep keyed digest over Order ID+code and encrypted ciphertext for repeat display; six-digit code space is too small for a bare unkeyed hash to resist offline enumeration. Server-only key required before implementation. Never log code, return to Seller, emit over Broadcast or store in general DTO/event.

Buyer retrieve contract checks verified membership, paid/open Pickup/Meet, not already confirmed, no blocking issue. Return code only through no-store server endpoint. Seller verify contract `marketplace_verify_handoff_code(order_id, code, client_action_id)` validates same Order, Seller, payment, fulfillment and rate policy, then atomically consumes control, sets fulfillment confirmed/handoff_confirmed_at/protection_started_at=t and protection_expires_at=t+24h, writes event. Never Completed immediately.

Proposed limits: five wrong attempts then15-minute lock; server rate limit additionally per Seller/Order/session/IP (avoid logging full IP in transaction history). Code24h lifetime from generation; expired code can be rotated by eligible Buyer with rotation throttling. Exact TTL, wrong-attempt threshold and lock duration are implementation security parameters, not further product approvals. Regeneration invalidates the old verifier; successful verification is single-use. Wrong attempts must **commit counters** using structured failure returns; raising an exception would undo accounting. Same verification command replay does not count again. Correct reused code after consume is not a new handoff; matching successful command returns existing milestone, other attempts return generic unavailable/invalid result. No existence/validity detail before authorization. Seller cannot regenerate/retrieve expected code.

Shipping first-version server actions:

- Buyer address submission only after Accept and before paid, inside Order lock.
- Seller ship requires succeeded payment/address, no blocking issue, nonblank carrier/tracking; snapshot shipped_at. This is seller-reported dispatch, not verified carrier evidence.
- `delivered_at` and evidence source must distinguish privileged staging simulation, admin evidence and later provider evidence. Do not let a browser freely forge carrier delivery.
- Locked receipt condition: trusted carrier/provider Delivered OR explicit Buyer-confirmed receipt starts 24-hour Protection. Either condition satisfies the Shipping confirmed-receipt milestone; do not require an additional Buyer confirmation after trusted Delivered. Buyer receipt does not require a prior Delivered event. Seller Shipped alone is insufficient. Old preview delivered-before-receive ordering is historical and cannot override this rule.
- Marketplace-protected Shipping requires valid tracking before Shipped. This does not require mandatory carrier/service selection in the Request editor or Buyer address before Accept; Request shipping method remains optional. Carrier/provider integration is technical future work, not a new tracking product decision.

## 10. Protection and issues

Same lazy+sweep approach for expiry: server locks inventory/Order/issues, captures time and, if payment succeeded/fulfillment confirmed/protection deadline reached/no open issue, sets protection elapsed and lifecycle completed, completed_at and completion_eligible_at, marks Listing sold, releases hold and writes one event. Order completion means completed fulfillment/Protection with no blocking issue and does not wait for provider payout Paid; Completed + Payout Processing is valid. The sweep is not a payout executor. Browser countdown reaching zero cannot complete anything.

`marketplace_open_order_issue(order_id, reason_code, description, client_action_id)` accepts either verified participant only after payment and before completion; within Protection requires `t < protection_expires_at`. Lock Order, materialize completion eligibility when deadline passed, enforce one open issue, insert issue/event. Issue prevents automatic completion/payout eligibility but preserves fulfillment/deadline facts. A report racing completion is resolved by server lock/time, not arrival order at the browser. Existing unresolved issue can remain held beyond24h.

Manual admin resolution uses separate audited private command. Proposed outcomes `resume_completion` or `manual_hold`; financial refund outcomes are deferred, cannot be simulated by changing Order to unpaid Cancelled. If resolved without financial dispute after elapsed deadline, run normal completion evaluator; otherwise continue remaining protection until original deadline. Concrete resolution commands and financial outcomes belong to the later audited server-side dispute workflow; V1 needs no multi-level appeal system. Existing open issues continue blocking applicable completion and payout remains On hold until resolution; mere clock expiry cannot release payout. No admin credential in browser.

## 11. Participant RLS / grants matrix

| Table | Read | Mutation |
| --- | --- | --- |
| order_requests | Verified live Buyer/Seller | Guarded Seller creation/replace/cancel and Buyer Accept only |
| orders | Verified live Buyer/Seller; safe common facts | Approved transition RPCs, never direct UPDATE |
| transaction_events | Verified current conversation participants, with matching Request/Order scope | Internal atomic append only |
| order_issues | Verified Order participants; admin private path | Participant open RPC; admin resolution only |
| order_payments | Verified Order participants, sanitized record fields only | Trusted provider/test boundary only |
| order_shipping_addresses | Buyer own Order; Seller only succeeded payment | Buyer guarded submit/edit prepay; pay locks snapshot |
| private handoff controls | No direct client SELECT | Eligible Buyer no-store retrieval; Seller submit verification; private attempt writes |
| private commands | No direct client SELECT | Internal command runner only |

Policies use `(select auth.uid())` and authoritative verified helper, matching repo style. Restrictive sensitive fields are separate tables, not hidden CSS or unrestricted rows filtered by JavaScript. Definer functions explicitly recheck authorization even though they bypass RLS. Revoke default PUBLIC EXECUTE; grant only required public RPCs to authenticated, trusted callbacks to the narrow server role, and none to anon. Use empty search_path and qualified references. Private schema usage alone never grants table access.

Order API wrapper later uses same-origin session/cookies, current server environment guards, no-store for personalized/address/code responses and stable sanitized errors. Production keys/environment are not read or changed in this design pass.

## 12. Idempotency / concurrency matrix

All participant mutators accept client_action_id generated once per intended action and retained across retries. Normalized-input digest excludes transport noise but includes meaningful terms/reason/quote/code digest. Authorization rechecks precede replay. No silent success for different content with the same key.

| Action | Race / constraint | Replay and conflict |
| --- | --- | --- |
| Send | Same scope creation; Listing/conversation lock + one Active partial unique | Same key returns same Request; new key while Active returns ACTIVE_EXISTS |
| Replace | Accept/cancel/other replace; expected old ID + locks | Same key returns new Request; changed old returns REQUEST_CHANGED |
| Cancel Request | Accept/replace/expiry | Same key same outcome/event; changed terminal state conflicts |
| Accept | Multiple Buyers; Listing lock, one hold, unique request_id | Same accepted Request returns its Order; other Buyer LISTING_UNAVAILABLE |
| Cancel unpaid | Pay/timeout/opposite participant | Matching replay returns same cancellation; different action after terminal conflicts; no second reason/event |
| Payment success | Duplicate/out-of-order provider callbacks | Provider identity+digest and unique success; different amount/version conflicts/review |
| Address / ship / receive | Pay or competing edits, double clicks | Expected Order version, ledger; locked address cannot edit; repeated milestone has one event |
| Verify code | Parallel guesses and double success | Order/control lock; attempt policy; consume once; successful replay no new protection time |
| Open issue | Completion/other opener | Order lock, one open issue; matching replay same issue; other opener ISSUE_ALREADY_OPEN |
| Expire / complete | Sweep/lazy/payment/issue | Recheck state/deadline/pointer under lock; terminal no-op; unique transition_key |
| Admin resolve | Duplicate resolution/completion | Expected issue state/version, privileged ledger, one event |

Order version increases only for actual state changes. Expected-version contracts protect address/tracking/admin edits; do not make stale client caches authoritative. Inventory release uses exact reservation pointer checks. Serialization failures can be safely retried with the same action key; cap retries at future server boundary.

## 13. Persistent timeline and Realtime

Recommend **dedicated transaction_events plus authoritative Request references**, not a new Messages type and not duplicated Order JSON in editable chat payloads. TEXT/IMAGE schema, message sequence allocation, read watermarks and immutable guards stay unchanged.

- Render each Request once at Request.created_at. `request_created` event anchors that rich item; don't also show an identical creation text row. Later events render at their own event.created_at, never move the original Request.
- Requests may show current terminal badge while immutable terms/creation position remain fixed. Details fetch authoritative Request/Order; events snapshot transition facts for historical explanation.
- Future history service fetches durable Messages and transaction events/references with stable `(created_at,kind,id)` ordering. Use each stream's cursor independently and merge at a common timestamp boundary; do not paginate Messages then append all transaction history, which produces gaps/duplicates. Tests must cover equal times, late fetch and interleaved paging.
- Transaction events do not consume message sequence or advance existing TEXT/IMAGE reads. First staging version keeps transaction-specific unread outside existing unread count; product decision required before adding separate transaction watermarks. Do not subtract combined sequence counters.
- Conversation list preview/activity may derive max(message activity, last transaction event); existing generated conversations.activity_at only sees messages and cannot be overwritten. Implement an additive query projection/event activity index later, preserving message last_message fields. Decide whether Request creation/other events should promote conversations before integrating list behavior.
- Extend existing private per-user invalidation/refetch architecture, authorize recipients from current participants and send only record IDs/scope; no terms/address/code. Reuse the mounted channel; no extra channel per Request/Order. Failure to emit must not roll back durable transaction; reconnect refetch recovers. Existing event consumer must explicitly recognize a new transaction invalidation scope/event before enabling it. No new realtime publication now.

## 14. Frontend migration / retirement map

| Actual file | Formal responsibility / retirement |
| --- | --- |
| components/home/order-visual-context.tsx | Replace authoritative React store/acceptedIds/timers with authenticated query cache, selection and drafts. Rename to Orders context when integration is approved; preserve separate Purchases/Sales boundaries |
| lib/order-interaction-preview.ts | Retire local add/replace/accept/cancel/pay/expire/handoff authority. Keep isolated dev simulator only if useful; server RPC adapter separate from pure presentation guards |
| lib/order-visual-preview.ts | Generalize DTO/display types, CAD formatters; retire authoritative client fee calculation. Server amounts drive payable summary; preserve NULL pending total |
| lib/order-presentation-preview.ts | Retain/generalize role-specific guidance and status adapter using server facts |
| lib/order-schedule-preview.ts | Retain UI validation/date/wheel helpers; server validates timezone/notice; remove browser authority over eligibility |
| components/home/order-countdown.tsx | Already display-only; retain, feed server timestamps/server time offset. Remove separate local expiry transition in detail/provider |
| components/home/order-request-preview.tsx | Retain editor/cards/confirmation/cancellation visuals; submit keyed commands, server conflict handling and genuine pending/error state |
| components/home/order-preview-forms.tsx | Retain forms; guarded server actions, no local payment/delivery invention |
| components/home/order-detail-preview.tsx | Retain approved layout/Stepper; server Order facts and role-safe actions; retire local handoff generation/protection advance/payment simulation |
| components/home/order-loading.tsx | Wire skeleton/error/Retry to real list/detail queries, no artificial delays |
| components/home/order-preview-controls.tsx | Remove from formal authenticated Orders UI; optional isolated staging developer harness only, no authorization meaning |
| lib/order-workspaces.ts | Retain real Buyer/Seller filtering as display convenience; backend participant SELECT is enforcement |
| lib/message-timeline-preview.ts | Generalize merge to persisted events/Request references; retain chronological grouping, no transaction message sequence |
| components/home/message-history.tsx / messages-chat.tsx | Reuse shared MessageRow sender/current-user alignment and timeline rendering; wire authoritative references/invalidation; preserve TEXT/IMAGE/read behavior |
| components/home/orders.tsx / animated-sidebar-demo.tsx | Keep Purchases/Sales navigation and frozen hierarchy; replace cache input only |
| tests/orders-*.cjs | Keep approved product invariants; add independent authenticated staging concurrency/RLS tests. Local perspective tests do not prove authorization |

No preview code is deleted or changed by this document. Do not use preview_role, request.body.role, local user IDs or simulated dataset switches as permissions. Real Buyer/Seller sessions must see the same persisted Order.

## 15. Historical migration and implementation sequence (superseded roadmap)

This sequence is retained only as the original technical proposal. Future financial
implementation follows phases A-H in the authoritative product contract; this
list does not authorize skipping account setup/readiness gates or deferring those
until after Buyer Accept.

Each future migration is a reviewed atomic transaction that creates tables **with RLS/revokes from the outset**. Do not deploy unprotected tables and add grants in a later exposed migration. Proposed groups below are sequencing descriptions, not authored migration filenames/SQL.

1. Core Request/event/command schemas, immutable guards, policies, create/replace/cancel contracts. Listing remains current model; no reservation yet. Staging Request history/refetch integration.
2. Orders/payment/address schemas and Atomic Accept, safe Listing reserved status/pointer/guards/compatible seller APIs, central fee calculation. Expiry/cancellation helpers and their tests must ship with Accept; do not enable a reservation that has no release path. Pending shipping payment stays blocked.
3. Activate reviewed staging bounded sweeps, reservation/Request expiry and unpaid cancellation integration, independent Buyer/Seller race tests. Common helpers already present in group2.
4. Separate staging-only trusted payment simulator and code controls/retrieval/verification. No production simulator migration; validate forbidden browser paid transitions before handoff.
5. Protection evaluator and issue/admin contracts, completion inventory transition, reviewed staging sweep extension. No payout API.
6. Shipping address/payment visibility, tracking/dispatch, trusted staging/admin delivery evidence, Buyer receipt. Quote negotiation remains a separate gate; pending costs cannot be paid until explicitly designed and confirmed.
7. Optional Google Places/map integration after snapshot/timezone policy and key/attribution review.
8. Real provider design/integration: pending attempts, webhook verification/idempotency, cancellation/timeout reconciliation, late payments, refunds/manual resolution and payout eligibility/execution. Separate production financial approval required.

Qualification gates per phase: exact staging environment/project guard; static migration inspection; DB privilege/RLS tests including outsider/anon; same-action replay/mismatched payload; two-Buyer Accept race; Replace/Accept race; Cancel/Pay and Issue/Complete races; worker failure recovery; deletion/snapshot retention; boundary server-time tests; existing Auth/Favorites/TEXT/IMAGE/Realtime regressions. Staging fixtures disposable/scoped; production data cannot be copied for tests. No emails necessary for operator-created disposable staging identities.

Production remains untouched at every schema application, simulator activation, fixture creation, job deployment, Google/provider integration and frontend rollout point. A later production preflight must separately review backup, hash, migration list, privileged grants, job/simulator absence and provider boundary; this design grants no production authorization.

## 16. Historical proposal questions and current closure disposition

| Decision | Proposed first staging position / risk |
| --- | --- |
| Pending shipping reservation | Locked: no hold/deadline at pending Accept. Seller quote + Buyer confirmation atomically finalize money, check available inventory and start 30 minutes; quote workflow remains not implemented |
| Shipping Request lifetime | V1 has no arbitrary age expiry; do not add an offer timeout from this historical proposal |
| Schedule timezone and Accept notice | Current staging: server Toronto calendar boundary, >=60min at Create/Replace, future-only at Accept, 30-minute fixed-cost reservation. This record does not authorize changing those rules |
| Failed handoff / missed appointment | Do not fabricate paid cancellation or completion; participants use the locked post-payment issue path. Audited resolution commands are future work |
| Code policy/key operations | Locked six-digit Order-scoped server verifier, single-use success, regeneration invalidates old code, rate limit/temporary lock. TTL/lock numbers and key/hash design are implementation security choices |
| Issue resolution and deadline | Both participants may report after authoritative payment and before completion where relevant. Timely open issue remains open/On hold beyond Protection deadline; later audited server resolution, no multi-level appeal requirement |
| Shipping delivered gate | Locked valid tracking before Shipped; trusted carrier/provider Delivered OR explicit Buyer receipt starts Protection. Seller Shipped alone cannot start it |
| Address retention | Isolated table protects access, but deletion/redaction window and audit retention need product/privacy decision |
| Account/listing deletion | Restrict transaction listing deletion and unfinished participant deletion; design terminal retention/anonymization explicitly |
| Transaction unread/activity | Existing unread remains TEXT/IMAGE only; additive transaction unread/list promotion requires product decision, not silent sequence changes |
| Media durability | Snapshot paths need retained assets or graceful unavailable state; no promise of historical byte retention from strings alone |
| Fee policy | Existing snapshot formula unchanged. Item-price Seller earnings + separate shipping reimbursement; Seller fee zero; no processing deduction. Provider/tax mechanics require technical financial integration work |
| Provider latency/late success | Locked: late success after expiry enters refund/reconciliation, preferably automatic refund; persist financial pending state if refund cannot complete. Never revive Order, reclaim Listing or reactivate Request. Provider processing is future technical work; staging simulation does not prove it |

Historical design-pass result: a concrete staging plan with unresolved gates separated from frozen preview behavior. That original pass made documentation changes only. The subsequent authorized Phase 1 record follows.

## 17. Formal Phase 1 staging implementation (2026-10-10)

**STAGING IMPLEMENTED / AUTOMATED TWO-ACCOUNT VERIFIED / AWAITING USER MANUAL VERIFICATION.** Stop here; Phase 2 is not authorized until the user verifies the main app flow.

### Applied database objects

Migration: [202610100001_order_requests.sql](../supabase/migrations/202610100001_order_requests.sql), applied only to `pcaqxezdfxofysghssyo`, recorded exactly once in `supabase_migrations.schema_migrations`. The default repository link was left unchanged; all CLI database operations included the explicit staging project ref. A pre-Phase-1 schema/history snapshot and SHA256, applied migration hash/manifest and browser result are in Git-ignored `tests/artifacts/order-requests-phase1/`. The schema snapshot is metadata, not a full logical data backup.

Tables: public.order_requests, public.transaction_events, marketplace_private.order_commands. Indexes cover Request conversation/participant histories, live Listing FK, replacement FK, expiry, unique Active scope; event conversation/Request histories and unique transition key; command Request FK and unique actor/action/key. RLS read policies are `order_requests_participant_read` and `transaction_events_participant_read`. No client/service-role direct table write grants. No Orders table, reservation columns or Listing status changes.

Public authenticated RPCs:

- `marketplace_create_order_request(uuid,jsonb,uuid)`
- `marketplace_replace_order_request(uuid,jsonb,uuid)`
- `marketplace_cancel_order_request(uuid,text,text,uuid)`
- `marketplace_order_request_history(uuid)`

Mutations derive `auth.uid()`/verified eligibility, lock Listing then Conversation/Request, derive actual participants, validate canonical terms and append events atomically. Seller-only permissions are enforced in SQL, not inferred from UI tabs. Replacement checks the explicit old Active ID; terminal transitions/terms are guarded. Command advisory locks plus persisted actor/action/key/input digest serialize identical retries and reject a changed payload under the same key. Unique partial Active scope enforces one Active per Buyer/Seller/original Listing; another Buyer may negotiate the same Listing independently.

### Intentional Phase 1 reductions from proposal

- No Orders prerequisite table is created. Event `order_id` is constrained NULL, and its FK/Buyer/admin event types will be added with Phase 2. Unfinished-Order gates must ship atomically with Orders/Accept before that feature is enabled.
- Request Accepted remains in the data model, but Phase 1 guards reject transition into it. There is no Accept RPC/API/button in formal mode.
- Phase 1 command actor keys are authenticated UUIDs; trusted provider namespaces and payment actions remain future work.
- Manual locations persist `location_source=free_text`/place_name and canonical scheduled_at/timezone; unavailable Places/address/coordinates remain NULL. No fabricated Google identity. Amounts are bigint cents, including zero; fixed shipping is zero/nonnegative, pending shipping amount NULL, no Order fee/total calculation.
- Server schedule validation uses America/Toronto, >=60 minutes from locked-action time, <=30 campus-local calendar days, quarter-hour boundaries and finite timestamps. The current UI date/wheel is reused unchanged.
- Lazy Request expiry is implemented in history and before authoritative mutations. History locks/rechecks membership, materializes Expired and appends an event. A failed mutator transaction may roll back its expiry write, but still rejects an elapsed Request; the next successful history evaluation persists expiry. Bounded scheduled sweep remains deferred to the next server-expiry phase; no large scheduler installed.
- Phase 1 history returns the complete conversation's Request/event stream in one authoritative RPC snapshot, merged with the existing paged TEXT/IMAGE stream. There is no arbitrary truncated transaction page. Large-history cursor pagination remains a required scalability step before large-volume use; currently the main browser fixture is small. No transaction unread/list-activity change.
- Shared presentation DTOs adapt persisted snapshots to existing Request components. The adapter does not confer preview authority. Historical media paths are retained metadata, not a new byte-retention promise.

### Pages API / frontend

`GET /api/order-requests?conversationId=...`; `POST /api/order-requests`; `POST /api/order-requests/:id/replace`; `POST /api/order-requests/:id/cancel`. Uses the existing authenticated SSR cookie client, same-origin write header/check, no-store responses and sanitized errors; no service-role bypass. Environment guard permits only staging exact ref, rejecting production/mismatch before network. Personalized endpoint is also NetworkOnly in PWA rules.

`hooks/use-formal-order-requests.ts` owns query/cache/load/error state, guarded against stale account/conversation/network results. MessagesChat uses API-returned sellerId and authenticated session UUID for the Seller menu; Buyer has only Attachment. Existing Request editor, DatePicker, Wheel, confirmations, cards and cancellation form are reused. Mutations await real server responses with pending/error feedback and stable action UUIDs across retries. Request status comes from server; the original created_at timeline position never moves. Cancel/replacement/expiry events render at their own immutable timestamps. Accept/local Order creation are unavailable in formal mode.

The frozen OrderVisualProvider is non-authoritative in main mode. It exposes no local Request/Order state or role override there. Explicit `ORDER_PREVIEW_MODE=frozen-viewer` is only supplied by the dedicated 3112 demo launcher; main `dev:staging` clears that flag. Formal mode uses the actual two authenticated staging users, never Preview Controls. All later transaction/payment/protection simulations stay isolated.

### Realtime

Request changes emit the existing `messages_changed` event on each participant's existing private `marketplace:messages:<uid>` topic, with only conversationId/role/history scope. It is an invalidation, not transaction truth. The mounted Messages connection dispatches a local invalidation notice to the Request query hook; receiving sessions refetch authenticated authoritative history. No second channel, publication or raw Request payload. Existing reconnect recovery also refreshes Requests; optional Broadcast failure does not roll back durable state.

### Verification evidence

- [Static boundaries](../tests/order-requests-static.cjs) and [API/environment checks](../tests/order-requests-api.cjs) pass.
- [Hosted rollback-only SQL tests](../tests/order-requests-staging.sql) pass Seller create; Buyer/outsider denial; participant RLS; forged/direct writes denied; <60min/>30days/non-quarter-hour/negative amount rejection; valid Pickup; Included/Flat/Pending; zero item/flat shipping; one Active; independent Buyers; replacement/stale replacement; immutable terms/timestamp/terminal history; create/replace/cancel replay; cancellation metadata/events; authoritative expiry/event; no Orders or Listing change. All these temporary mutations roll back.
- [Real two-account browser flow](../tests/order-requests-phase1.browser.cjs) on localhost:3000 passes Seller menu yes/Buyer menu no, normal Pickup editor Create A, Buyer realtime receipt without hard refresh, correct sender alignment, both refreshes preserving same ID/terms/time/status, Replace B, persisted TEXT between Requests, Cancel B with reason/event, fresh Active C, Buyer replace/cancel 403, no Accept and zero runtime errors.
- Dev server restarted with `npm run dev:staging -- --port 3000`. An automated stdin pause could not resume in the tool session; only that harness was cleaned. Read-only restart verification in two newly authenticated sessions then confirmed the same C ID/status/terms/created_at with no new Request mutation. This was a harness limitation, not an application/Auth defect.
- Existing durable IMAGE records remain readable in the demo; TEXT/IMAGE API and migration tests, Realtime lifecycle/client tests, Auth/session tests and timeline/local invariant regressions pass. DB lint on public/marketplace_private reports no errors. TypeScript, focused ESLint and browser privileged-secret scan pass; served chunks contain no service-role credential.
- Retained staging demo history for manual inspection contains 4 Requests / 7 events: an initial test Request cancelled on repeat-run cleanup, A Replaced, B Cancelled and C Active. No production fixture or Auth user was created. Listing status remains available/sold only; public.orders is absent.

Run main app: `npm run dev:staging -- --port 3000`; use existing Demo_seller_a and Demo_buyer_a in separate browser profiles. Open Messages Selling/Buying and the same Nike conversation. Credentials remain in the existing ignored source; never copy them into docs. Phase 2 still needs atomic Buyer Accept, Orders, inventory guards/reservation/release and authoritative reservation expiry. **No production DB/Auth/Storage access or changes, Google/payment integration, commit or push.**

### Manual-feedback compatibility follow-up (2026-10-10)

- View Listing Cancel now reuses the existing expanded-card destructive button/surface classes. The action sizing contract, overlay, focus handling and cancellation callback remain unchanged.
- Composer Add and Send share the scoped `--composer-action-size: 40px` token. Add remains square; the mobile grid uses the same token. Attachment and message-send behavior are unchanged.
- Selection investigation found no global `user-select: none` or mouse handler blocking editable controls. Before the correction, actual Chrome mouse drag selected Login email text and masked password text; typing replaced the selected range. The reported inability to select was **not reproduced as a selection-blocking application defect**. The global dark `::selection` background (`#23263b`) had poor contrast on dark form surfaces. A shared editable-only selection rule now uses the existing blue (`#007aff`) with white text. Native selection/caret behavior, password masking, button selection restrictions and wheel/drag rules are retained. If the user's browser still cannot drag-select, browser/extension-specific reproduction remains necessary; do not claim an unproven event-handler root cause.
- [Read-only two-account UI checks](../tests/order-requests-ui-compatibility.browser.cjs) pass at 390/430/1280/1536: equal 40px action heights, square Add, red View Listing Cancel, no page overflow, real Seller menu yes/Buyer menu no, no perspective controls, authenticated own/other alignment and zero runtime errors. Login email/password, Messages textarea and Seller Pickup location all support mouse selection and keyboard selection/replacement. Responsive checks reopen the conversation through existing mobile navigation after a width change; no navigation behavior was changed.
- Mobile viewport checks establish layout/editability compatibility in desktop Chromium, **not physical iOS/Android long-press handles**. Those native device gestures remain a manual verification item. No signup/email or Request write was performed by this compatibility suite; read acknowledgements are intercepted, and write endpoints are blocked.
- Fresh hosted staging rollback-only Request/RLS tests pass; DB lint reports no schema errors. Fresh persisted-history verification confirms the same stored Request after the previously performed dev restart. State remains 4 Requests / 7 events, no `public.orders`, and no new Listing status. TypeScript, focused ESLint, Request API/static, timeline, Auth/session, TEXT/IMAGE and Realtime regression tests pass. Browser scan covers 8 served chunks; commit-eligible scan covers 604 files with zero privileged/session secrets; credential sources remain ignored and the index is empty. Local documentation links and `git diff --check` pass. Existing global GlideSelect.jsx lint parser debt is unrelated and unchanged.
- No new migration, production access, production configuration edit, Order/reservation, payment/handoff/protection/Google integration, commit or push. Stop for manual localhost:3000 verification before Phase 2.

### Formal Request timeline cleanup (2026-10-10)

Formal MessageHistory projects only Request cancellation events as separate visible timeline items. Created/replaced/expired audit events remain persisted and available through authoritative history; they do not become chat notifications or ordinary TEXT rows. Frozen preview rendering remains isolated. The old centered cancellation card came from the generic preview-event renderer; formal cancellation now uses the existing MessageRow/bubble, historical event actor UUID, authenticated viewer UUID and a small Automatic notification label. Each cancellation event produces one item at its event timestamp, with reason and optional note. It is not editable or spoofable transaction truth.

Collapsed formal terminal Requests show badge and compact card only; duplicate reason/explanation paragraphs are removed. Active presentation and Seller Cancel action are retained. Expanded details expose status, cancellation actor/reason/note/time and replaced/expired timestamps from persisted rows. Original Request created_at, immutable terms, event timestamps and chronology are unchanged. No new schema, migration or RPC transition was needed.

Expiry has no Buyer-response or age-based deadline. Pickup/Meet request_expires_at equals scheduled_at; authenticated history evaluates status Active and deadline <= server clock_timestamp(), then persists Expired/event. Shipping scheduled_at and request_expires_at are NULL and stay Active across idle time, overnight and restart until an actual transition. The future 30-minute deadline belongs to an accepted Order's reservation, which remains unimplemented. Browser clocks never transition formal Request status.

[Timeline projection tests](../tests/message-timeline-preview.cjs), [two-account presentation checks](../tests/order-requests-timeline.browser.cjs), TypeScript, focused ESLint, Request API/static/RLS and TEXT/IMAGE/Realtime/Auth regressions pass. Real Demo_seller_a/Demo_buyer_a sessions at 390/430/1280/1536 read the same unchanged 4 Requests / 7 events: compact Cancelled/Replaced cards, cancellation right for Seller/left for Buyer, expanded cancellation metadata, immutable chronology, no overflow/runtime errors. The existing invalidation hook refetches unchanged authoritative history. No new persistent cancellation was performed in this presentation-only pass; live cross-account cancellation Broadcast was verified in the earlier Phase 1 E2E flow and its integration is unchanged. No expired fixture is retained: expired UI is tested separately with explicitly intercepted API responses in those real signed-in sessions; server schedule expiry and two-day Shipping non-expiry are tested in staging rollback-only SQL. This distinction must remain explicit.

Production is untouched. No Accept/Orders/reservation/payment/handoff/protection/Google work, commit or push. Stop for manual localhost:3000 inspection.

### Final Phase 1 timeline polish (2026-10-10)

The cancellation kicker now reads **Order update**, replacing Automatic notification while keeping the transaction-generated bubble distinct from manually authored TEXT. One shared MessageHistory separator handles TEXT, IMAGE, Request and cancellation items: first chronological display group gets a timestamp; following adjacent groups in the same full-date minute do not repeat it, irrespective of sender/type; each new minute/date gets one. Existing sender grouping remains, with same-sender messages split into display groups when the minute changes so a later minute is not silently hidden. Individual item order, IDs, created_at/event timestamps, actual messages and Request state are unchanged.

Minute-boundary, sender/type interleave and next-day tests pass. Real Demo_seller_a/Demo_buyer_a sessions at 390/430/1280/1536 verify right/left Request and cancellation alignment, compact terminal cards, Seller-only menu/actions, no Preview Controls/Accept and no overflow/runtime errors. Both sessions refresh and retain identical authoritative IDs/statuses/terms/events and complete TEXT/IMAGE/Request chronology. The refresh harness explicitly waits for both independently loaded histories; its initial early comparison was a test timing issue, with no application loading change. Invalidation/refetch, View Listing red Cancel, Add/Send 40px and native Login/composer/form selection remain verified. TypeScript, focused ESLint, Request API/static, timeline, TEXT/IMAGE, Realtime and Auth/session regressions pass. No backend/RLS/RPC/state-machine change, migration or persistent test mutation. Production remains untouched; no Phase 2, commit or push. Stop for manual localhost:3000 inspection.

# Authoritative Accept staging vertical slice

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

The [closed product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md) now defines pending
V1 terminal-list filtering and separate linked Order outcome presentation.
Request.status remains Accepted after Order expiry/cancellation; no second Accept.
Hidden default-list records remain persisted and historically accessible where
supported. This does not change the deployed Accept/reservation slice or its
historical evidence. Shipping quote confirmation has a locked future atomic
money/inventory/30-minute-reservation contract, but no quote backend exists yet.


Product precedence: the [finalized Payment/Payout contract](ORDER_PAYMENT_PRODUCT_DESIGN.md)
adds future account setup and payout-ready Request gating; neither that gate nor
payment transition is implemented by this existing Accept slice. Buyer saved
Payment method is not required before Accept. See [detail parity](FORMAL_ORDER_DETAIL_PARITY.md)
for the subsequent formal presentation/navigation pass. Shipping pending remains
no-hold, no countdown, no final payable total; existing backend semantics are unchanged.


Implemented on 2026-10-10 in the real localhost:3000 application, using only
western-marketplace-staging (`pcaqxezdfxofysghssyo`). Production is untouched.

The former Phase 1 boundary intentionally omitted Accept, Orders and reservations.
The user explicitly replaced that boundary with this minimal persisted Accept
slice. The isolated 3112 reference preview is unchanged and has no authority here.

## Implemented boundaries

`202610100002_order_accept.sql` is applied exactly once on staging. The Phase 1
migration hash remains `5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f`.
The applied Accept migration SHA-256 is
`b1473cc9ac9330e535e6a9eaa8efebd2f66c895d904bb13e3429a862c0f47d02`.

The database owns Orders, immutable versioned Request snapshots and CAD amounts,
participant/origin identities, reservation deadlines and append-only events.
Authenticated participants have SELECT only. Client role, amount, deadline and
status inputs do not determine Accept. Direct Order writes are revoked.

`marketplace_accept_order_request(request_id, client_action_id)` verifies Western
Auth and the actual Request Buyer. An idempotency advisory lock precedes Listing,
Conversation and Request row locks. The function rechecks identities, publication,
available inventory, Active status and future Pickup/Meet schedule after locking.
It inserts one canonical Order, accepts the original Request, claims inventory
when applicable and records events/command outcome in one transaction. Partial
unique indexes enforce one inventory hold per Listing and one unfinished Order
per Buyer/Listing. A retry returns the same Order; a losing competing transition
fails without an Order or reservation.

The request-history API supplies authoritative eligible Request IDs. Only the
authenticated Buyer of an eligible Active Request receives the expanded Accept
action. Seller and terminal Requests do not render it. The existing FadingDialog
shows immutable terms and no-charge copy. Cancel does not call a mutation.
Confirm uses an in-flight lock and a stable action UUID. Accepted remains at its
original timeline timestamp, with no subsequent Request Replace/Cancel/Accept.

`POST /api/order-requests/:id/accept` uses SSR Auth, exact staging guards,
same-origin mutation protection and no-store. `GET /api/orders?workspace=purchases`
or `sales`, and `GET /api/orders/:id`, return bounded participant DTOs. Orders
workspaces reuse the existing list/detail panels, ListingMedia and terms display.
The Orders API is excluded from PWA response caching.

## Reservation and shipping policy

Fixed-cost Pickup/Meet/Shipping use the database clock after locks:
`reservation_expires_at = reservation_started_at + interval '30 minutes'`.
Listing status becomes `reserved` with its authoritative Order pointer. Seller
cannot edit, mark sold or delete reserved inventory. Browser countdowns are
display-only, calibrated against server time, and never reconstruct a deadline.

The user clarified **Shipping pending does not occupy inventory**. Such Accept
creates an open shipping-pending Order and accepts the Request, but leaves the
Listing available. Shipping/fee/total and reservation timestamps remain NULL.
The dialog says Accept Order, explains no reservation, and the Order shows
Shipping cost pending without a payable total or countdown. Quote negotiation,
pending-Order cancellation and later inventory acquisition are not implemented.

Expiry release is lazy and server-authoritative: authorized Order workspace/detail,
Request history, Request mutation and Accept boundaries settle elapsed holds.
Orders mounted in the browser refetch every 15 seconds, as well as on private
Broadcast invalidation/reconnection/focus. There is no background scheduler in
this slice: an idle database row may retain the reserved status until the next
authorized boundary; a subsequent Accept settles an elapsed hold before claiming.
An expired Order remains historical and never reactivates its accepted Request.

Realtime remains minimal invalidation only. API refetch is truth. No raw Order,
terms, address, token or payment fields are broadcast. Messages and Orders mount
the existing private user channel with teardown on leaving/logout.

## Evidence

- Migration dry-run and rollback security tests passed before apply. A fresh
  post-apply rollback suite uses isolated backend-only synthetic Listings and
  preserves the real Nike Order. Buyer-only Auth, participant RLS, forbidden
  direct writes, snapshots, idempotency, reserved edit/sold/delete fences,
  server expiry release, overflow and Shipping pending no-hold tests pass.
- Concurrent independent transactions: Buyer A/B produced one Order/hold;
  Accept versus Replace, Cancel and Expire each produced one winning transition.
  All scoped race Listings/Conversations/Requests/Orders/ledger/events were deleted.
  Accept-first versus later Replace/Cancel is also covered by the rollback suite.
- Real Demo_buyer_a and Demo_seller_a independent browser sessions: Buyer Accept,
  Seller no Accept; Cancel made zero writes; confirmation made one Accept POST.
  Seller saw Accepted by Realtime refetch. Both participants saw Order
  `a5cda495-975a-4bd8-b15b-75f749a68285` in Purchases/Sales respectively.
  Refresh retained the ID and original deadline `2026-10-11T00:02:26.9258+00:00`.
  This real accepted Nike Order is intentionally retained for manual inspection;
  once that deadline passes its reservation is released on the next read boundary.
- Order UI at 390/430/1280/1536: no document overflow or runtime errors, no preview
  controls, no simulated payment actions. Existing terminal-card/timestamp and
  TEXT/IMAGE timeline regression checks remain separate.
- TypeScript and focused ESLint pass. Staging DB lint has no errors; it reports
  two volatility warnings for JSON construction in `order_money` marked IMMUTABLE.
  No unrelated database warnings were auto-fixed.
- Local Request/Accept static/API, TEXT/IMAGE API and migration contracts,
  Realtime client/migration, Marketplace session/Auth API, schedule/replacement
  and shared timeline tests pass. Two-account timeline and compatibility browser
  regressions pass at all four widths: authenticated alignment, terminal actions,
  red Listing Cancel, 40px Add/Send, native text selection and zero runtime errors.
  No real Auth email was sent. The optional standalone pending-username database
  test could not run because local `@electric-sql/pglite` is absent; no dependency
  was installed and Auth behavior was not changed.
- Documentation local file links and `git diff --check` pass. Git index is empty.
  704 commit-eligible/browser text files were checked against local privileged
  secret values without printing them; no leakage was found. Disposable generator
  scripts and CLI diagnostic logs were removed. Evidence screenshots/result JSON
  and the existing demo credentials remain Git-ignored.

No payment provider, paid simulator, shipping address, handoff, protection, Maps,
email, production operation, commit or push was introduced. Stop for manual
localhost:3000 inspection before extending this vertical slice.

## Tests

Use the existing ignored staging environment and demo credentials.

- `node tests/order-accept-staging-admin.cjs test`: isolated rollback-only suite.
- `node tests/order-accept-staging-admin.cjs race`: scoped committed race fixtures
  with mandatory cleanup; explicit staging project on every query.
- `node tests/order-accept-static.cjs` and `node tests/order-requests-api.cjs`:
  local source/API guards with mocked Auth transport, no hosted writes.
- `tests/order-accept.browser.cjs`: now delegates to the read-only manual-fixture
  browser checks. It never clicks Accept and blocks browser Accept requests.
  The earlier destructive Nike acceptance is historical evidence only; it must
  not be repeated against canonical manual demo conversations.

Artifacts and credentials remain under Git-ignored `tests/artifacts/`; never
publish session dumps or credentials. The real application starts with
`npm run dev:staging -- --port 3000` without modifying production `.env.local`.

## Manual-fixture repair and test hygiene (2026-10-10)

A read-only hosted audit plus real Seller A/Seller B/Buyer A API and DOM checks
found four verified canonical demo Auth/profile identities, six canonical Listings,
four canonical Conversations and no duplicate Buyer/Seller/Listing scope. The
schema already enforces `UNIQUE(listing_origin_id,buyer_id,seller_id)`.
Demo_buyer_b has exactly one Nike Conversation:
`55b385af-913a-42b5-9045-b67a277cc0c7`. No test-marker Listing or unintended
Conversation/Request/Order was found for deletion. Seller B legitimately has two
Demo_buyer_a Conversations, for Monitor and Textbook; their Listing context is
already displayed and must not be deduplicated by username.

The user corrected the report: the repeated name was **Demo_seller_b in Buyer
Buying**, not Demo_buyer_b. A fresh staging audit and real Buyer A API/mobile DOM
check resolve this as two legitimate seeded Conversations for different Listings:

| Seller B Listing | Conversation ID | Listing ID |
| --- | --- | --- |
| [DEMO] 24-inch Monitor | 08c740e5-48b4-40a1-926e-922eef639bc8 | cbbc071e-4ea5-447e-b048-e700187234f9 |
| [DEMO] Calculus Textbook | 82314c7a-97db-41c5-90a4-789f41103ab1 | 82680659-1f93-405c-a0b6-cebe52011498 |

Both match the original seed manifest/documented dataset and share canonical
Buyer A/Seller B identities. No repeated Buyer/Seller/Listing scope, API duplicate
or DOM duplicate exists. At 430px both Listing titles are visible in their own
conversation rows; desktop rows likewise include the Listing title, and collapsed
avatar controls include it in their accessible labels. Keep both Conversations.
The Textbook is sold historical chat; Monitor is available and contains the new
manual Active Request. No deletion, UI change or Accept was performed during the
corrected-direction audit.

A separate concrete test hygiene gap was found: disposable Conversation INSERTs invalidate mounted lists,
but deletion has no application DELETE Broadcast trigger. An already mounted
session can retain a now-deleted test row until its next canonical list refetch.
This gap is not the cause of the now-corrected two legitimate Seller B rows.
Race cleanup now sends the existing private minimal invalidation in its deletion
transaction, and a canonical demo navigation invalidation was issued without
changing transaction rows. No username deduplication or application UI change was
made. Concurrency cleanup also waits for every in-flight operation to settle on
failure, and registers fixture IDs before network setup to handle lost responses.

The accepted Nike Request `491172d7-ec03-4de5-ac1a-11587409fa3f` and Order
`a5cda495-975a-4bd8-b15b-75f749a68285` remain intact. At this audit the Order's
original reservation had already expired: Order lifecycle is expired, inventory
released, Request still Accepted. Both participants can still read that Order.

Exactly one new persisted manual Request was created using the **existing**
Buyer A / Seller B / Monitor Conversation, without creating an Auth user,
Listing or Conversation:

| Field | Value |
| --- | --- |
| Seller | Demo_seller_b |
| Buyer | Demo_buyer_a |
| Listing | [DEMO] 24-inch Monitor |
| Conversation | 08c740e5-48b4-40a1-926e-922eef639bc8 |
| Request | 88260b5b-0851-4bf2-a100-8a5c11edd8c9 |
| Price / Pickup | CA$120 / UCC main entrance |
| Schedule | 2026-10-12 20:00 America/New_York (2026-10-13T00:00:00Z) |
| State | Active; no Order, no reservation |

Buyer A sees Accept when opening the expanded Request; Seller B does not.
Both refreshes retain identical Active terms. Browser Accept calls were zero.
The Request is left untouched for manual testing. Final persistent counts:
four Auth users/profiles, six Listings, four Conversations, 19 messages including
one IMAGE, six Requests, 13 transaction events, one historical Order and one
manual Active Request. No existing records were deleted. All isolated regression
fixture scopes were cleaned; final test-marker residue is zero.

`tests/order-manual-fixture-staging.cjs audit` is read-only. `prepare` checks
canonical server markers, Listing eligibility and existing conversation scope,
creates through the normal authenticated Seller RPC and records a local ignored
journal. Repeating it reuses the same Active manual Request; after its state
changes it stops rather than automatically replacing/recreating it. Do not run
seed/cleanup to wipe this manual state. Browser tooling/credentials/evidence remain
ignored. Atomic Accept, Shipping pending, RLS and the application UI are unchanged.

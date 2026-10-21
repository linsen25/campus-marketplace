# Business V1: complete logic audit

Usual & Unusual. 2026-10-18. Source: CURRENT LOCAL WORKTREE, not only HEAD.

This is inspection and planning, not business implementation or production certification. No application code, API, migration or business rule was changed during this audit. No live payments, emails, remote writes, production access, staging writes, Git staging, commit or push. Earlier UI acceptance work remains in the worktree; this audit does not silently certify completion of every earlier freeze requirement.

Repository observation: during the audit HEAD advanced independently to `d9d4bb97aa92d7df36d5139b791da044edd98ab7` (`feat: finalize and freeze UU UI V1`). This agent did not create that commit. The final audit references the current frozen source plus these documentation-only additions; it does not reset or rewrite that history.

The supplied attachment ends mid-sentence at journey 11, “Shop statistics reflect authorized”. All supplied requirements and discovered routes are covered; missing product requirements have not been invented.

## Evidence and status rules

- **WORKING (contract)**: executable offline tests exercised actual implementation with controlled transport and meaningful validation/authorization assertions. This does NOT mean the deployed database, provider, RLS or complete multi-user journey was tested.
- **PARTIAL**: real implementation exists, but a material adapter, operation, rollout or end-to-end verification remains.
- **UI ONLY**: controls exist without the required persistence/authority. **DEMO / MOCK**: fixture or local-state data. **NOT IMPLEMENTED**: no positive capability found. **UNVERIFIED**: insufficient executable evidence. **BROKEN**: reproduced defect, not an intentional permission denial.
- Source-only SQL/state machines are not marked fully WORKING. Merely finding a staging test is not evidence it passes. No hosted DB suite was run in this audit.
- [Complete source index](BUSINESS-V1-SOURCE-INDEX.md): 47 Pages Router page/API files, 63 migrations, 55 table creation names and 207 last CREATE/REPLACE function names. These are source inventory counts, NOT deployed object counts or final ACL conclusions. Later ALTER/DROP, overloads and dynamic SQL still matter.

## Architecture

Next.js Pages Router, React, TypeScript, public-page SSR, same-origin Next API routes, Supabase Auth/Postgres/Storage/Realtime. `pages/_app.tsx` composes MarketplaceSessionProvider, AuthModalProvider, DesktopRouteTransitionProvider, ProfileLogoutProvider and NotificationsProvider. Home is a section-based workspace; a rendered menu destination does not imply a separate backend feature.

`lib/supabase/server.ts` creates the request-cookie SSR client with public key and private/no-store responses. `lib/server/marketplace-auth.ts` calls getUser, requires verified @uwo.ca and derives server identity. Same-origin writes require the custom request header and matching Origin host. UI visibility and CSRF checks do not replace participant/owner authorization.

Business authority lives in versioned SQL RPCs, constraints and triggers, with participant checks, command UUIDs, immutable terms/media/events and row locking. API field whitelists reject forged actors/status/economics. Private tables revoke browser grants; privileged RPCs require explicit caller checks and safe search_path. RLS alone does not prove a privileged worker is safe.

Environment boundaries are significant: Offers/Orders use the staging-only `requireOrderRequestEnvironment`; financial setup, several notifications/analytics paths and Places are staging-gated. Messages explicitly validates the configured environment/project. Stripe is test-mode setup only. Do not globally remove guards to make a deployment appear operational.

## Schema, permissions, storage and realtime

| Domain | Existing records/authority | Boundary |
|---|---|---|
| Identity | profiles, username_history, pending_signup_controls, username/pending-signup RPCs | Public profile whitelist differs from private Auth identity. Avatar persistence absent. |
| Listings | listings, listing_images, listing_favorites; publication/taxonomy/inventory/channel locks | Latest channel migration publicly exposes published available Resale; owner policies separate. No client channel mutation; Shop finalize denies. |
| Messages | conversations, messages, image submissions/images, first contacts, withdrawals, cleanup | Participant RLS/RPCs, private image access, immutable submission identities. |
| Offers/Orders | order_requests stores Offers; orders, transaction_events, command tables, order_agreements | No separate public.offers table. Participant authority, atomic acceptance, held inventory, frozen snapshots. Protocol versions remain distinct. |
| Fulfillment | inspections, meetup revisions/expiry, checkout/address/start, shipment/receipt, handoff, protection/cases | Role/time/state gates. Scheduler deployment is separate from a SQL function definition. |
| Financial | financial_capabilities, campus_payment_attempts, v2_order_economics, cancellation/settlement authorizations, external_exchanges | Attempt, authorization, eligibility and provider execution are different facts. |
| Stripe setup | stripe_bindings, stripe_setup_operations, stripe_webhook_inbox | Service-only setup bindings, signed events, leases/retries. Not real Order charging. |
| Notifications | notifications/preferences; private source events/deliveries/reminders | Recipient mutation separate from immutable source audit; claim/finish and idempotency already exist. |
| Analytics | account_activity_events and own aggregate RPC; real category aggregation | Account analytics real; Shop analytics/expenses fixture-only. |
| Shop | public.shops owner profile | Owner SELECT and whitelisted UPDATE; no provisioning, activation, public SELECT, trial or subscription authority. |

Storage: `listing-images` uses generated owner/listing/media UUID paths, byte/MIME checks, immutable published images and no overwrite policy. `chat-images` is private participant media; `order-snapshot-media` holds independently copied, hashed private snapshots. Never reconstruct frozen Order images from current Listings. No avatar upload/bucket command was identified. No object deletion was performed.

Realtime: `lib/messages-realtime.ts` uses a verified short-lived session bridge, private own-user topics, reconnect/coalesced canonical refresh and logout cleanup; Notifications uses the same delivery family. Broadcasts invalidate/read canonical data rather than create an independent authoritative database. Offline client tests do not certify deployed publications or socket ACLs.

## Every discovered user-facing route

| Route | Actual purpose | Business boundary |
|---|---|---|
| `/` | Welcome and interactive demos; browse SSR props where wired | Prototype inventory/figures are not real transactions. Development hero fixtures isolated. |
| `/home` | Profile/Settings, management, Messages, Orders, Notifications, Analysis | APIs enforce own identity even though the shell can render. |
| `/listings` | Resale/Shop browsing modes | Real Resale; Shop public source empty and explicit demo workspace. |
| `/listings/[id]` | Direct real Listing detail | Anonymous/owner visibility differs; no forced availability. |
| `/listings/new` | Compatibility creation entry | Shared form and existing authenticated authority. |
| `/listings/[id]/edit` | Legacy direct owner editing | Still exists; current Manage Resale uses modal instead. |
| `/profile/listings` | Legacy owner management | Owner/session guards remain relevant. |
| `/seller/[id]` | Public UUID/username Seller alias | Anonymous whitelist; no legal/email/financial data; avatar currently null. |
| `/shop/[username]` | Canonical future public Shop page | Currently 404 because getPublicShop returns null. |
| `/auth/sign-in` | Compatibility opener for same Auth modal | Safe next-path handling; not a second auth system. |
| `/kit/banners`, `/kit/buttons`, `/kit/chips` | Design examples | Demo interactions, not business commands. |
| `/_offline` | Generic fallback | No offline transaction or payment-write authority. |
| `_app`, `_document` | Framework composition/metadata | Not separate business pages. |

All API routes, including legacy order-requests, realtime bridge, image upload, financial test-state, Stripe three webhook channels/worker and Places, are in BUSINESS-V1-SOURCE-INDEX.md. Routes are not omitted because navigation no longer links them.

## Page-by-page feature trace

Tests below refer to the fresh offline run unless explicitly described as prior evidence. Paths are relative to repository root; source index gives RPC/migration locations.

| Area / feature | Status | Implementation and authority | Gap / evidence limit |
|---|---|---|---|
| Signup/OTP/resend/pending username | PARTIAL | pages/api/auth/[action].ts → Supabase Auth, server/auth-username.ts, pending-signup.ts and pending_signup_controls | Real transport tested; resumability explicitly staging-only. No fresh real mail/signup E2E. |
| Password login/session | WORKING (contract) | auth.signInWithPassword → requireMarketplaceUser; SSR cookies | auth-modal-api passes with real SDK/mocked HTTP. Live expiry/refresh not rerun. |
| Logout | WORKING (contract) | signOut(scope:local), pending ticket clear | Not an all-device logout guarantee. |
| Forgot/reset password auth flow | PARTIAL | recover/reset-password in same auth dispatcher | API exists; real recovery mail and full reset not run here. Distinct from Settings control. |
| Profile account read | WORKING (contract) | /api/profile/account → own profile/Auth projection | nextUsernameChangeAt returns null until mutation response; no canonical read timestamp RPC. |
| Change username | WORKING (contract) | profile-overview saveUsername → /api/profile/username → RPC uniqueness/cooldown | profile-polish-api passes; availability is advisory. UUID identity retained, aliases change. |
| Avatar Save | UI ONLY | AvatarDialog → animated-sidebar-demo saveAvatar → URL.createObjectURL/React state | No Storage upload or DB reference; reload loses it. Public seller avatarUrl=null. |
| Settings Change password | UI ONLY | profile-overview.tsx explicitly disables Save when kind=password | Current/new/confirm inputs do not submit a real credential update. |
| Notification preferences | WORKING (contract) | /api/notification-preferences → per-key preferences RPC | Partial updates, latest-intent queue, independent rollback; staging gate. API tests pass. |
| Payment Method setup | PARTIAL | stripe-setup startCardSetup → Customer/SetupIntent, private bindings | Real test-mode account setup; no charge/PaymentIntent executor. Live CA/US/CN not rerun. |
| Payout setup | PARTIAL | startPayoutSetup → Accounts v2 hosted onboarding/reconcile | Readiness is not an actual payout. Public Seller URL validation separate from localhost return origin. |
| Home navigation | WORKING (UI contract) | animated-sidebar-demo group/section source and shared guards | Some selected modules are fixtures; navigation does not create capability. |
| Resale published feed | WORKING (contract) | SupabaseListingsRepository, publishedAt/status/channel predicates and RLS | Public available Resale only; owner/history reads differ intentionally. |
| Search/filter/sort | WORKING (contract) | MarketLayout + market-search client filters/sort; repository supports server predicates | Client currently fetches all available rows in100-item batches before local browsing. Functional but scales poorly. |
| Pagination/refresh | PARTIAL | MarketListingFeed slices15, mobile batching; full-feed refresh with stale-request guards | Not bounded query-per-page discovery; do not incorrectly assume only SSR20 loads. |
| Card/expanded media | WORKING (presentation contract) | mapper ready paths → PublishedListingCard → ListingMedia/ImageSlider | Prior actual staging image verification exists; current audit runs no Storage mutation. |
| Listing Favorite | WORKING (contract) | favorites API → listing_favorites own relation, idempotent insert/delete | Owner/nonavailable disallowed; persistence architecture real. Fresh live toggle/reload not run. |
| Direct Listing buyer actions | PARTIAL | pages/listings/[id].tsx, useMessageSeller/useListingOfferContext | Connected actions exist; standalone legacy detail presentation differs from expanded card. |
| Public Seller navigation | WORKING (contract) | server/public-seller anonymous UUID/username lookup + whitelist + page24/lookahead | public-seller tests pass; no private fields or persisted avatar. |
| Manage Resale Active/Sold | WORKING (contract) | HomeListings → channel-scoped getMyListings; status projection | UI classification does not release reserved inventory. |
| Create/upload/publish | WORKING (contract) | create draft → /api/listing-images/[id] → finalize RPC | Owner, signature/MIME/3MB/1–6, ready/manifest checks. No fresh hosted publish performed. |
| Edit existing Listing | WORKING (contract) | owner available/published UPDATE, shared5-step create/4-step edit wizard | Same ID; media/category/subcategory/channel immutable. Legacy direct route remains. |
| Delete/Mark sold | PARTIAL | owner repository commands + inventory constraints | Real commands; post-delete Storage cleanup failure/retry and held-inventory races need live verification. |
| Category/Subcategory/Condition | WORKING (contract) | listing-validation + taxonomy constraints/triggers | Required Subcategory/valid pair remain; no hidden default relaxation. |
| Meeting/Delivery/payment preference | WORKING (contract) | listing validation + dual-payment migration/terms | Meeting uu_pay/external, Delivery UU-only. Current required location remains visible; legacy enums compatibility only. |
| Google autocomplete | PARTIAL | server/places-service + authenticated API, final text/optional placeId | Staging guard, bounded input/token/field-mask/rate checks pass. No real provider query run. |
| Buying/Selling conversations | PARTIAL | session repository → participant conversation/history queries | Real implementation; fresh multi-user retrieval/send E2E not performed. |
| First contact/reuse | PARTIAL | existing conversation lookup → marketplace_contact_seller/find_or_create | Source has idempotent first-contact domain; no fresh hosted concurrency run. |
| TEXT send/history/mark read | PARTIAL | marketplace_send_text, client UUID, sequence mark-read RPC | Sender derived server-side; real persistence exists. Live two-account delivery/read not newly verified. |
| Realtime/unread | WORKING (client contract) | messages-realtime private own topic, canonical refresh | Offline actual client tests pass; deployed realtime socket policy not tested here. |
| Message images/withdraw/gallery | PARTIAL | message-image-service, private Storage/hash/signing, withdrawal RPC | Transport tests pass; live orphan cleanup/storage race/device checks remain. |
| Offer/counter/revise | WORKING (contract) | offers-service → submit_offer with terms/kind/comparison/action UUID | offers-api/dual-payment tests pass. Existing SQL enforces roles/lifecycle; no new duplicate proposal system needed. |
| Deny/withdraw/accept eligibility | WORKING (contract) | API whitelist → recipient/sender RPC rules | UI button visibility not permission authority; forged identities rejected. |
| Accept → Agreement/Order | PARTIAL | accept preflight → hashed private snapshot media → accept RPC | Atomic winner/hold/frozen terms/provenance exists. Live concurrent accept/failure-recovery not rerun. |
| Purchases/Sales Active/History | WORKING (projection contract) | orders-service workspace/detail, participant projection | Multiple protocol versions retained; provider finance execution absent. |
| Two-party Agreement confirmation | PARTIAL | order_agreements + confirm_order_agreement RPC | Same frozen terms, both confirmations; preserve paid/history. SQL behavior not freshly run against DB. |
| Payment Pending/Processing/Paid/Failed | PARTIAL | authoritative attempt/status RPCs; trusted staging resolver | Order payment explicitly503 when Stripe setup enabled; no real provider charge execution. |
| Meeting proposals/inspection/no-show | PARTIAL | orders-service meetupAction/campusAction + latest SQL guards | Real schedule/expiry/hold authority; deployed scheduler/DB races unverified. |
| Seller Delivery | PARTIAL | checkout/address/start/cancellation RPCs and records | UU-only. Not an external carrier/driver platform; live transitions not rerun. |
| Courier shipment/receipt | PARTIAL | record_courier_shipment / confirm_courier_received | Manual seller tracking + buyer receipt, no automatic carrier integration found. |
| Buyer QR/code → Seller verify | WORKING (API contract) | buyer issue, seller verification, TTL/single-use/lockout/action UUID | handoff-qr contract tests pass; camera hardware/live redemption not rerun. |
| Protection/completion/payout eligibility | PARTIAL | order_protection/cases + due-work functions and gates | Eligibility is not transferred money; scheduler deployment/execution unverified. |
| Cancellation/refund authority | PARTIAL | cancellation_intents, settlement_authorizations, flow commands | Existing financial rules/snapshots must be reused; authorization is not provider refund. |
| Report issue/dispute | PARTIAL | Buyer-only open_protection_case + holds; external disagreement separate | Full operational case resolution/adjudication not demonstrated. Do not grant Seller control merely to match UI. |
| External exchange completion | PARTIAL | external_exchanges + immutable role attestations/events | Both → Completed/Sold; one → no ordinary cancel/expiry/reopen; disputed hold. No Paid/QR/Protection/payout. Offline checks pass, DB race unverified. |
| Frozen Order history/media | WORKING (transport contract) | order-snapshot-media → participant signing; versioned mapOrder | Hash/retry tests pass; current Listing title/photo changes never rewrite history. |
| Recommended Shops/ranking | DEMO / MOCK | recommended-shops-demo + slider/local metrics | Not a real recommendation/rating/review authority. |
| All Shops | PARTIAL | workspace supports real props; public-shop source returns[] | Existing five demo identities and pagination UI; no eligible public Shop query. |
| Shop Detail/destinations | PARTIAL | /shop/[username] source=null; Luna in-place demo | Real route404; other four demo Go to shop handlers no-op. Do not invent fake destinations. |
| Shop-card hearts | DEMO / MOCK | recommended/directory useState | No Shop-entity favorite relation/API; reload loses it. |
| Home Shop Favorites | PARTIAL | HomeListings → Favorites channel=shop → Listing favorites | PRODUCT favorites, not Shop-entity favorites. Master–Detail Shop list/detail UI absent. |
| Popular Shop Products | PARTIAL | shop-products getListings channel=shop available page25+lookahead | Public RLS denies Shop until eligibility; optional empty-success demo fallback. Newest is not popularity ranking. |
| Shop product actions/provenance | PARTIAL | shared Listing actions + frozen Order/Conversation/Notification provenance | Positive public publication missing; existing transaction architecture should be reused. |
| Owner Shop profile GET/PATCH | WORKING (contract) | shop-profile-repository → own shops row/RLS, field whitelist | Existing row only; no activation/provisioning. shop-profile tests pass. |
| Create/activate Shop | NOT IMPLEMENTED | Shop migration expressly has no INSERT/DELETE/public grant | Pricing click/profile existence must not grant a Shop. |
| Shop Settings persisted editing | UI ONLY | shop-settings optional fixture onSave, explicit fixture copy | Owner API exists but normal editable persisted UI not wired. |
| Manage Products CRUD | PARTIAL | HomeListings channel-scoped owner query/shared CRUD | Empty-success renders6 local demo products. No quantity/SKU inventory model implied. |
| Add Product / publish | PARTIAL | shared form; immutable channel; finalize rejects Shop | Positive create-in-Shop command/eligibility missing; no fallback ordinary Resale creation. |
| Plus/Pro subscription/trial | UI ONLY | PricingCard selection/CTA/badge display | No checkout/subscription grant/expiry/free-trial authority. |
| Entitlement restrictions | PARTIAL | Shop publication denied by SQL | Negative fail-closed guard exists; positive tier/usage/expiry system absent. |
| Profile Activity | WORKING (API contract) | own activity RPC + intentional-open event ID, owner exclusion | Real Views/Listings/Sold;24 rolling hours/Toronto days. Staging-only, live totals not reconciled here. |
| Marketplace Trends | WORKING (API contract) | paginated published/available category aggregation | Current RLS governs scope. Not a historical popularity time series. |
| Shop Analysis/revenue/statistics | DEMO / MOCK | loadShopAnalysisFixture and local access variants | Arithmetic tests pass, but no real owner-scoped endpoint/ledger. |
| Expenses/product costs | DEMO / MOCK | ShopAnalysis local expenses state → fixture calculations | No real expense CRUD/table/cost snapshot authority identified. |
| Notifications read/delete/filter | WORKING (API contract) | recipient RPCs, stable cursors, filtered scan/global unread, batch500 | Feed deletion does not delete immutable source audit. API tests pass. |
| Notification creation/realtime/navigation | PARTIAL | existing domain projectors, broadcast, access-safe destination resolver | Listing direct detail, correct Order/Conversation IDs; live recipient delivery not rerun. New billing events absent. |
| Resend transactional email | PARTIAL | durable claim/finish, provider idempotency/message ID/audit, preferences | Offline worker tests pass; prior sandbox send historical only. No new send/production certification. |
| Welcome/kit/offline | DEMO / MOCK / UI ONLY | isolated prototypes/design pages/offline heading | No commerce authority; offline cannot assert a successful write. |

## Confirmed gaps versus defects

Avatar persistence, Settings password submit, positive Shop activation, persisted Shop favorites, real Shop analytics/expenses and real Order money execution are confirmed missing/partial capabilities, not reasons to rewrite working state machines. Intentional503/404/fail-closed outcomes are NOT security bugs.

No new BROKEN business flow is claimed solely from static inspection. Existing UI test debt and limits remain in UI-V1-HANDOFF.md. Shop return-scroll test formerly sampled the document during View All scrolling; current acceptance test waits for the existing section anchor, retains the same <40px return assertion, and now passes all five widths/both motion modes. That is test synchronization, not a new business capability.

## Complete journey traces

| Journey | Existing path and persistent boundary | First missing/unverified boundary | Outcome / next task |
|---|---|---|---|
| 1 Register → Login → Profile → Settings | Auth code/verify/password → verified user/profile → SSR session → own account/settings APIs | Real email verification/session expiry not newly run; Avatar Save local; Settings password disabled | PARTIAL. Qualify auth E2E, then implement avatar/password separately (B02–B04). |
| 2 Seller creates Resale → Buyer views | shared wizard → validated draft → image upload/ready → finalize → public available query → card/detail | No fresh dual-user DB publish run; byte/storage rollback and concurrency operational checks still needed | Real complete implementation path, UNVERIFIED end-to-end this audit. B05 qualification, not new CRUD. |
| 3 Buyer favorites → reload | authenticated favorite API → unique user/listing row → reload Favorites/state query | Fresh hosted reload not run; own/nonavailable rejects correctly in contracts | WORKING contract, E2E UNVERIFIED. B05 exact-user RLS/reload matrix. |
| 4 Contact seller → two-way exchange | existing conversation reuse/contact RPC → first-contact event → send_text UUID → messages rows → private broadcast → history/read sequence | Fresh concurrent first-contact/two sockets/message/read/reconnect not run | PARTIAL evidence; B06 DB/realtime acceptance. No second messaging backend. |
| 5 Offer → Counter → Agreement | submit_offer/kind/comparison → opposite participant → counter/revise → recipient accept preflight → private media batch → accept RPC | Hosted accept/media-copy races not rerun; uu_pay seller readiness may deny by authority | PARTIAL evidence. B07; do not bypass readiness or mutate history to make a demo succeed. |
| 6 Agreement → Order → fulfillment → completion | Accepted Offer creates Order before Order Agreement acknowledgements; both confirm same frozen terms; role-specific stages/RPCs | Agreement completion does not imply Paid. Paid uu_pay path lacks real provider execution; external completion has real RPC but fresh race E2E unverified | Separate uu_pay and external acceptance (B08/B09/B20+). |
| 7 Pay → Protection → release/refund | versioned economics → payment attempt → provider-independent settlement/eligibility → protection/case/cancel state | Real provider charge is missing; staging success resolver is not payment. Refund/transfer/payout executors also missing | NOT IMPLEMENTED as a real-money journey. B20–B25 in order; preserve domain rules. |
| 8 Activate Shop → create product → public listing | owner shops row read/update, shared channel-scoped UI, finalize fail-closed | First missing boundary is positive Shop provisioning/entitlement; then publish and public projection | BLOCKED by BUSINESS V1 capabilities B10–B15. Do not convert badge/UI to authority. |
| 9 Shop product purchase → inventory/status | frozen Shop provenance, shared Offer/Order/hold/complete primitives already exist | Real public eligible product journey cannot start normally yet; funds executor also absent for uu_pay | Reuse transaction lifecycle after B15; B26 adds cross-channel tests, not a second Order system. |
| 10 Domain event → recipient → correct destination | SQL projector → source event/notification/outbox → own-topic refresh/feed → safe resolver → exact Listing/Order/Conversation | New Shop billing event producers absent; live realtime/worker schedule not freshly proven | Existing contract tested, end-to-end PARTIAL. B27/B28 hook only newly authoritative events. |
| 11 Shop statistics reflect authorized activity | deterministic fixture calculations + actual account analytics event model | No real Shop-scoped authorized sales/expense projection; fixture tier != authorization | DEMO only. B17–B19. No inferred definition beyond supplied incomplete requirement. |

### Locked lifecycle/economics rules carried into the plan

- Meeting may negotiate uu_pay/external before acceptance. Seller delivery and Courier remain uu_pay-only. Existing Orders retain frozen uu_pay semantics; legacy active Offers default uu_pay and may only change via a new allowed proposal. No mode change after Order creation.
- uu_pay requires Buyer payment readiness only at actual payment attempt; existing Seller payout readiness applies where the server Offer/Accept authority requires it. Buyer Protection fee/versioned historical economics remain unchanged.
- External Meeting omits Payment, Handoff QR/code and Protection stages, fees and UU payout/refund/financial settlement. Both role attestations required for Completed/Sold; one attestation blocks ordinary cancel/automatic expiry/inventory release. Disagreement keeps inventory held, without UU financial adjudication. Never set payment_status=paid for external exchange.
- Agreement both-party acknowledgement, role checks, receipt/handoff, protection/cancellation timing and completed inventory rules are already implemented domain contracts, not decisions to reopen. No test can authorize a bypass.

## Executable evidence collected in this audit

All30 selected offline tests passed; no test source, assertion, loader or application behavior was modified to obtain these results. Logs and result JSON stay under ignored tests/artifacts, not source dependencies.

| Tests | What they establish | What they do not establish |
|---|---|---|
| auth-modal-api | Real SDK mocked transport, methods, validation/auth actions and safe errors | Actual SMTP/OTP delivery and live session retention |
| profile-polish-api, account-activity-api | Own account/RPC/category aggregation, methods/periods/CSRF/safe responses | Live aggregate totals against all historical records |
| listings-v1, listing-fulfillment-repository, listing-channel | Form/input/repository mapping/channel/permissions contracts | Deployed RLS/locks with multiple real sessions |
| shop-profile, public-seller, public-shop | Owner GET/PATCH, public whitelist/aliases; empty Shop source is intentional | Active Shop provisioning/public discovery |
| offers-api, order-domain-api, order-financial | RPC dispatch/role/field/environment gates and simulator isolation | A live accepted/paid/refunded Order |
| dual-payment, handoff-qr, order-snapshot-media | Mode defaults/restrictions/fees, QR/error/no-store contracts, copy/hash/failure handling | Actual SQL concurrency, timer delivery or camera hardware |
| messages-images-api, messages-realtime-client | Scoped media bytes/hash/auth and own-session/private-topic client lifecycle | Live Storage RLS or Realtime socket delivery |
| notifications-api, notification-preferences-api, notification-navigation | Recipient API/cursor/preference/safe navigation contracts | Every domain event fanout or live delivery |
| notification-email-worker | Claim/finish/idempotency/error classification and worker template behavior | A newly delivered Resend message |
| stripe-setup, stripe-setup-api, financial-capabilities | Setup-only provider/config/signature/idempotency/readiness/safe DTO contracts | Real charges/refunds/transfers/bank payouts |
| order-shop-provenance, message-shop-provenance, notification-shop-provenance | Frozen source mapping/legacy fallback/safe enrichment | A newly completed live Shop purchase |
| shop-analysis, test-pictures, places-api | Fixture math/registry/provenance/provider input/transport guards | Real Shop financial facts or live Places results |

Fresh results: tests/artifacts/business-v1-audit-test-results.json (first25); five additional PASS suites: dual-payment, handoff-qr, order-snapshot-media, messages-images-api, places-api. Historical browser evidence is reused explicitly, not misrepresented as newly executed under this business audit.

## Risk ordering and next step

1. Real-money launch blocker: no actual Order charge/refund/transfer/payout executor. SetupIntent success is not payment, payout Ready is not paid-out money.
2. Shop launch blocker: no positive creation/entitlement/publication/discovery authority. Do not enable a publish button against current denial.
3. Account completion gaps: avatar local-only, Settings password disabled; current read-only username cooldown timestamp is null until an update response.
4. Data truth gaps: Shop hearts/analytics/expenses/ratings are local or demo; Shop Favorites is Listing favorites and lacks the requested Shop Master–Detail system.
5. Operational verification: latest migration/RPC/ACL deployment parity, real RLS/concurrency, background due-work/realtime and signed worker operations are not certified by this offline audit.
6. Scalability/compatibility: fetch-all Resale browsing, filtered notification scans, legacy direct-detail/routes and old test assertions need scoped plans, not a broad rewrite.

Proceed only with individually approved tasks from [BUSINESS-V1-TASK-BREAKDOWN.md](BUSINESS-V1-TASK-BREAKDOWN.md). Recommended first implementation authorization: B01 environment/authority baseline and B02 account qualification; financial and Shop tracks can then proceed independently behind their existing fail-closed boundaries. The existing roadmap is updated to point to this evidence and ordered task list.

## Audit deliverables and final checks

Created BUSINESS-V1-LOGIC-AUDIT.md, BUSINESS-V1-SOURCE-INDEX.md and BUSINESS-V1-TASK-BREAKDOWN.md; updated BUSINESS-IMPLEMENTATION-ROADMAP.md and UI-V1-HANDOFF.md with links and corrected persistence boundaries. Exactly these five documentation files are changed by this audit. Local ignored source inventory/test results/logs remain under tests/artifacts. Application-source TypeScript passed; all 30 selected offline tests passed; tracked and untracked documentation whitespace checks and relative link-target checks passed. No application source changes required ESLint in this documentation-only audit. Git staged set remains empty. No production or remote write occurred.

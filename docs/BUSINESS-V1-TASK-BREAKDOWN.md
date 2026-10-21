# Business V1: ordered implementation tasks

2026-10-18. PLAN ONLY. No task below authorizes implementation, remote writes, a migration, a provider operation or production deployment. Source evidence and feature statuses: [BUSINESS-V1-LOGIC-AUDIT.md](BUSINESS-V1-LOGIC-AUDIT.md). Full routes and last function-definition lookup: [BUSINESS-V1-SOURCE-INDEX.md](BUSINESS-V1-SOURCE-INDEX.md).

UI V1 components should receive real data/authority without a new design or parallel component system. Respect current Meeting/Delivery, frozen economics, participant permissions and Shop fail-closed rules. “Schema: inspect/reuse” is not permission to create duplicate tables already present.

## Common exit gates for every task

1. Scope approved individually; verify current source, existing table/RPC/ACL chain and deployment first. Code tests alone never certify deployed RLS.
2. Browser provides intent/action UUID, never user authority, amounts/status/tier/payout destination or service credentials. Own/other/anonymous/expired-session tests mandatory for mutating tasks.
3. Use partial updates or atomic commands, immutable audit facts, stable idempotency keys and explicit error/retry semantics. Cross-user and duplicate request tests are separate from rendering tests.
4. If schema changes are actually necessary, submit exact forward/backfill/rollback and historical invariants before running them. No history rewrite to simplify a new feature.
5. Run focused offline/API tests, database/Storage/RLS concurrency tests in separately authorized staging, and real UI acceptance at390/430/820/1280/1536 where affected. Stage synthetic fixtures explicitly; clean them through existing guarded tools only when separately authorized.
6. No production operation, secret output, force push or automatic release. No paid feature/real-money claim until provider and DB facts reconcile. Preserve all existing no-store/same-origin/participant boundaries.

## Dependency order

### Execution progress — 2026-10-19

- **B04: COMPLETED — real Staging acceptance passed.** Exact target
  `pcaqxezdfxofysghssyo`; wrong current password rejected with native enforcement
  OFF; new/old password login, original-device retention, other-device refresh
  revocation and cross-account isolation verified. Both temporary accounts and
  associated state cleaned. Evidence: [B04 report](BUSINESS-V1-B04-CHANGE-PASSWORD.md).
- **B05: AUTHORIZED SCOPE ACCEPTED, with documented limitations (2026-10-19).**
  Resale publication recovery, new Resale image isolation and real Staging
  Storage/RLS/API/UI regression passed. Historical snapshot metadata and
  permissions passed. Historical snapshot byte download/hash verification is
  explicitly EXCLUDED by user decision; do not request it again in this workflow.
  New real-transaction snapshot prepare/bind is deferred to transaction acceptance
  (B07), not marked passed. Six unclassified legacy public Storage objects are a
  separate follow-up risk; do not delete/migrate them. No unconditional claim that
  every original B05 case (including held-inventory transaction coverage) passed.
  Both test runs cleaned to zero. See [qualification](BUSINESS-V1-B05-RESALE-QUALIFICATION.md)
  and [image isolation](BUSINESS-V1-B05-IMAGE-ISOLATION.md).
- **B06: COMPLETED — authorized real Staging acceptance passed (2026-10-19).**
  Reused current Messages RPCs/RLS/Storage/canonical refresh. Repaired only Realtime
  partial-client retry, teardown disconnect and timer cleanup. Native PostgreSQL
  concurrency/permissions/read/image tests, offline API/client/browser regressions
  pass. Real two-session WebSockets and UI composers, first-contact/message
  idempotency, unread persistence, private media, startup/reconnect/logout recovery,
  and same-browser account-switch isolation passed on the explicitly pinned
  Staging project. All temporary resources cleaned and exact-ID residue checked.
  No migration/configuration changes; frozen UI unchanged. Bounded runtime limits
  are documented separately; no natural long-duration token-expiry claim. No B07.
  See [B06 qualification](BUSINESS-V1-B06-MESSAGES-QUALIFICATION.md).
- **B07: LOCAL VERIFICATION PASSED; REAL STAGING ACCEPTANCE DEFERRED DUE TO
  IMMUTABLE TRANSACTION-HISTORY RETENTION (2026-10-19).**
  Existing Offer/Counter/Revise/Deny/Withdraw/Accept authority reused; no confirmed
  business defect reproduced and no application/UI/migration/RPC/RLS change made.
  Added actual API/service/media failure tests and native PostgreSQL role,
  snapshot, expiry and two-connection concurrency coverage. Historical C2
  static UI checks were updated under explicit limited approval to positively
  require the approved OrderProgress/OrderStageDetails/OrderFlowCancellation.
  Complete static test and seven focused regressions PASS. UI/application unchanged.
  Authorized read-only Staging review confirmed immutable-history retention and
  restrictive dependencies; no complete purge or run-based browsing isolation
  exists for real Offer/Accept fixtures. No B07 accounts/fixtures/writes created.
  Real lifecycle/concurrency/snapshot/integration acceptance NOT EXECUTED; not
  Completed. Final user decision: existing infrastructure only; no new environment
  is required or authorized, no B07 permanent Offer/Order/history writes in Staging,
  no bypass of immutable protections and no user-data cleanup. Preserve all
  existing Staging/local data, including demo/manual test data; a test/demo prefix
  grants no deletion permission. No new demo fixtures or artificial Orders.
  Future Staging writes require an explicit side-effect/removability review and
  authorization; unaccepted permanent records are forbidden. B07 remains deferred
  independently of the separately authorized B08 local work below.
  See [final environment decision](BUSINESS-V1-B07-STAGING-ACCEPTANCE-PLAN.md).
  See [B07 qualification](BUSINESS-V1-B07-OFFERS-QUALIFICATION.md).
- **B08: LOCAL IMPLEMENTATION/VALIDATION COMPLETE — CLOUD ACCEPTANCE DEFERRED
  (2026-10-19).** Existing Agreement/RPC/API/current-stage architecture reused;
  no confirmed application defect, no application/UI/migration change. Added native
  PostgreSQL participant/idempotency/rollback tests, two lock-observed confirmation
  races, ten-case actual backfill/readiness SQL projection tests, offline API and
  browser checks at five widths. No Staging writes/access or new persistent
  environment; all existing data preserved. Real cloud/session acceptance remains
  unexecuted because it would create prohibited immutable history. Not fully
  Completed. See [B08 qualification](BUSINESS-V1-B08-AGREEMENTS-QUALIFICATION.md).
- **B09: LOCAL VALIDATION COMPLETE — CLOUD AND SCHEDULER ACCEPTANCE DEFERRED
  (2026-10-19).** No application/UI/database defect reproduced or change made.
  Native external completion/dispute/cancel and six observed lock-wait races PASS;
  local simulated UU handoff/Protection, Seller delivery and Courier receipt PASS.
  Under narrow approval, only the old browser locator was scoped to the unique
  visible open AgreementCard, retaining exact text/visibility. 430-only PASS first,
  then 390/430/820/1280/1536 PASS. Application/UI unchanged. Timed expiry/races,
  mature settlement and manual due-worker execution NOT EXECUTED. No remote calls,
  writes, existing data cleanup or persistent environment creation. Confirmed Shop
  Listing-only Contact rule recorded below; no Shop implementation or B10.
  See [B09 qualification](BUSINESS-V1-B09-TRANSACTIONS-QUALIFICATION.md).

Baseline B01 → account B02–B04 and core qualification B05–B09.

Shop track: B01 → B10 contract → B11 profile provisioning + B12 entitlement → B13 owner editing → B14 publication → B15 public discovery → B16 Shop favorites / B17 metrics facts → B18 expenses → B19 real analysis.

Financial track: B01 + B07/B08 → B20 financial operation design → B21 charge creation → B22 webhook/reconciliation → B23 refunds → B24 transfers/payout → B25 operational disputes/recovery.

Integration: B14/B15 + B09/B22 → B26 real Shop purchase qualification. B27 events and B28 operations follow their authoritative producers. B29 scale/compatibility and B30 final release evidence complete the handoff. Priority is risk/dependency order, not a promise that payment and subscription scope can be implemented as one task.

## Baseline, account and existing core qualification

| ID / priority | Small deliverable and existing code to reuse                                                                                                                      | Dependency / schema                                                                                                                                                      | Security and staging acceptance                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01 / P0      | Produce local-versus-target deployed migration/RPC/ACL/Storage/scheduler matrix. Reuse63 existing migrations, versioned SQL and service environment guards.       | None. Schema:none; read-only inventory first.                                                                                                                            | No arbitrary service-role queries to user data. Record latest function definitions/overloads, grants, policy predicates, storage bucket configs and schedules. Exit: each critical authority marked deployed/missing/different, no production assumption.                              |
| B02 / P0      | Qualify existing signup/login/recovery/logout/session refresh and username cooldown. Do not build second auth API.                                                | B01. Schema:none unless a documented missing read-only cooldown projection is separately approved.                                                                       | Two test users, OTP expiry/rate limit, duplicate username/correction, reload/session expiration/logout, wrong origin and rejected unverified user. Exit: real account can authenticate and recover without leaking credentials; failure/resume paths recorded.                         |
| B03 / P1      | Implement persistent avatar command/projection behind existing AvatarDialog. Current save only creates object URL.                                                | B02; approved allowed image types/limits/storage lifecycle. Schema: likely avatar reference and scoped bucket policy; check existing profile fields first.               | Owner-derived path, signature/size/image decode, safe SVG policy, old-asset cleanup only after pointer commit, no cross-user delete. Exit: reload/new session/public Seller whitelist shows approved avatar; failed upload preserves last avatar.                                      |
| B04 / P1      | Wire authenticated Settings password change separately from existing recovery/reset flow; reuse Auth validation and dialog. Add honest cooldown read if required. | B02; confirm reauthentication/session invalidation policy only if current authority does not define it. Schema: normally reuse Auth; cooldown projection only if needed. | Never save password in DB/log/localStorage; verify current identity, server/provider errors and recovery. Exit: new password works, wrong current password rejected, recovery still works, no success before provider confirmation.                                                    |
| B05 / P0      | Qualify current Resale draft/media/publish/edit/delete/sold/favorite path with real RLS and failure recovery. Reuse repository/form/finalize.                     | B01/B02. Schema:none expected; fix only demonstrated defects.                                                                                                            | Own/other/anonymous, held inventory, MIME/signature/slot race, upload failure, publish retry, favorite reload/unfavorite, orphan cleanup. Exit: same Listing ID and image manifest preserved; no unauthorized mutation/public unpublished row.                                         |
| B06 / P0      | Qualify existing first-contact/text/images/unread/realtime under two live staging sessions.                                                                       | B05. Schema:none expected.                                                                                                                                               | Concurrent first contact dedupes; client UUID retry one message; sequence monotonic; outsider denied; no stale read decrement; reconnect/logout/private topic and signed image access. Exit: both sides see canonical data, no fixture shortcuts.                                      |
| B07 / P0      | Qualify Offer/counter/revise/deny/withdraw/accept and media snapshot atomicity.                                                                                   | B05/B06; existing Seller readiness where uu_pay applies. Schema:none expected unless actual defect proven.                                                               | Recipient/sender roles, wrong comparison, stale material hash, simultaneous accepts, same UUID replay, partial copy/hash failure and cleanup. Exit: exactly one winner/Order, frozen terms/provenance/media, losing inventory unaffected.                                              |
| B08 / P0      | Qualify existing dual Agreement acknowledgements and legacy backfill rule.                                                                                        | B07. Schema:reuse order_agreements; no replacement table.                                                                                                                | Buyer/Seller same terms, duplicate/concurrent confirmations, unpaid legacy cannot bypass, paid/fulfillment/history never regressed. Exit: Payment becomes current only after both eligible confirmations; no editable frozen terms.                                                    |
| B09 / P0      | Qualify existing external exchange plus uu_pay fulfillment/protection/cancellation authorities, independent of real provider.                                     | B08; simulated uu_pay outcomes explicitly marked test-only. Schema:reuse current records/functions.                                                                      | External one-sided/dual/dispute/cancel/expiry races; no Paid/fees/QR/protection/payout. uu_pay role/time/gates, handoff lockouts, courier receipt and due worker. Exit: exact held/released/Sold inventory invariants and immutable attestations; no invented Seller report privilege. |

## Shop ownership, membership, publication and data

- **B10 CORE PRODUCT CONTRACT v1.0 FINALIZED (2026-10-19);
  IMPLEMENTATION NOT AUTHORIZED.** The user confirmed the complete contract:
  Plus auto/one-month CA$1.99/2.99 (40 active Shop products), Pro CA$4.99/5.99
  (100); once-per-account opt-in two-calendar-month Pro Trial; Toronto anchored
  calendar arithmetic; fixed 120-hour Grace; renewal/upgrade/downgrade/suspension
  and reopening rules; Listing-scoped messaging exceptions and deduplicated UU
  System notices; existing Order/data protections. See the canonical contract
  for exact details. Core product decisions are no longer blocked or pending.
  Provider/minimum charge/compliance/refund execution/algorithm parameters remain
  later implementation matters, not missing core product rules. Pricing UI V1.1
  does not authorize membership implementation. No application/UI/database change
  in this contract-recording task, and no B11–B19 started.
  [Canonical user contract](BUSINESS-V1-B10-SHOP-CONTRACT.md);
  [historical source review](BUSINESS-V1-B10-SOURCE-REVIEW.md).
- **B11: LOCAL IMPLEMENTATION COMPLETE; STAGING DEPLOYMENT/ACCEPTANCE NOT
  AUTHORIZED OR EXECUTED (2026-10-19).** Under subsequent explicit local approval,
  added forward migration 202610190002 and authenticated create-shop RPC, strict
  create validator/type, session repository and POST201/409. Owner UNIQUE remains
  atomic; direct INSERT/DELETE/RLS unchanged. Native PostgreSQL permissions,
  unchanged existing-data/ACL/constraint checks, same-owner observed lock race,
  distinct-owner concurrency and rollback/retry PASS. Existing GET/PATCH, offline
  API/security/public-source regressions PASS. No membership/trial/publication,
  UI wiring or remote write. No B12 started.
  [B11 local qualification](BUSINESS-V1-B11-PROVISIONING-QUALIFICATION.md);
  [reviewed proposal](BUSINESS-V1-B11-PROVISIONING-PROPOSAL.md).

- **B11 subsequent milestone (2026-10-19): STAGING MIGRATION DEPLOYED —
  READ-ONLY VERIFIED.** Explicitly approved single migration 202610190002 applied
  and registered exactly once to pcaqxezdfxofysghssyo. Definition/owner/EXECUTE,
  existing Shop RLS/ACL/constraints and prior migration history verified. Runtime
  Shop creation, POST201/409, concurrent creation and write-based authorization
  acceptance remain deferred, not PASS. The earlier local-only entry above and
  qualification document describe their historical milestone.
- **B12 LOCAL IMPLEMENTATION COMPLETE (2026-10-19); STAGING NOT DEPLOYED;
  REAL PAYMENT NOT INTEGRATED.** Subsequently approved local backend and native
  tests: forward migration 202610190003, three private tables, lifetime Trial,
  timestamp-derived entitlement, calendar/paid-domain operations, owner GET and
  narrow explicit Trial API. Final policy preserves unused Trial for previously
  paid owners only after paid coverage/Grace and renewal conflicts end. Native
  lifecycle/calendar/permission/idempotency and observed lock races PASS; B11,
  B09 local regressions and focused static checks PASS. No paid grant endpoint,
  provider, UI/CTA, publication/discovery integration or remote operation. No B13.
  [B12 membership design](BUSINESS-V1-B12-MEMBERSHIP-DESIGN.md);
  [B12 local qualification](BUSINESS-V1-B12-MEMBERSHIP-QUALIFICATION.md).

- **B12 subsequent milestone (2026-10-19): STAGING MIGRATION DEPLOYED —
  READ-ONLY VERIFIED.** Only 202610190003 plus its btree_gist dependency and unique
  history registration deployed. Three private tables/functions/ACL/constraints
  verified; prior migrations and existing system permissions unchanged. Real
  Trial/paid/runtime write acceptance remains deferred, not PASS.
- **B13 LOCAL IMPLEMENTATION COMPLETE (2026-10-19).** Existing owner GET/PATCH
  connected to shared desktop/mobile Settings state; partial conditional updates,
  conflict/uncertain-response/session recovery and approved copy/fixed-badge
  exceptions implemented. Native PostgreSQL/RLS/concurrency and local component/API
  qualification recorded separately. No schema or remote changes; **STAGING RUNTIME
  ACCEPTANCE NOT PERFORMED.**
  [B13 qualification](BUSINESS-V1-B13-QUALIFICATION.md);
  [approved plan](BUSINESS-V1-B13-SHOP-SETTINGS-PLAN.md).
- **B14 LOCAL IMPLEMENTATION COMPLETE (2026-10-19).** Shared Listing wizard/media/
  owner management wired to Shop draft RPC; atomic B12 quotas, private new media,
  Shop-only Sold and held-metadata guard, public/new-transaction fail-closed gates.
  Native PostgreSQL/concurrency and controlled browser qualification recorded.
  **STAGING NOT DEPLOYED; STAGING RUNTIME ACCEPTANCE NOT PERFORMED. B15 NOT STARTED.**
  [B14 qualification](BUSINESS-V1-B14-QUALIFICATION.md);
  [B14 Shop products plan](BUSINESS-V1-B14-SHOP-PRODUCTS-PLAN.md).

- **B14 subsequent milestone (2026-10-19): STAGING MIGRATION DEPLOYED — ARCHIVE
  REPAIRED — READ-ONLY VERIFIED.** Only migration 202610190004 was deployed to
  pcaqxezdfxofysghssyo. Its one archive-field repair restored byte-exact approved
  SQL; prior 68 history records and installed authority remained unchanged.
  Real Shop creation/upload/publication/quota/concurrency/Sold and buyer-denial
  Staging write acceptance remain deferred, not PASS.
- **B15 PLANNING STARTED (2026-10-19).** Focused local investigation and
  [public Shop plan](BUSINESS-V1-B15-PUBLIC-SHOP-PLAN.md) only. Public whitelist
  reads, centralized B12 eligibility, controlled media and required UI exceptions
  proposed; no application/migration implementation or remote access authorized.
- **B15 LOCAL IMPLEMENTATION COMPLETE (2026-10-19).** Subsequently approved
  anonymous whitelist Shop/product RPCs, B12 time-based visibility, controlled
  media, real existing directory/canonical-detail wiring and narrow approved UI
  exceptions implemented locally. Native database, API, focused browser 10/10,
  B11/B12/B13/B14/B09 regressions, static checks and isolated production build
  passed. Legacy aggregate Listing Card management-selector test remains not
  passed; see [exact qualification and limitations](BUSINESS-V1-B15-QUALIFICATION.md).
  **STAGING NOT DEPLOYED; STAGING RUNTIME ACCEPTANCE NOT PERFORMED.
  B16/B17 NOT STARTED.**
- **B16 PLANNING STARTED (2026-10-19).** Focused local investigation and
  [Shop-entity Favorites plan](BUSINESS-V1-B16-SHOP-FAVORITES-PLAN.md) only;
  implementation NOT started. Existing `shop-favorites` renders favorite Shop
  Listings, not Shops. Preserve those records/access; the proposed Shops/Products
  split, real heart wiring/placement and Master–Detail discrepancy require explicit
  UI approval. No application/migration or remote operation in this planning round.
  Subsequent B15 status supersedes its historical local-only milestone above:
  migration deployed/read-only verified; empty-data runtime smoke has limited
  coverage, and the 390px fix passed 10/10 LOCAL interaction cases. Populated Shop,
  membership-transition, hosted-media/CDN runtime acceptance remains deferred.
  B17 NOT STARTED.
- **B16 LOCAL IMPLEMENTATION COMPLETE (2026-10-19).** Approved Shop-entity
  favorites table/RPC/API, shared account-scoped confirmed state, real Card/Detail
  hearts and existing destination Shops/Products split implemented. Products and
  Resale keep their existing Listing favorite authority. Existing layout is
  preserved; no Master–Detail redesign. Native PostgreSQL, API/cache, five-width
  normal/reduced-motion browser tests, B12/B14/B15 regressions, 390px navigation,
  TypeScript, focused lint/format/diff and isolated build qualified locally; see
  [exact results and limitations](BUSINESS-V1-B16-SHOP-FAVORITES-QUALIFICATION.md).
  **B16 STAGING NOT DEPLOYED. B16 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.
  B17 NOT STARTED.** This supersedes B16's dated planning-only status above.
- **B16 subsequent milestone: STAGING MIGRATION DEPLOYED — READ-ONLY VERIFIED.**
  Per the separately authorized deployment report, only 202610190006 and one
  byte-identical history registration were applied to pcaqxezdfxofysghssyo;
  71 total versions, prior 70 rows and existing authorities unchanged. Actual
  add/remove, account isolation, cross-session persistence, membership changes
  and browser Staging acceptance remain deferred. Not rechecked remotely during
  the following local planning task.
- **B17 LOCAL IMPLEMENTATION COMPLETE (2026-10-19).** Official Discovery /
  Analytics facts reuse Account Activity, current Favorites and authoritative
  Orders/events. One forward local migration adds new-event channel/Shop UUID
  provenance, authenticated explicit Shop/Listing opens and a private completed
  Order source projection; no historical backfill or frozen snapshot rewrite.
  See [qualification and exact limitations](BUSINESS-V1-B17-DISCOVERY-FACTS-QUALIFICATION.md).
  Local native PostgreSQL/concurrency, APIs, five-width normal/reduced browsers,
  B09/B12/B14/B15/B16 regressions, 390px navigation, TypeScript, focused lint/format/
  diff and isolated build verified. The earlier
  [plan](BUSINESS-V1-B17-DISCOVERY-FACTS-PLAN.md) remains a dated proposal, superseded
  by the explicit implementation decisions. **B17 STAGING NOT DEPLOYED.
  B17 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.** No ranking, expenses, dashboards,
  payment or new Shop transactions; B18/B19 and later task identities unchanged.
- **B17 subsequent milestone: STAGING MIGRATION DEPLOYED — READ-ONLY VERIFIED.**
  Per the separately authorized deployment report, only `202610190007` and one
  atomic, byte-identical SQL history registration were applied to explicit
  `pcaqxezdfxofysghssyo`. Total 72 versions; prior 71 history rows and 236 other
  existing functions unchanged. The approved Listing-view anonymous EXECUTE
  correction is effective; new functions/constraints/trigger and permissions were
  verified read-only. No runtime event-write or Order acceptance is claimed. This
  supersedes the earlier local-only deployment status; not rechecked remotely in
  B18 planning.
- **B18 LOCAL IMPLEMENTATION COMPLETE.** See
  [Costs & Expenses qualification](BUSINESS-V1-B18-COSTS-EXPENSES-QUALIFICATION.md)
  and the retained [approved plan](BUSINESS-V1-B18-COSTS-EXPENSES-PLAN.md).
  Private owner cost/expense persistence, versioned soft deletion, Suspended
  management and atomic first-Accept cost capture implemented locally in forward
  migration `202610190008`; no historical backfill or transaction RPC replacement.
  Current-schema CRUD and isolated pre-B14 Accept seam/races qualified locally;
  actual B14 guards subsequently installed and verified closed. Narrow approved
  owner UI exceptions only; Demo Analysis stays separate from real private records.
  **B18 STAGING NOT DEPLOYED; B18 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.**
  Real new-Shop-Order snapshot acceptance remains separately authorized transaction
  work. This is the earlier local milestone; see the subsequently reported
  deployment milestone below. Recommendation & Ranking NOT IMPLEMENTED.
- **B18 subsequent milestone: STAGING MIGRATION DEPLOYED — READ-ONLY VERIFIED.**
  Per the separately authorized deployment result, only `202610190008` was
  atomically deployed to explicit `western-marketplace-staging` /
  `pcaqxezdfxofysghssyo`, with one byte-identical history archive. Total 73
  migrations; previous 72 history records and 240 existing function definitions
  and permissions unchanged within the verification scope. Approved 3 tables /
  29 columns / 5 functions / 2 triggers installed; three B14 guards stay enabled.
  B18 runtime financial acceptance remains deferred. This reported milestone
  supersedes the earlier NOT DEPLOYED status; no remote recheck in B19 planning.
- **B19 LOCAL IMPLEMENTATION COMPLETE — STAGING NOT DEPLOYED; STAGING RUNTIME
  ACCEPTANCE NOT PERFORMED.** See
  [local qualification](BUSINESS-V1-B19-SHOP-ANALYSIS-QUALIFICATION.md) and the
  historical [plan](BUSINESS-V1-B19-SHOP-ANALYSIS-PLAN.md). One owner/tier-scoped
  read aggregate RPC/API reuses B12/B17/B18 and existing UI. Approved Plus product
  statistics, Pro-only unavailable promotion attribution, recorded item-sales and
  incomplete-profit disclosure implemented locally. No new tables, counters,
  workers, ranking or financial execution. Native PostgreSQL, API and browser
  qualification is local evidence only; B26 Shop transactions, cloud ordinary-user
  runtime and provider acceptance remain separate. Deployment needs new approval.
- **Recommendation & Ranking: separate UNASSIGNED FUTURE WORK PACKAGE.** No other
  numbered task explicitly owns the full ranking package. The
  [preserved proposal](BUSINESS-V1-B17-RECOMMENDATION-RANKING-PLAN.md) is not the
  official B17 plan. Its numerical parameters and 128-candidate design remain
  provisional, not approved implementation rules. B10's older B17 algorithm
  reference is superseded in task allocation by this explicit user decision;
  B10's promotion benefits remain intact. Scheduling requires separate approval,
  without inventing a B-number or moving the unfinished facts into B18/B19.
  B17 facts depends on B14/B15/B07; future ranking reuses B12/B15/B16 eligibility,
  discovery and favorites boundaries. B18 costs and B19 aggregates remain separate;
  B27 notification integration follows authoritative producers. Recommendation &
  Ranking is not implemented. No remote operation in the B17 local round.
  B18 milestones and the separately authorized B19 local implementation status are
  recorded above; ranking remains unimplemented and requires separate scheduling.

Confirmed Shop messaging rule (2026-10-19, recorded during B09; implementation
deferred to the separately authorized Shop tasks): no standalone Contact Shop
action or Shop-ID-only Conversation from a storefront. Contact Seller belongs to
a specific product Listing; every new Conversation must preserve that Listing
context and reuse existing Messages identity/authorization. No second messaging
system/tables. Backend enforcement must be verified in the relevant Shop task;
hiding a button alone is not enforcement. The user owns removal of the unwanted
storefront control. Codex must not remove/hide/edit that control or change Shop
UI/application logic during B09, nor begin B10 automatically.

Do not infer entitlement from owner profile, display badge, pricing selection, local fixture access level, existence of a listing_channel column or successful Stripe payment setup. Provisioning and eligibility are distinct from public profile editing.

| ID / priority | Small deliverable and existing code to reuse                                                                                                                            | Dependency / schema                                                                                                                                                     | Security and staging acceptance                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B10 / P0      | Record authoritative Plus/Pro/trial contract, visibility/expiry behavior and permitted product limits before code. PricingCard is presentation evidence, not authority. | B01; Core Product Contract v1.0 confirmed 2026-10-19. Schema:none; implementation separately authorized.                                                                | Core rules finalized in canonical B10 contract; provider/compliance/algorithm implementation items remain deferred. No backend or launch acceptance claimed.                                                                                               |
| B11 / P1      | Add narrow idempotent Shop provisioning/creation authority using existing public.shops profile. Keep owner GET/PATCH.                                                   | B10. Schema:review whether creation command/audit/link needed; do not duplicate shops.                                                                                  | Auth verified owner, one Shop per existing unique owner, derived owner ID, no forged activation/tier. Exit: retry same intent one row, other-user access denied, profile existence grants no paid/public feature.                                          |
| B12 / P1      | Add authoritative membership/subscription/trial state and reconciliation in separately reviewable substeps.                                                             | B10/B11 and chosen billing contract; Order payments are separate. Schema:likely entitlement/subscription/event references; inventory current Stripe inbox before reuse. | Server-only grant/expiry/revoke; signed/replayed/out-of-order event handling; free trial cannot be regranted by account UI. Exit: one server result governs all dependent capabilities; no client-supplied tier.                                           |
| B13 / P1      | Connect Shop Settings to existing own-Shop API, replacing fixture-only save for real owners.                                                                            | B11; entitlement only where approved contract requires. Schema:none normally.                                                                                           | PATCH whitelist name/category/description, authoritative validation; null/error/loading states distinct. Exit: allowed values survive reload; cannot edit owner/status/tier. Existing taxonomy mismatch must be resolved explicitly, not silently widened. |
| B14 / P1      | Add positive create-in-Shop/publish command behind eligibility, retaining channel immutability and shared ListingForm/media.                                            | B11/B12/B05. Schema:only required immutable Shop association/eligibility indexes after review.                                                                          | Current finalize denial replaced only by approved server eligibility; expire/downgrade during upload/publish, no Resale fallback or forged owner/channel. Exit: eligible owner can publish; ineligible cannot; ordinary Resale unchanged.                  |
| B15 / P1      | Replace public-shop empty source with anonymous whitelist Directory/Detail projection; wire truthful destinations.                                                      | B13/B14. Schema:public projection/visibility indexes only if needed; do not grant broad private Shop SELECT.                                                            | Active/eligible/public predicates in server/DB, no email/legal/payout data; UUID/username/404 behavior and product availability. Exit: real listed Shop opens truthful page, no demo claims as live merchant.                                              |
| B16 / P2      | Implement Shop-ENTITY favorites and connect approved Master–Detail Shop Favorites UI without replacing Listing favorites.                                               | B15; confirm count/privacy behavior if not established. Schema:likely unique(user,shop) relation + RLS.                                                                 | Idempotent intent, wrong-user denial, unavailable Shop projection, rapid toggle/failure/reload. Exit: directory/detail/favorites agree; product Favorites remains separately channel-scoped.                                                               |
| B17 / P2      | Define/record real Shop discovery and analytics facts (views/sales/cost linkage); reuse existing account events/provenance.                                             | B14/B15/B07. Schema:extend only missing fact/index/projection contracts.                                                                                                | Server seller/Shop/channel attribution, owner exclusion, event retry same UUID; sold/listing/manual versus completed Order distinction explicit. Exit: facts reconcile to authoritative transactions, not visual counters.                                 |
| B18 / P2      | Implement real owner expense/product-cost persistence behind existing UI.                                                                                               | B17 + approved accounting definitions/edit/retention rules. Schema:likely expenses/cost snapshot/audit references; do not rewrite Order economics.                      | Integer cents, currency/timezone, immutable completed cost snapshots versus editable expense rows, owner-only CRUD, no secret financial payloads. Exit: reload persists, retries don't duplicate, partial/missing costs visible.                           |
| B19 / P2      | Add owner/tier-authorized Shop Analysis aggregate endpoint and wire it to existing dashboard; keep explicit demo preview where intended.                                | B12/B17/B18; real financial metrics depend on actual completed transactions. Schema:aggregate/indexes only if justified.                                                | Server tier enforcement, cross-Shop deny, refunds/cancels/external revenue definitions, Toronto DST/range/zero values. Exit: real UI tagged real, totals reconcile, no fabricated profit when costs missing.                                               |

## Order provider execution and operational settlement

B20 status (2026-10-20): **LOCAL IMPLEMENTATION COMPLETE**.
See [B20 local plan](BUSINESS-V1-B20-PLAN.md), the targeted
[security review](BUSINESS-V1-B20-SECURITY-REVIEW.md), and the
[local qualification](BUSINESS-V1-B20-QUALIFICATION.md). Stripe is the sole planned
Business V1 provider. The approved contract-only slice now defines trusted evidence,
purpose/binding isolation, explicit success/failure/unknown/reconciliation outcomes,
stable retry identity and cancellation-race decisions. It adds no API, schema, UI,
worker, cron or provider call and does not enable real charges. Stripe Connect funds
flow and liability decisions remain unresolved before execution work.
B21 charging, B22 reconciliation, B23 refunds, B24 transfer/bank payout and B25
operations retain their existing identities. B12 membership billing is separate;
no Shop transaction guard is opened and no provider operation is authorized here.

B21 status (2026-10-20): **LOCAL IMPLEMENTATION COMPLETE — REAL PROVIDER AND B22
ACCEPTANCE DEFERRED**. See [B21 plan and qualification](BUSINESS-V1-B21-PLAN.md).
The existing Order start route now has a default-off, test-only PaymentIntent adapter;
the existing attempt stores immutable provider identity and uses a private fenced
claim/bind RPC. Buyer Stripe.js confirmation is connected without granting the browser
payment-state authority. No Transfer, Refund, Payout or membership billing was added.
Real execution remains disabled pending formal MoR/Connect/region/terms approval and
B22 reconciliation deployment and qualification.

Preserve current SetupIntent/Accounts v2 hosted onboarding. Setup/readiness and charge execution are separate systems. Reuse existing private bindings/inbox patterns; do not create duplicate webhook/financial ledgers without checking their suitability.

B22 status (2026-10-21): **LOCAL IMPLEMENTATION COMPLETE — REAL STRIPE AND STAGING
ACCEPTANCE DEFERRED**. See [B22 plan](BUSINESS-V1-B22-PLAN.md) and
[B22 local qualification](BUSINESS-V1-B22-QUALIFICATION.md). Signed Order notices
remain reconciliation triggers; only a freshly retrieved, completely bound Stripe
PaymentIntent can apply the existing locked payment transition. B23–B25 remain
separate and no real payment capability is enabled.

B23-A status (2026-10-21): **LOCAL DATABASE FOUNDATION COMPLETE**. See
[B23 plan](BUSINESS-V1-B23-PLAN.md). The private refund operation,
server-derived Buyer release amount, immutable Stripe payment binding and fenced
claim lease are locally qualified. No Stripe Refund, remote migration, Transfer or
Payout has executed; the overall B23 task is not complete.

B23-B status (2026-10-21): **LOCAL REFUND EXECUTOR COMPLETE — REAL STRIPE
ACCEPTANCE DEFERRED**. The default-off executor revalidates the original PaymentIntent,
reuses exact existing Refunds, creates at most once from a first execute claim, and
persists fenced provider observations through the B23-B result RPC. Unknown outcomes
remain reconcilable and `reconcile` never creates.

B23-C status (2026-10-21): **LOCAL WEBHOOK AND WORKER INTEGRATION COMPLETE — REMOTE
ACCEPTANCE DEFERRED**. The existing signed Platform webhook now routes the three Stripe
Refund notices into a purpose-isolated durable inbox. The existing authenticated
Worker retrieves current Refund state, wakes matching operations, discovers bounded
authorized candidates through the original `prepare` authority, and invokes B23-B.
The default-off gate consumes no event, candidate or first-execute lease. Staging
migrations, Stripe webhook subscription, a reliable authenticated Worker scheduler
and real Stripe test-mode acceptance remain incomplete; the overall B23 task is not
yet completed and no real Stripe refund has executed.

| ID / priority | Small deliverable and existing code to reuse                                                                                                                | Dependency / schema                                                                                                                                | Security and staging acceptance                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B20 / P0      | Specify concrete provider operation mapping to existing frozen economics/attempt/settlement authorizations. Confirm actual SDK/docs in implementation task. | B01/B07/B08; existing server-only Stripe setup. Schema:inventory provider refs, unique attempts and operation audit needs.                         | Amount/currency/destination from server records only; external mode never calls Stripe. Exit: exact create/success/failure/unknown/retry transition table without changed fees or timing rules.                                                     |
| B21 / P1      | Implement idempotent uu_pay charge/session start and Buyer confirmation integration, gated off until reconciliation is qualified.                           | B20. Schema:only missing durable Order attempt/provider reference/operation key.                                                                   | Correct buyer, both Agreement confirmations, readiness, eligibility and same UUID recovery; timeout-after-provider-create. Exit: one logical payment per attempt; browser cannot mark Paid.                                                         |
| B22 / P1      | Add verified Order payment events/reconciliation through durable server boundary. Existing setup inbox must remain scoped.                                  | B21. Schema:dedupe/index/lease linkage if absent.                                                                                                  | Raw signature/channel/account/mode/object/amount verification, replay/out-of-order, cancelled stale attempt, worker crash recovery. Exit: verified provider fact advances existing state exactly once; simulator unavailable in real provider mode. |
| B23 / P1      | Execute provider refunds only from existing settlement authorization; persist actual refund reconciliation.                                                 | B22/B09. Schema:refund/provider operation references only as needed.                                                                               | No browser amount/status; unique authorization execution, refund-after-timeout/idempotent retry and inventory/cancellation consistency. Exit: authorized totals match actual provider result; partial failure remains reconcilable.                 |
| B24 / P1      | Execute eligible seller transfers/payout operations with existing post-Protection authorization.                                                            | B22/B23/B09 and Connect ready recipient. Schema:durable transfer/payout refs and status audit if missing.                                          | Distinguish transfer into connected balance from bank payout; no early release, wrong seller, duplicate job or refunded funds. Exit: eligibility != paid-out status; provider/DB reconciliation and retry verified.                                 |
| B25 / P2      | Add operational case resolution/recovery integration around existing holds/protection, preserving participant powers.                                       | B23/B24; explicit operational actor/resolution policy if current authority missing. Schema:only reviewed missing case resolution/audit operations. | External disagreements never imply financial Protection; authenticated privileged operations, immutable evidence and audit; no client release. Exit: correct hold/refund/release behavior under disputes and provider failures.                     |

## Integration, performance and release qualification

| ID / priority          | Small deliverable and existing code to reuse                                                                                                       | Dependency / schema                                                                                  | Security and staging acceptance                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B26 / P2               | Qualify a real Shop product Offer/Order/purchase through existing shared transaction stack.                                                        | B14/B15/B07/B09 and B22 for uu_pay. Schema:none expected beyond earlier tasks.                       | Frozen Shop provenance survives rename/delete/expiry; inventory remains single authority; no second Shop-specific Order state machine. Exit: correct source across Messages/Notifications/history and no Resale mixing.                                 |
| B27 / P2               | Hook newly authoritative Shop/subscription/provider events into existing notifications/outbox.                                                     | Each producer qualified first. Schema:review new event types/indexes; reuse source-key idempotency.  | Recipient determined server-side; no secret/payment details in feed/email; safe deep destinations, preferences, duplicate source events. Exit: one intended notification with correct target and traceable source.                                      |
| B28 / P0 before launch | Qualify scheduler/email/realtime/webhook worker operations and observability.                                                                      | B01 and dependent implementations. Schema:none unless missing operational audit proven.              | Exact staging environment, claim/lease/retry/idempotency, provider status IDs, sanitized errors, old audit retention; no direct client invocation. Exit: due jobs/events recover after crash/replay; real sandbox send test only separately authorized. |
| B29 / P2               | Bound Resale discovery/filter/pagination refresh and filtered notification scans; preserve approved UI and search behavior.                        | B05/B15; measure before choosing keyset/search redesign. Schema:indexes/query RPC only if justified. | Public/recipient predicates and stable ties/cursors, concurrent insert/delete, full-text/category semantics and page resets; no silently incomplete feed. Exit: bounded query/memory work with matching results and unchanged scroll/UI contracts.      |
| B30 / P0 before launch | Final current-worktree qualification and explicit environment rollout plan; update stale test fixtures/loaders without product permission changes. | All enabled scope tasks. Schema:review-only deployment plan, separately authorized execution.        | Own/other/anon, API/RLS/Storage/live two-user journeys/provider test mode; no secrets/artifacts in Git; no ignored new essential source. Exit: known demo gaps disclosed, acceptance results current, user explicitly authorizes deployment separately. |

## Product decisions still needed, only when relevant task starts

- B10 core Shop/trial lifecycle, pricing, tier limits, visibility and expiry are
  confirmed in Core Product Contract v1.0; do not reopen those decisions or infer
  rights from PricingCard. Its section 18 explicitly defers provider selection,
  minimum charge, compliance, financial execution and algorithm parameters to
  separately authorized implementation. No B11/backend authorization is implied.
- Shop profile category authority currently allows Clothing & Accessories/Electronics/Collectibles/Home & Living; discovery uses its newer taxonomy. Mapping/migration must be a conscious B13/B15 decision, not arbitrary enum replacement during UI work.
- Persistent avatar rules and Settings password reauthentication policy must follow existing Auth capabilities without inventing unrelated security requirements.
- Definition of real Shop ranking/reviews/financial metrics and expense corrections needs an approved measurable contract. “Popular” text does not define ranking; fixture revenue does not define accounting.
- Operational dispute actors/permissions and production rollout schedule are separate approvals. Do not add arbitrary Seller financial powers to complete a UI checklist.

## Recommended immediate authorization

Start with B01 read-only deployed authority inventory and B02 staging account qualification. Then B03/B04 are small visible account completions; B05–B09 validate already extensive Resale/Offer/Order authority. In parallel, approve B10 and B20 contracts before opening Shop or real financial execution. This avoids spending implementation effort rebuilding existing ownership, media, message, notification or Order state systems.

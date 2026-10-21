# B10 historical source review ? superseded product questions

Archived on 2026-10-19 to preserve the initial local source review.
The following text records the state BEFORE the user finalized Core Product
Contract v1.0 and before Pricing Card UI V1.1. Its blocked status, outstanding
product questions and old pricing observations are HISTORICAL, not current rules.
Do not request those decisions again or implement these draft proposals.

Current authoritative rules: [B10 Core Product Contract v1.0](BUSINESS-V1-B10-SHOP-CONTRACT.md).
Core rules confirmed; implementation NOT AUTHORIZED. Provider/compliance/algorithm
items are separate future implementation matters, not missing core B10 decisions.

---

# B10: Shop business contract and decisions required

2026-10-19. **Blocked pending product decisions.** This is the B10 contract task,
not B11 provisioning, B12 membership implementation or permission to enable UI.
No application/database/UI change is proposed or implemented in this pass.

## Exact documented scope

`BUSINESS-V1-TASK-BREAKDOWN.md`, B10/P0: record authoritative Plus/Pro/trial
contract, visibility/expiry behavior and permitted product limits before code.
PricingCard is presentation evidence, not authority. Dependency B01; schema none.
Exit: identify locked/missing decisions and provide explicit server eligibility
contract and event sources without unapproved prices, automatic charges or trial
policy. The new request says follow that exact definition; its conditional
activation/entitlement examples do not move B11/B12 into B10.

## Current implementation, narrowly inspected

| Surface/authority | Actual current behavior | Evidence/verification boundary |
| --- | --- | --- |
| Persistent Shop owner profile | `public.shops` unique owner FK to profiles; name/category/description bounds; owner-only read and whitelisted update | `202610160006_shop_profile_foundation.sql`, `types/shop.ts`, `lib/shop-profile.ts` |
| Own-Shop API | GET/PATCH `/api/shop`, session-derived owner; no query-selected identity, no POST/create/delete/activation endpoint | `pages/api/shop.ts`, `lib/server/shop-profile-repository.ts`; source and offline regression, not fresh remote validation |
| Current Shop Plans modal | Plus CA$2.99/mo, Pro CA$5.99/mo; trial preview says two months, no card/automatic charges; CTA buttons do not execute business commands | `components/pricing-card.tsx`, `components/shops/shop-pricing-dialog.tsx`; approved UI does not grant entitlements |
| Older pricing source | `SHOP_PRO_PLANS` has 1/3/6-month CA$9.90/20.90/32.90 and old feature split | `lib/shop-pro-plans.ts`, `shop-pro-pricing.tsx`; distinct presentation source, NOT a second valid billing catalog |
| Current/modal source distinction | Handoff explicitly names PricingCard rather than older multi-card presentation | `docs/UI-V1-HANDOFF.md`; no pricing/UI edits during B10 |
| Shop publication | Immutable listing_channel; current finalize rejects non-Resale even for an existing Shop owner | `202610160007_listing_channel_authority.sql`; safe negative authority, no positive entitlement |
| Public Shop/Directory | Real source returns []/null, hence no invented active public Shop | `lib/server/public-shop.ts`; demo workspace is separate presentation |
| Shop analytics/expenses/favorites | Existing fixture/local presentation is not persisted membership/financial authority | `lib/fixtures/shop-analysis-fixture.ts`, `lib/shop-analysis.ts`, Shop components and existing audit |
| Billing/entitlement/trial | No Shop membership/activation/trial ledger or verified subscription reconciliation found in relevant source/index | Existing Stripe account setup is not Shop billing; no provider invocation or remote schema assertion here |

## Confirmed rules to preserve

1. Reuse existing authenticated Profile identity and unique Shop ownership. An
   owner profile, badge, local/demo tier or browser field grants no paid capability.
2. Membership/eligibility must be decided server-side using trusted evidence,
   never client owner/status/tier, PricingCard selection or payment-method setup.
3. Missing/invalid/unverified authority must not grant positive privileges. Do not
   fabricate activation, payment success or a temporary localStorage entitlement.
4. Order payment economics/lifecycle and Shop subscription billing are separate.
   Existing accepted Orders/history/hold rules must not be rewritten by a future
   Shop expiry or tier change.
5. Preserve all current data, UI and Create/Discard behavior. No migration,
   publication enablement, remote account edits, demo generation or cleanup now.
6. No Contact Shop / Shop-ID-only Conversation. Contact Seller only from a real
   product Listing, using existing Messages identity/authorization. User owns
   removal of the storefront UI control. Later Shop task must verify backend
   enforcement; no Shop messaging implementation during B10.
7. No automatic charge/trial/payment grant can be inferred from presentation.
   Keep existing preview wording/UI untouched while business decisions are pending.

## Explicit eligibility contract: fixed security boundary, unresolved product cells

The following is a requirements contract for later tasks, not an implemented API,
new schema proposal or invented set of subscription statuses.

| Capability | Required authority and independent constraints | Still needs product decision |
| --- | --- | --- |
| Read/update own Shop identity | Auth verified current owner + existing field whitelist/RLS | Whether inactive owners retain any additional tools; existing owner profile access remains unchanged |
| Create Shop | Auth owner, one Shop per user, replay/concurrency-safe provisioning | B11: approved creation timing relative to trial/payment; profile existence alone grants no membership |
| Publish/manage products | Auth owner + actual Shop association + trusted effective entitlement + existing media/inventory validation | Tier quotas, what counts, oversize downgrade behavior; B12/B14 implementation |
| Public storefront/product visibility | Real profile/product + trusted visibility predicate + existing Listing state | Trial eligibility, expiry/cancellation/downgrade visibility and any grace period |
| Analysis/features/promotion | Auth owner + approved feature matrix + real scoped data | Exact Plus/Pro/trial matrix; no ranking/exposure promise invented |
| Trial grant | Trusted grant record, eligibility and replay-safe once-only rules | Eligibility identity, start event, duration arithmetic, repeat eligibility and paid transition |
| Paid membership | Trusted verified subscription/payment evidence bound to owner/Shop and server catalog | Price/currency/tax, billing model, renewal/cancel/change timing and provider event mapping |

Until these cells are confirmed, the contract cannot produce a complete positive
entitlement function or acceptance truth table. No hardcoded test expectation may
silently decide them. This is the actual B10 blocker, not a demonstrated API bug.

## Decisions needed from the user

1. **Plans/billing/features:** confirm whether the current displayed Plus CA$2.99
   and Pro CA$5.99 per month are final business prices (and currency/tax handling),
   rather than a UI prototype. Define fixed-term/manual renewal versus recurring
   billing, cancellation and tier-change effective time. Confirm exact Plus/Pro
   capability differences, including analytics and Featured promotion. The older
   plan source must not become an alternate backend catalog by accident.
2. **Trial:** confirm two-month Pro entitlement, who is a new/eligible seller,
   whether the grant is once per Profile or another defined identity, when it
   starts, and whether two months means calendar months or a fixed number of days.
   Confirm the no-card/no-automatic-charge presentation as business policy and how
   paid purchase during/after trial affects remaining time and tier.
3. **Quotas/expiry:** define Plus/Pro/trial product limits, counted statuses and
   downgrade overflow policy. Define storefront/product visibility after expiry
   or cancellation, data retention/owner access, any grace period, and whether
   renewal restores the same Shop/products without republishing. Existing Orders
   remain under their frozen transaction rules.

These are missing authoritative rules, not requests to redesign UI. No default
values, quotas, free-trial regrant or tax/renewal behavior have been invented.

## Event sources and failure/idempotency requirements for later implementation

- Owner commands: verified session + exact owner relationship. Browser requests
  intent only, never asserts entitlement. B11 provisions profile; B12 grants.
- Trial: future server transaction records approved eligibility/start/end/grant
  identity atomically; failed/incomplete request cannot grant rights. Event source
  is this durable grant, not trial-button click or local clock.
- Paid: later approved billing adapter accepts verified provider facts linked to
  server catalog/owner/Shop, mode/account/currency and operation identity. Current
  SetupIntent/Connect readiness is not a subscription activation fact. Provider
  mapping/event types remain unselected until billing model is confirmed.
- Expiry: trusted persisted effective dates and server time must govern requests,
  even if a future notification/worker is delayed. Exact boundary/grace depends
  on the product decision, not browser time or cron success alone.
- Replay/out-of-order/failed activation must not extend rights or replace newer
  authority. Uncertain provider result stays ungranted until reconciliation.
- Cancellation/downgrade must preserve data/history and transaction holds; apply
  only the approved entitlement/visibility policy, never rewrite accepted Orders.

## Task boundaries and verification

B11 provisioning; B12 membership/trial/reconciliation; B13 own-Shop UI wiring;
B14 product publish; B15 real directory; B16 Shop favorites; B17 facts; B18 expenses;
B19 real analysis. None is implemented by this B10 contract pass. Existing owner
repository, schema and Listing/Message authorities are to be reused, not duplicated.

No B10 migration is needed for the documented deliverable. Any later entitlement
table/RPC/trigger/RLS design needs its own exact forward proposal and approval.
No UI interaction exception is requested now because no UI connection is changed.

B10 acceptance:

- PASS: scope separated from B11–B19; current authority versus fixtures identified.
- PASS: locked ownership/security/data/Contact rules and future event-source
  boundaries recorded with source references.
- BLOCKED: approved positive Plus/Pro/trial eligibility/limits/visibility truth
  table, pending the three decision groups above. B10 is not Completed.
- NOT EXECUTED: new provisioning/concurrency/subscription tests (later-task
  functionality not authorized), database tests/migrations, browser or real cloud
  activation/billing. No new database environment or test/demo fixtures needed.

Executed local checks: `shop-profile.cjs`, `shop-presentation.cjs` and
`public-shop.cjs` all PASS, covering current owner-only/whitelist/no-entitlement
and empty-public-source boundaries. Application TypeScript
(`--noEmit --incremental false`), focused ESLint for those three tests, and
`git diff --check` PASS (existing line-ending notices only). Explicit new-document
encoding/whitespace checks PASS. No new test pretending to validate undecided
entitlements was added. These are offline/source results, not deployed RLS proof.

Future Staging acceptance must first enumerate accounts/Shop/membership/provider
events, grants, publication/activity facts and potentially immutable history and
their removability/impact on existing cards. No such writes, charges, trial grants,
resource cleanup or retained records are authorized by this document. Do not
request or execute permanent records the user has rejected. No remote calls were
made in this pass. Stop for decisions; do not start B11.

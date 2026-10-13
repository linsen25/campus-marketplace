# Minimal formal UI recovery — 2026-10-10

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

> HISTORICAL RECOVERY CONTEXT - NOT CURRENT PRODUCT AUTHORITY.
> This record predates the separately approved [formal detail parity](FORMAL_ORDER_DETAIL_PARITY.md).
> Its simplified-detail/local-selection and isolated-Stepper/tab descriptions are
> superseded by current formal DTO-based detail and exact URL navigation. The
> [closed product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md) now approves terminal
> list filtering and separate linked Order outcomes as pending implementation.
> Do not revert current parity code or infer a permanent product rule from this
> earlier recovery. Evidence below is retained as the original historical record.


At that historical checkpoint, the instruction superseded the interrupted parity expansion. This is a
loading-only recovery, not a new transaction design or backend phase.

## Audit before edits

The global pass touched 23 files. Loading structures/state changes were in
`workspace-skeletons.tsx/.module.css`, `messages.tsx`, `messages-chat.tsx`,
`order-loading.tsx`, `profile-overview.tsx`, `favorites.tsx`, `home-listings.tsx`,
`listing-form.tsx`, `market-layout.tsx` and `use-formal-orders.ts`. Test updates
were `formal-loading.browser.cjs`, `orders-workspaces.cjs` and
`orders-qualification.cjs`; documentation changes were `FORMAL_UI_RULES.md`,
`PROJECT_STATUS.md` and `PROJECT_HANDOFF.md`.

Loaded-state additions outside that narrow remit were:

- `formal-orders.tsx`: detail fetching, query-order selection/navigation and an
  additional Payment panel beyond the prior loaded summary.
- `messages-chat.tsx` / `order-request-preview.tsx`: a new Accepted Request
  navigation action.
- `order-requests-api.ts`, `orders-api.ts`, `order-request-service.ts`: the new
  Order-ID projection/client detail call supporting that navigation.
- `animated-sidebar-demo.tsx`: changing the existing mobile Payment placeholder.

These additions were removed. The original local selection from the authoritative
Orders workspace, listing/media/terms/amounts detail and list-card View Order remain.
The additional detail-fetch branch and Payment panel no longer alter loaded output.
Initial skeletons remain; current content stays visible during background refresh.

The approved frozen `OrderDetailPreview` already contains Stepper, role guidance
and tabs. The separate formal branch did not use that component before the global
pass. The global pass did not delete those preview components. Connecting them to
formal data would be a separate implementation, and is intentionally not attempted
by this minimal recovery. Its original implementation is preserved.

## Interrupted parity changes undone

Removed the unverified new formal detail/progress/presentation helper files and
undid their wiring. Reverted active-list filtering, linked-Order Request outcome
derivation, the extra Orders RLS read, cancelled lifecycle type expansion and
automatic same-contact list expansion. Restored the frozen preview's existing
inline Stepper structure. No parity-only change remains in these paths.

No username dedupe, merging, archive, new navigation model or new product rule was
introduced. Expired historical Orders remain visible according to the prior behavior.
Request acceptance remains the backend historical state.

## Retained loading work

Shared Skeleton primitive and domain structures remain for initial conversations,
chat history, Requests, listing grids, Orders, account fields/avatar and listing
editor session acquisition. Empty/error separation, reduced motion and retaining
existing data on background fetch remain. The detail skeleton matches the restored
summary, without the added Payment block.

## Validation

[Recovery browser checks](../tests/formal-ui-recovery.browser.cjs) exercise real
staging Buyer A, Seller A and Seller B sessions at 390/430/1280/1536. They verify
Active Buyer Accept visibility, no Seller Accept, existing list-card/detail/back
behavior, retained background detail, legitimate same-contact conversations and
no horizontal overflow. No Accept button or confirmation is clicked on the manual
Active fixture; no transaction writes are permitted. Read acknowledgements are
intercepted. [Manual fixture audit](../tests/order-accept.browser.cjs) is read-only.

TypeScript, focused ESLint, Request/Accept static/API, frozen Orders UI, timeline,
TEXT/IMAGE/Realtime and Auth/session regression checks passed. Migrations retain
their verified hashes. No SQL, RPC, RLS, reservation/expiry semantics, API security,
Realtime implementation or staging fixture was changed. Production was untouched.
No commit or push. Stop for manual inspection on localhost:3000.

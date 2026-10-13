# Formal UI loading and feature visibility

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

Applies to the real main application, including localhost:3000 against staging.
Loading changes must never replace or restructure the approved loaded content.
The [minimal recovery record](FORMAL_UI_REGRESSION_RECOVERY.md) is historical.
The later [formal detail parity](FORMAL_ORDER_DETAIL_PARITY.md) defines the current
implemented detail foundation; the [closed product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md)
controls approved future financial, progress and outcome behavior.
The frozen preview is separate; preview perspective and simulated transactions
must never control authenticated formal behavior.

## Permanent state rules

- Initial remote-data load without usable current data: layout-matching skeleton.
- Background refetch with current data: retain content, selection and scroll.
- Mutation: retain content and use the local action's pending state.
- Successful empty response: real empty state, never an initial-loading substitute.
- Failure: error/retry UI; retain usable content on background failure.
- First visit to a nested workspace: its own skeleton, never another workspace's data.
- Local synchronous controls and static content: no artificial loading state.

Use the shared [Skeleton primitive](../components/ui/skeleton.tsx) and domain
structures. Its existing reduced-motion rule disables shimmer. Do not add runtime
delays or a second shimmer system. Test-side response gates may expose real pending
states. Keep skeleton grid geometry, card sizing and mobile breakpoints consistent
with the corresponding destination.

Implemented and authorized actions remain visible regardless of development phase.
Terminal states retain explicit status/action regions. Unimplemented capabilities
use truthful unavailable/pending presentation where needed; never simulated success.
Role checks come from authenticated participants and authoritative API state.

## Current navigation audit

| Destination | Remote regions and loading behavior |
| --- | --- |
| Profile / Overview | Account avatar, identity, email, verification and actions use field skeletons. Existing local demo charts remain labelled demo data and do not pretend to load remotely. |
| Analytics (mobile; also within desktop Overview) | Remote Marketplace category trends retain their existing row skeleton/error/empty states. Local chart controls remain instantaneous. |
| Settings | Shares ProfileOverview field/avatar skeletons; editable account actions wait for authoritative data. |
| Profile Payment (mobile) | Existing placeholder only; no financial remote data or mutation. Future account management belongs under Settings -> Payments & payouts, not this legacy placeholder. |
| Market | SSR supplies resolved initial listings. Existing cards remain during client refresh; if no usable cards exist, pending fetch uses the shared listing skeleton grid. Search/filter/sort/page controls are local. |
| My Listings / Favorites | Shared listing-card skeleton grid replaces the small centered spinner. Successful empty and failure states are separate. Favorites retain prior content on background failure. |
| Create Listing | Account/session acquisition uses form-row/media skeletons. Draft edits remain local; submission retains existing action pending UI. |
| Messages Buying / Selling | Initial conversation workspace uses avatar/preview rows or desktop rail, header, alternating bubbles and composer. First chat history uses body bubbles. Loaded conversations/history stay visible during invalidation/refetch. |
| Request timeline / expanded Request | First history load uses compact Request structures. Expanded cards use already-fetched authoritative snapshots and need no extra fetch. Buyer Active Accept remains visible; Accepted retains its historical state with no second Accept; terminal cards show explicit status. Seller never receives Accept. |
| Orders Purchases / Sales | Initial load uses structural Order-card skeletons. Lists retain data during refresh and show successful empty/error states separately. |
| Order Detail | Uses the real formal Order DTO and exact persisted Order ID in Home URL/workspace navigation; refresh retains detail. Loaded detail includes authenticated role-specific Next Step foundation, Order Progress, Overview / Fulfillment / Payment, media/terms and server-offset countdown when applicable. Matching skeleton appears only while initial remote data is unavailable; background refetch retains the full detail. |

## Visibility audit

The explicit frozen-preview enablement remains necessary to isolate local simulated
state and perspective controls. The formal Requests/Orders staging project guard
remains a rollout safety boundary; it does not suppress implemented capabilities
within the verified staging runtime. Participant/state eligibility remains required.

Formal loaded detail now follows the separately approved parity implementation,
not the earlier simplified summary/local selection. Approved Stepper/tab
presentation is reused safely; preview simulation and perspective authority remain
isolated. Request/Create/Replace/Cancel/atomic Accept authorization is unchanged.

The closed product contract now approves hiding unpaid Expired/pre-payment
Cancelled from default lists and separately presenting linked Order outcomes
beside historical Accepted. These are pending implementation, not behavior already
changed by documentation. No V1 History/Archive tab is authorized. Exact historical
Order references retain normal participant access where supported; default-list
filtering must not silently replace a requested detail with the list.

Full Seller Payment content and role/fulfillment-specific Stepper labels remain
known implementation gaps/bugs; the current foundation must not be mistaken for
completed future financial UX. Five known bugs are recorded in the
[product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md#12-known-implementation-bugs-and-pending-ui-alignment),
without code fixes in this documentation task.

## Historical recovery verification (2026-10-10)

The recovery is validated by [focused browser checks](../tests/formal-ui-recovery.browser.cjs)
and [loading checks](../tests/formal-loading.browser.cjs). Real staging transactions
remain unchanged; test-side gates exercise loading rather than slowing application
code. See the [recovery audit](FORMAL_UI_REGRESSION_RECOVERY.md) for scope/results.

The earlier 48-case global result is historical; its loaded-state additions were
subsequently withdrawn. Do not treat that result as approval to change loaded UI.

Current parity evidence is in [formal detail parity](FORMAL_ORDER_DETAIL_PARITY.md)
and its browser checks. Those checks validate the current pre-payment foundation;
they do not establish unimplemented paid/payout or newly approved filtering/outcome
behavior.

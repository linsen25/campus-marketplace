# Formal V2 Order stage pages — 2026-10-14

This locked UI composition supersedes the earlier three-tab Order presentation.
It preserves the Master Order backend, existing participant identity, immutable
economics, cancellation intent/settlement, Case holds, delivery/courier cutoffs,
handoff verification and Protection authority.

The page is now:

Order header → existing OrderProgress/Velora Stepper → current-stage details →
Current Step instructions → existing real action/waiting components → explanatory
Cancel/Exit block where relevant → one bottom Back/Next navigation row.

No Overview/Fulfillment/Payment tabs remain on the formal V2 page. Legacy V1
compatibility is retained; this pass does not reinterpret its transaction model.

Agreement / Terms is shown only on Review. Original Offer uses the frozen asking
price; unavailable historical fulfillment baselines are not invented. Confirmed
Offer contains immutable listing media/title/description/category/condition,
Buyer/Seller snapshot names, agreed item amount, fulfillment/subtype, accepted
coarse delivery area or current mutually confirmed meetup/time, note, agreement
status and role-correct server economics. Buyer savings are positive differences
between frozen asking and agreed prices only. Later pages render payment,
meetup/delivery/shipping, Protection or completion subsets.

The public Order Number is the existing UUID with hyphens removed and uppercase,
validated as exactly 32 hex characters. Only Agreement / Terms displays it.
An Order-local lucide Copy/Check icon button copies exactly this reference;
clipboard errors are recoverable and do not expose tokens. No reusable clipboard
control was found. No new identity or migration is introduced.

Back/Next keep only an in-memory view index. `lib/order-presentation.ts` derives
accessible bounds from existing Order/fulfillment/checkout/courier projections.
Unpaid/Processing cannot open fulfillment; Seller delivery requires authoritative
Start Delivery before handoff; Courier requires Shipped before receipt; Protection
requires confirmed possession; Completed requires authoritative completion.
Paid On Campus may inspect and view already-authorized handoff methods; navigation
does not mark inspection complete. Stepper props never use the view index.
Remount reconstructs the authoritative current page, and changed authoritative
state invalidates the older selection. Past completed stages contain no mutation
components. Closed Orders may review Agreement and payment evidence without
claiming that a payment occurred.

The existing DynamicAction gains optional `direction="back"`, defaulting to its
unchanged forward behavior. Back uses blue/left arrow; Next uses green/right arrow.
Cancel uses red/right arrow at the block's bottom-right. Its availability and
financial paths still come from the existing server projection and endpoints.
Processing cancellation, Seller full-refund response and disputed Case holds
retain their current mutation/reconciliation code.

On Campus and Seller delivery show separate QR placeholder and 6-digit blocks
only when authoritative handoff is available. Buyer reads the real server-issued
code; Seller verifies it through the existing API. The raw QR payload is never
displayed. Real QR rendering/scanning remains deferred. Courier has no QR/code.
Seller exact delivery destination is never rendered before Paid; Agreement
contains only the accepted coarse area.

Qualification uses actual components/hooks/CSS with isolated offline projections
and intercepted transport; it is not a hosted payment or manual-account test.
The stage matrix covers both roles, three fulfillment modes, read-only history,
navigation bounds, exact clipboard contents, unchanged Stepper, action endpoints,
error recovery, remount and responsive geometry at 390/430/1280/1536. The existing
`tests/order-flow-ui.browser.cjs` command now runs the stage-based qualification
while retaining its established isolated transport fixtures. API/payment/progress,
Messages and session regressions remain independent of that layout test.

No backend/API/RPC/migration changes, staging mutations, manual transaction
consumption, production access, `.env.local` edits, Auth/Messages/Offer/Agreement
milestone changes, commit or push are part of this UI pass.

Files changed in this pass:

Final qualification passed: 208 Buyer/Seller UI scenarios at
390/430/1280/1536, including all three fulfillment modes, Courier receipt,
read-only navigation, unchanged Stepper markers, exact Order Number copying,
action retry after an authoritative failure and remount reconstruction. No
runtime errors or hosted requests occurred. TypeScript, focused ESLint,
Order-domain/Campus-payment APIs, Payment/Progress UI regressions,
Messages/session regressions, source security/documentation links and
`git diff --check` pass. Git index remains empty; existing unrelated worktree
changes are retained.

- `components/home/formal-v2-order-detail.tsx`
- `components/home/order-stage-details.tsx`
- `components/home/order-stage-page.module.css`
- `components/home/order-current-step.tsx`
- `components/home/order-flow-cancellation.tsx`
- `components/home/order-campus-payment.tsx`
- `components/ui/dynamic-action.tsx`
- `components/ui/dynamic-action.module.css`
- `lib/order-presentation.ts`
- `tests/order-presentation.cjs`
- `tests/order-stage-pages.browser.cjs`
- `tests/order-flow-ui.browser.cjs`
- `docs/ORDER_STAGE_FLOW_UI.md`
- `docs/ORDER_MASTER_FLOW_REWORK.md`

# Current manual-flow fixes and pre-payment cancellation

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

Only real `localhost:3000` / staging `pcaqxezdfxofysghssyo` was targeted.
Production was not accessed. No commit/push or later feature work.

Later approved terminal-presentation rule supersedes the original default-list
hiding below: Expired and pre-payment Cancelled Orders now remain visible as
muted history with View details. Both omit active Progress/Next Step/payment
controls and preserve Request Accepted plus the separate linked Order outcome.

| Requested item | Implementation / evidence |
| --- | --- |
| 1. Request scrollbar | Shares Home/Profile/Settings CSS selectors: transparent track/thumb; scrolling thumb `#f5f5f5`; 140/200 ms fade and 600 ms idle removal. Editor `overflow: auto`, fixed right card/footer, no outer scroll. |
| 2. Attachment fade | Transparent mounted surface gets two animation frames before opacity transitions to 1; exit transitions to 0 for 200 ms before unmount. Reduced motion zero duration. Browser samples computed opacity each frame at four widths, including intermediate exit values while mounted. |
| 3. Back | `< Back`, existing light-purple subtle navigation color. |
| 4. FileDrop | Existing label is 1:1 on desktop, bounded by column, 360 px and viewport height. Mobile stacked; no outer scroll. |
| 5. Carousel | Two valid in-memory PNGs: Next/Previous, hit-tested top layer, index and disabled boundaries pass at four widths. |
| 6. Confirmation | Go Back red; Confirm & Send / Replace & Send green. UI tests never send a real Request. |
| 7. View Order | Formal Request history Close red / View Order green. Formal Orders navigation green. |
| 8. Detail Back | Existing subtle navigation uses ChevronLeft, retaining Purchases/Sales behavior. |
| 9. Authority | `marketplace_cancel_order(uuid,text,text,uuid)` resolves `auth.uid()`; verified participant required. Application staging guard and same-origin POST; no client identity trusted. |
| 10. Migration | Only `202610110003_order_cancellation.sql` applied on staging after transactional rollback dry-run; old migrations unchanged. |
| 11. Reasons | Buyer: `buyer_changed_mind`, `buyer_payment_issue`, `buyer_scheduling_issue`, `buyer_terms_issue`, `other`. Seller: `seller_item_unavailable`, `seller_scheduling_issue`, `buyer_requested_cancellation`, `seller_terms_issue`, `other`. Other requires trimmed note, maximum 1000 characters. |
| 12–14. UI/dialog | Both roles get normal red Cancel order for open unpaid fixed/shipping-pending Orders. Spacious FadingDialog card, existing GlideSelect with unchanged role-specific reason codes, optional/required note, green Keep order and red Cancel order. Keep order sends zero cancellation requests. Success returns to Purchases/Sales History with authoritative list refetch/recovery. Expanded Request shows status/outcome/agreed terms and green View details; cancellation facts remain exclusively in the full Order report; list-row View details stays neutral. |
| 15–17. Atomic effects | Listing→Order lock order, authoritative expiry/eligibility, immutable cancellation fields/event, owned unpaid hold released. Listing Available; Request stays Accepted. Both roles and shipping pending tested with rollback fixtures. |
| 18–19. History/list | Both participants see role, human reason, optional note and authoritative time. Cancelled Orders hidden from default list; Accepted Request keeps View Order. No extra TEXT message. |
| 20-21. Race boundaries | Ordered rollback cases plus 15 real overlapping independent-transaction pairs now pass; both winner orders and same-command contention verified via actual blocking PIDs. See concurrency results below. |
| 22. Idempotency | Same UUID returns same row/timestamp/reason/event. Later valid reason/key does not rewrite cancellation; same UUID with changed input rejected. |
| 23. Responsive | 390/430/1280/1536 attachment/editor checks and both-role cancelled detail/history/default-list checks pass. Browser cancellation responses are intercepted synthetic DTOs. |
| 24. Manual Nike Order | Prior fingerprint changed through expected lazy expiry after its deadline while the real page remained open; see explanation below. Do not restore or modify this Expired Order. |
| 25. Payment/Progress | Payment RPC/Phase E/Phase F modules unchanged. Cancelled detail suppresses active payment/progress presentation using authoritative lifecycle. |
| 26–28. Safety/checks | Production untouched, no commit/push, TypeScript/focused lint/offline regressions/diff check pass. No credential artifacts or configured privileged secrets found among commit-eligible files. |

Applied migration SHA-256:
`43b98b5424874e54be4b9f8497e029afed9f06c395f9f5375b96ba03b5ae2992`.

Minimal new fields: cancelled timestamp, original actor UUID/role, stable reason
code/label snapshot and note. Existing table grants/RLS unchanged. The immutable
Order trigger adds cancellation while retaining payment/expiry rules. The event
trigger adds one `order_cancelled` event plus existing private invalidation.
No Request rewrite, payment provider, quote, handoff, protection, issue or payout.

Successful cancellation immediately installs the **server response** in the Order
query and fences older reads. Failed refetch retains the non-actionable cancelled
result and offers Refresh order; later exact reads recover. No fake final state.

## Manual Nike Order: expected existing expiry

Initial read-only audit found Nike Order `b289dd54-b226-4e1f-9f65-6e530a885911`
Open/Pending, reservation deadline `2026-10-11T09:40:31.872422Z`.
Migration application and rollback SQL tests preserved existing data fingerprints
at their verification boundaries.

The prior final fingerprint differed: this Order is now Expired, payment Pending,
cancelled timestamp null, Nike Available, with one `reservation_expired` event at
`2026-10-11T09:41:17.363963Z`. Request and capability fingerprints are unchanged.

Existing read RPCs settle elapsed reservations. The cancellation browser suite's
Order/history projections were intercepted (the UI-blocker suite reads Seller B's
real Monitor conversation). Server compilation logs do not attribute individual requests
to tests versus an already-open manual browser. The user confirmed that the real
page stayed open, without deliberately refreshing or reopening the Nike Order.
The existing formal Orders hook refreshes on mount, every 15 seconds, on window
focus and on order-change events. Automatic polling can therefore reach the
expiry-on-read path without a manual refresh. Development HMR/remount during code
changes is another possible trigger; a render alone does not prove a read occurred.
The exact initiating request, including whether HMR caused it, remains **not
proven**. The user has confirmed this is expected existing expiry behavior, not
an unexplained mutation: the deadline passed while the authoritative page remained
open. No restoration, extension, payment or compensating cancellation was done.
This Order cannot be used for a new active pre-payment Cancel click and must remain
Expired. The concurrency validation uses separate synthetic Orders only.

## Independent-transaction concurrency validation (2026-10-11)

**ORDER CANCELLATION CONCURRENCY VALIDATION COMPLETE.**

Run `node tests/order-cancellation-concurrency.cjs`. The harness fails closed unless
`.env.staging.local` specifies staging and `pcaqxezdfxofysghssyo`; every hosted query
explicitly targets that project. It creates two synthetic confirmed identities
through SQL only (no Auth emails), their own Ready payout/Set payment capabilities,
and a new accepted shipping-included Order for each case. No canonical account,
capability or manual Request is used for a mutation.

Each pair uses two independent Supabase management database queries with explicit
`BEGIN`/`COMMIT`. The designated winner executes the actual RPC/settlement and then
holds its transaction and locks open with `pg_sleep(12)`. An observer waits until
`pg_stat_activity` confirms that barrier, then starts the contender's actual RPC.
The observer requires distinct backend PIDs and transaction IDs, a real `Lock`
wait and `pg_blocking_pids(contender)` containing the winner. Only then are both
results awaited. This is overlapping uncommitted transaction contention, not two
sequential committed calls. For example, the first Cancel/Payment pair used PIDs
476925 and 476933. No deadlock/timeout retry is performed.

| Concurrent pair / controlled winner | Repetitions | Authoritative result |
| --- | --- | --- |
| Cancel wins against Payment | 3 | Cancelled/Pending, Listing Available, hold released, one cancellation event; payment returns `order_not_payment_ready`. |
| Payment wins against Cancel | 3 | Open/Paid, Listing Reserved by the same Order, hold retained, one `payment_paid`; cancellation returns `order_not_cancellable`, no cancellation metadata. |
| Cancel wins against expiry settlement | 3 | Cancellation happens before the synthetic deadline; its transaction remains open across the deadline while expiry waits. Cancelled remains terminal, Listing Available, one cancellation event, zero expiry events. |
| Expiry settlement wins against Cancel | 3 | Synthetic deadline already elapsed. Expired/Pending, Listing Available, one `reservation_expired`; cancellation rejected, all cancellation metadata null. |
| Two identical Cancel commands | 3 | Second caller waits on the same idempotency advisory lock. Both return the same authoritative Order, including original timestamp/reason/note; one command and one cancellation event, no repeated inventory mutation. |

Total: **15 overlapping pairs / 30 operation transactions**, all with observed lock
contention. Paid + Cancelled, released Paid inventory, duplicate terminal events,
partial cancellation metadata and invariant failures: **0**. Deadlocks (`40P01`),
lock timeouts (`55P03`, configured 30 seconds) and statement timeouts (`57014`,
configured 45 seconds): **0**. Domain rejection of the losing operation is expected.
Every Request remains Accepted. Owned inventory is released by the one winning
Cancel/Expiry transition; losing/repeated commands do not release it again.

Cleanup removed all 15 synthetic graphs and both identities/capabilities. Exact
pre/post fingerprints match for Auth users, profiles, Listings, conversations,
messages, Favorites, Requests, Orders, transaction events, commands and financial
capabilities. Trigger states also match. Thus canonical capability rows and the
already Expired Nike Order remain unchanged during this validation. Synthetic
deadlines were adjusted only on the harness-owned Order rows; retention guards
were temporarily bypassed only inside scoped cleanup under exclusive locks and
restored before commit. No application/RPC/migration change was needed.

Detailed PID/wait/response/state evidence and fingerprints remain in Git-ignored
`tests/artifacts/order-cancellation-concurrency/`; no credentials or sessions were
generated. Production untouched; no commit/push; no later feature work.

## Checks

```powershell
node tests/order-cancellation.cjs
node tests/order-cancellation-staging-admin.cjs test
node tests/order-cancellation-concurrency.cjs
node tests/manual-ui-blockers.browser.cjs
node tests/order-cancellation.browser.cjs
```

The staging SQL test creates synthetic identities, capabilities and a transaction
graph entirely inside a transaction, then rolls everything back. Browser tests
use existing staging sessions and intercepted cancellation DTOs. Credentials,
screenshots, frame samples and fingerprint diagnostics stay in ignored artifacts.
Do not rerun demo reset or recreate old manual fixtures. The current app remains
available via `npm run dev:staging -- --port 3000`.

## Files changed in this pass

- UI: `components/home/animated-sidebar-demo.module.css`,
  `message-attachments.tsx`, `message-attachments.module.css`, `messages-chat.tsx`,
  `messages-chat.module.css`, `order-request-preview.tsx`, `formal-orders.tsx`,
  `formal-order-detail.tsx`, `order-detail-preview.module.css`, and new
  `order-cancellation.tsx` in the same directory.
- Data/API: `hooks/use-formal-orders.ts`, `lib/orders-api.ts`,
  `lib/server/orders-service.ts`, `pages/api/orders/[[...segments]].ts`,
  `types/order.ts`, and the new staging migration above.
- Tests: `tests/manual-ui-blockers.browser.cjs`, new `order-cancellation.cjs`,
  `order-cancellation.browser.cjs`, `order-cancellation-staging-admin.cjs`,
  `order-cancellation-staging.sql` in `tests/`.
- Documentation: this report and `docs/PROJECT_STATUS.md`.

Final checks: TypeScript and focused ESLint pass; cancellation API/rollback tests,
Request API/static/Create/Replace/Cancel, Accept/static/recovery, Orders visual/
replacement, Phase C/D/E/F, Messages TEXT/IMAGE/Realtime, Settings and Auth/session
offline regressions pass. Both browser suites pass four widths with zero runtime
errors. Local Markdown links pass (43 files); served browser privileged-secret scan
passes (8 chunks). Commit-eligible sensitive-name/pattern/configured-secret scans
find no matches; Git index empty and `git diff --check` passes. These passing checks
describe the prior pass; the independent-transaction gap is now closed by the
concurrency results above, and the earlier Nike fingerprint change is explained
by expected existing lazy expiry.

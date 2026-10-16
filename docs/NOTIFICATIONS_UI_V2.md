# Notifications UI V2 qualification

Completed 2026-10-15 against the real localhost:3000 app and staging project
`pcaqxezdfxofysghssyo`. No production access, commit, or push.

Follow-up: the current navigation uses the ordinary sibling Bell icon without an unread dot.
The original dot and the route-selector alignment issue were corrected in
[Contact Seller / navigation qualification](CONTACT_SELLER_FIRST_CONTACT.md).
The global Bell remains the unread indicator.

## Implementation

The former `NotificationBell` owned the feed hook and displayed the full list in
`FadingDialog`. The original data/refetch/pagination logic now lives in one
`NotificationsProvider` mounted in `_app.tsx`. Bell and navigation indicators
consume that context; neither creates a subscription. The existing notification
Broadcast listener is retained once in that provider. Messages' existing listener
and business behavior are unchanged.

Bell now pushes `/home?section=notifications`; no full-feed dialog remains.
`AnimatedSidebarDemo` renders Notifications immediately above Settings in both its
desktop sidebar footer and mobile Home menu. The view uses the existing Home
content container/header/gutters; sidebar geometry and other sections are intact.
The navigation shows a restrained unread dot, while Bell and feed show counts,
all derived from the same authoritative `unreadCount`.

The feed moved into `NotificationsView`, retaining existing read/unread rows,
timestamps, cursor pagination, error/retry and StatefulButton mark-all behavior.
Loading uses project Skeleton and the empty state uses WorkspaceEmpty. Rows have
hover, pressed and keyboard-focus treatment. Unread is also expressed in text.
Provider/email internals and private transaction fields are never rendered.

Row activation awaits the existing mark-read API and reconciles with GET before
navigation. A mark-read failure shows recoverable feedback and still attempts
navigation; it never fabricates read state. Mark-all uses the existing authoritative
POST and shared refresh, updating Bell, navigation and list together. Account
changes/logout invalidate in-flight results, reset pagination, and tear down the
existing listener. Opening a feed does not add a second listener.

## Safe destinations

The email/shared `notificationTarget` helper and stored destinations are unchanged.
The new UI-only `notificationUiTarget` preserves its strict UUID and destination
allowlist, adding an Offer UUID only for Offer-related Messages targets.

| Notification family | UI destination |
| --- | --- |
| Message | Exact Buying/Selling conversation UUID |
| New/counter/declined/closed/withdrawn Offer | Exact conversation plus Offer UUID; existing OfferCard opens its existing detail |
| Accepted Offer / Agreement | Exact Purchases/Sales Order UUID |
| Agreement confirmed / Payment | Same Order, authoritative current stage |
| Delivery / Handoff / Protection / Case | Same Order, authoritative current stage/support surface |
| Cancelled / Expired / Completed | Same Order, authoritative terminal/history presentation |
| Existing financial Settings target | Existing Settings route |
| Existing saved Listing target | Existing Favorites route |

Order Detail already initializes from `orderPresentation` and current server flow.
No Order stage logic or URL stage override was added. An older Agreement/Payment
notification cannot force a progressed or terminal Order backwards. Destination
access remains protected by the existing conversation and Order APIs.

## Verification

- Real localhost:3000 with two disposable authenticated staging sessions:
  recipient-only private Broadcast, Bell shortcut, dedicated feed, authoritative
  read-on-click, return via Bell, live update while feed is open, mark-all and
  other-account isolation passed. Cross-user API mark-read is 403; other-user
  direct RLS SELECT returns zero. Direct client INSERT and outbox claim are denied.
- Real Home layout at 390, 430, 820, 1280, 1536: exactly one feed, no notification
  dialog or horizontal overflow. Mobile menu and desktop sidebar both place
  Notifications above Settings and expose the active entry.
- Real business fixture in staging: incoming Offer opens exact conversation and
  existing Offer Detail; message opens exact conversation; Agreement notification
  opens exact Purchase Order in Agreement; after both actual confirmations the
  notification opens Payment; an older Agreement notice still opens Payment.
  After actual cancellation an older Payment notice opens closed history, and the
  Seller's cancellation notification opens the same Order in Sales history.
- Offline actual Bell/feed components at all five widths: empty/feed, unread
  Broadcast refresh, shared nav/Bell state, one listener, mark-all, safe route,
  retry, logout teardown, no dialog and no overflow passed.
- Offline actual OfferCard at all five widths: notification entry opens Active,
  Replaced, Accepted and Expired detail without a mutation.
- TypeScript and focused ESLint passed.
- Notification API/no-store/CSRF/session, safe navigation, Messages Realtime,
  Order presentation/current-step and email worker unit regressions passed.
  Worker tests were offline; no Resend worker was invoked for this UI pass.
- `git diff --check` passed (only existing Windows LF/CRLF advisory warnings).

The first business-fixture run passed navigation but its older media cleanup
helper did not cover cancellation sidecars. The exact journal was recovered after
ownership checks; the destination test now removes those sidecars locally within
its own synthetic scope before invoking existing graph/media cleanup. A complete
repeat passed including original-data and `.env.local` fingerprint equality.
All synthetic users, Listings, Offers, Orders and public/private media from these
tests are removed; both notification fixture journals are absent. Canonical,
manual/Nike and unrelated D1 data are unchanged.

## Exact UI-pass files

- `components/notifications/notification-bell.tsx`
- `components/notifications/notification-bell.module.css`
- `components/notifications/notification-state.tsx`
- `components/notifications/notifications-view.tsx`
- `components/home/animated-sidebar-demo.tsx`
- `components/home/messages-chat.tsx` (only exact notification Offer selection)
- `components/home/offer-ui.tsx` (only existing detail opening for that selection)
- `pages/_app.tsx`
- `lib/notification-navigation.ts`
- `tests/notification-bell.browser.cjs`
- `tests/notification-foundation-staging.cjs` (dedicated feed assertion and UI-only mode)
- `tests/notification-navigation.cjs`
- `tests/notification-offer.browser.cjs`
- `tests/notification-destinations-staging.cjs`
- `docs/NOTIFICATIONS_UI_V2.md`

The worktree also contains the earlier, uncommitted Notifications/email foundation.
Those backend/API/worker/config/migration files were not changed in this UI pass.
All five existing foundation migration hashes still match their recorded values.
No migration was created/applied. Backend authority, email event matrix, scheduler,
outbox, Resend and business transitions are unchanged. `.env.local` is unchanged.
The Git index is empty; work remains uncommitted and unpushed.

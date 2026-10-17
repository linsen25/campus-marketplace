# Notification preferences and realtime popups

Qualified 2026-10-16 on staging `pcaqxezdfxofysghssyo` and localhost:3000.
No production access, commit, push, or real email send in this pass.

## Account preferences

`public.notification_preferences` extends the existing notification domain, which
had no durable account preference store. Missing rows return compatibility defaults:

| UI setting | Stored field | Default | Meaning |
| --- | --- | --- | --- |
| In-app notifications | in_app_notifications | true | Realtime popup interruptions only; inbox, unread, Broadcast and email remain independent. |
| Notification sounds | notification_sounds | false | Plays the provided WAV for new realtime popups only when In-app notifications is also enabled. |
| Email notifications | email_notifications | true | Server-side email delivery eligibility only; inbox and popup delivery remain independent. |

Own-row SELECT RLS and verified `auth.uid()`-scoped read/set RPCs; no direct client
writes. A partial update changes one allowlisted boolean without overwriting other
settings. The API preserves the existing staging/session/CSRF/no-store boundary.
Settings consume the shared Provider preference state. Saves retain the last
server-confirmed value until success; failure is retryable. Refresh/login hydrate
from the server, and reconnect revalidates preferences. No localStorage authority.

## Supplied switch

The user's supplied Squish Switch lives at
`components/react-bits/squish-switch.tsx` with a CSS module. The original velocity,
flow/swell springs, thumb stretch, pointer capture and keyboard click interaction
remain; TypeScript, accessible names/focus and local styles adapt it to this app.
Settings use 56 x 30px, the existing `#9375c4` accent and dark neutral track.

## One notification stream

The existing recipient-private `notifications_changed` Broadcast carries a bounded
safe inbox projection on INSERT. UPDATE/removal remains an invalidation only.
`connectMessagesRealtime` forwards this payload to the same Notifications Provider;
there is no additional channel, popup fetch or duplicate notification insert.
The existing authoritative refresh updates inbox/count before popup presentation.
Filters/pagination do not determine which new events can show popups.

Initial hydration/refetch/reconnect only seed known IDs. Only new INSERT signals
after initial hydration can enter the popup queue. IDs received while disabled are
remembered too, so enabling popups does not replay those signals. Per-account
recent IDs (bounded to 1000) deduplicate same-session remounts/reconnect signals;
logout clears queue/session state. The queue is bounded to 20 records, displaying
at most three on desktop and one on mobile/tablet. Each visible popup dismisses
after six seconds unless hovered/focused/pending. Dismissal never marks read.

Popup navigation uses the existing UUID/role-validated destination resolver and
the read helper extracted from View into the Provider. It preserves server-confirmed
read timestamps, shared unread reconciliation and refresh/retry behavior. A popup
without a valid target is non-interactive except its dismiss control. No extra
View/arrow controls or private chat/order details appear in the popup.

## LISTING destination audit

The former `notificationTarget` listing branch hardcoded Favorites as a fallback.
The active staging `listing_price_drop_projector` trigger emits `price_drop` with
the exact Listing UUID. It reads `listing_favorites` only to select the audience;
neither adding nor removing a favorite creates a new notification in this pass.
No current business event requires the Favorites page as its destination.
The category mapper accepts `price_drop` and any safe `section: listing` destination;
the current business producer is `price_drop`. With explicit user approval, the
shared resolver now returns `/listings/{listingId}`. No stored notification or
already-frozen email envelope was rewritten. Price-drop is not in the current
email-eligible event allowlist.

## Email enforcement and boundaries

The notification trigger always retains the inbox row/Broadcast but checks email
preference before creating an outbox row. Opt-out retires pending/retryable work,
preserving audit. The public claim/prepare RPCs add preference checks around the
unchanged legacy lease/idempotency/retry core, now private and inaccessible to
client/service callers except through the guarded public entry points. Prepare
also rejects a delivery claimed before opt-out. Re-enabling does not resurrect
retired work. Sent history/provider IDs remain intact.

An already-prepared request that has reached the provider cannot be recalled by
this preference. Active leases are not invalidated, so a provider acknowledgement
can still be recorded correctly after opt-out. No provider, retry or refund
policy was invented. The Edge worker implementation was not changed/redeployed.

## Notification sound integration

The supplied `public/static/sounds/notification.wav` is used unchanged at
`/static/sounds/notification.wav`, volume 0.45, looping disabled. Settings no longer
shows Coming soon. Durable preference/defaults remain unchanged; no additional
migration or server change is needed for audio.

The existing accepted-new-popup/dedupe branch invokes one reusable Audio player
after React can commit the popup. Same-frame bursts coalesce into one cue; later
eligible notifications pause/restart that same instance at time zero. No overlapping
players or delayed audio backlog. Each popup retains its normal queue entry.
Audio has no independent ID dedupe or subscription. Both settings and the current
authenticated actor must allow playback. Disabling either, logout or unmount
cancels pending playback and releases the Audio instance.

Play rejection (autoplay policy, interruption, decoder/network failure) is handled
silently. Notification data/UI never await audio. There is no disruptive toast,
forced gesture workaround, polling retry or replay of the rejected event. Future
new eligible events may attempt playback normally after browser interaction.

Five-width sound tests instrument the real player/Provider and cover both switches,
four categories, hydration/reconnect/remount silence, shared dedupe, restart/no
overlap, blocked autoplay/recovery, email independence and logout cleanup. Existing
popup destinations, read behavior and layout remain intact.

Real localhost/staging qualification also verified sound ON and OFF across refresh,
ON across logout/login, and an actual private Broadcast producing exactly one native
WAV playback at 0.45. The browser decoded the unchanged approximately 1.50-second
asset and allowed playback. All disposable accounts/preferences/notifications were
removed; original transaction/chat fingerprints remained unchanged.

Audio integration files: `use-notification-sound.ts`, `use-notification-popups.ts`,
`notification-state.tsx`, `notification-settings.tsx`,
`notification-settings.module.css`, `notification-sound.browser.cjs`,
`notification-preferences.browser.cjs`, `notification-preferences-live.cjs`, and
this document. No backend/API/migration change was needed for sound.

## Migration and qualification

New additive migration: `202610160002_notification_preferences.sql`.
SHA-256: `5839f56036f4e15035531d4ebef59d8ef1321bc08896336cb4682a956a2a3dd8`.
Candidate rollback validation passed before staging application; deployed tests
passed again. Earlier migrations were not edited.

- TypeScript, focused ESLint and git diff checks passed.
- Existing notification API/browser/navigation, Realtime and email worker tests passed.
- Preference API tests cover exact booleans/keys, CSRF/session/staging, no-store,
  no actor injection and sanitized errors.
- Real components at 390/430/820/1280/1536 cover switches, persistence, failed save,
  keyboard, popup categories, exact routes, read/dismiss, no initial/reconnect/off-period
  replay, bounded stacks, automatic dismissal, one subscription and logout cleanup.
- Staging rollback tests cover defaults, per-account/partial persistence, grants/RLS,
  email queue/prepare guards, inbox independence and sent/in-flight audit preservation.
- Existing deployed inbox/90-day retention rollback regression passed.
- Real localhost with two isolated synthetic staging accounts covers all five
  Settings sizes, refresh/logout/login persistence, account isolation and actual
  private Broadcast -> popup -> read/count/navigation. All synthetic accounts,
  preference rows and notification events were removed. Original Listing, Request,
  Order, conversation and message fingerprints were unchanged. No email was sent.

## Files in this pass

- components/home/profile-overview.tsx
- components/notifications/notification-state.tsx
- components/notifications/notifications-view.tsx
- components/notifications/notification-settings.tsx
- components/notifications/notification-settings.module.css
- components/notifications/use-notification-preferences.ts
- components/notifications/notification-popups.tsx
- components/notifications/notification-popups.module.css
- components/notifications/use-notification-popups.ts
- components/notifications/use-notification-sound.ts
- components/react-bits/squish-switch.tsx
- components/react-bits/squish-switch.module.css
- lib/messages-realtime.ts
- lib/notification-preferences.ts
- lib/notification-presentation.ts
- pages/api/notification-preferences.ts
- supabase/migrations/202610160002_notification_preferences.sql
- tests/notification-bell.browser.cjs
- tests/notification-navigation.cjs
- tests/notification-preferences-api.cjs
- tests/notification-preferences.browser.cjs
- tests/notification-preferences-staging.cjs
- tests/notification-preferences-staging.sql
- tests/notification-preferences-live.cjs
- tests/notification-sound.browser.cjs
- public/static/sounds/notification.wav (provided asset, unchanged)
- docs/NOTIFICATION_PREFERENCES.md

Unrelated user files were not altered. The provided WAV is integrated by URL only;
its bytes, name and format are unchanged.

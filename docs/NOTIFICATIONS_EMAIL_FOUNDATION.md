# Notifications and transactional email — staging foundation

Target: `pcaqxezdfxofysghssyo`. No production deployment, provider secret retrieval,
historical notification backfill, or transaction-authority change is part of this pass.

## Existing authority and extension

The original `202610130001_notifications_domain.sql`,
`202610130006_notifications_due_work.sql`, `202610130009_payout_notifications.sql`
and the later Offer-revision projector already provide:

- private unique source-key events, recipient notifications and own-user RLS;
- cursor feed and idempotent own mark-read RPCs/API;
- transaction/Offer/fulfillment and payout projectors;
- price-drop coalescing and durable reminders;
- the existing minute-based transaction due-work cron.

This implementation extends that authority; it does not introduce another business
event system. New notification inserts atomically enqueue their enabled email
delivery. Resend never runs inside a marketplace transaction. Realtime failure is
isolated from the durable insert/outbox; it is only an invalidation hint.

`202610150004_notification_delivery_foundation.sql` adds a private email delivery
table, notification insert/read invalidations, mark-all-read, Agreement/message
projectors and the worker RPCs/schedule. It updates only notification projection,
not the authoritative transactions. No old notifications are enqueued for email.

`202610150005_notification_edge_service_claims.sql` supports platform-issued
service-role JWTs that omit the optional `ref` claim. PostgREST still validates the
project signature, service_role remains mandatory, explicit wrong refs fail, and
the Edge worker requires the exact staging URL. Applied migration sources remain
immutable.

`202610150006_notification_scheduler_transport_privacy.sql` replaces only the new
email invoker with the native `http` extension. Managed `pg_net` tables have PUBLIC
grants that the project role cannot revoke; storing a long-lived auth header there
would be inappropriate. The final invoker uses Vault credentials only in memory,
never queues headers, has a 120-second HTTP timeout and is not client-executable.
The new worker credential was rotated entirely inside Vault. The existing domain
due-work cron remains unchanged. `pg_net` is not used by the final email dispatcher.

`202610150007_notification_agreement_trigger_return.sql` supplies the normal
`RETURN NEW` in the notification-only Agreement trigger. Full actual-RPC rollback
qualification covers Offer Accept and both confirmations, not only outbox inserts.

`202610150008_notification_delivery_audit_retention.sql` preserves original safe
failure classification and terminal failed status when disposable source notices
are cleaned up. Attempted provider audit is retained; only unattempted work is deleted.

## Event matrix

All events below produce in-app notifications. Email is enabled except where noted.
Only current authoritative event types are projected; no provider events are invented.

| Source | Recipients | Email |
| --- | --- | --- |
| incoming Offer / Counter | recipient, not sender | Yes |
| Offer accepted / declined | Offer sender, excluding actor | Yes |
| Offer closed / no longer available | affected participants, excluding actor | Yes |
| Offer withdrawn | other participant | No |
| Agreement created | both participants need confirmation | Yes |
| first Agreement confirmation | other participant still pending | Yes |
| both Agreement confirmations | both, with payment-available explanation | Yes |
| authoritative payment paid | Seller | Yes |
| authoritative payment failed | Buyer, including provider-independent failure result | Yes |
| Meeting proposed / confirmed / declined | other participant | Yes |
| Seller Delivery started / Courier shipped | Buyer | Yes |
| handoff ready / verified / Protection started | affected participants excluding actor | Yes |
| Courier delivered | both participants | Yes |
| Buyer receipt confirmed | Seller | Yes |
| cancellation requested / Case opened | other participant, or both for system events | Yes |
| Order cancelled / completed / reservation/no-show expired | affected participants excluding actor | Yes |
| existing Meeting/checkout/payment reminders | reminder recipient | Yes |
| existing payout paid / needs attention | Seller | Yes |
| price drop | existing Favorites coalescing | No |
| new TEXT / IMAGE | other conversation participant | **No** |

Agreement completion is one logical notification per recipient, not a separate
duplicate payment-required notification. The Buyer and Seller receive the same
state fact; payment remains a Buyer action. An own confirmation is never described
as another participant's action. Payment copy refers to the current authority,
without claiming a real payment provider has been integrated.

No standalone Case-resolution/settlement-complete event authority exists in the
current domain. No such event or financial policy is invented here. Notifications
for cancellation use the existing Order outcome; Cases use the existing hold event.
Future domain events can reuse the same projector and outbox.

## Delivery and security

`notification-email-worker` is a bounded Supabase Edge Function. It accepts no
client-selected recipient, subject or HTML. Its default JWT gateway check is off
because cron uses an opaque Vault credential; **the handler authenticates every
request** against the private DB check before claiming anything. Built-in runtime
service credentials are also allowed. The Vault credential is generated in SQL,
never exported to local files or browser JavaScript. The cron command references
the private invoker, not a literal credential. The final native-HTTP transport does
not persist auth headers. Existing due-work scheduling is retained.

One additional minute-based cron invokes only the email worker. Claim uses one
atomic `FOR UPDATE SKIP LOCKED`/update transaction, a fresh per-claim lease token
and a three-minute lease. Worker batch size is three; HTTP operations have ten-second
timeouts. Only the lease owner can prepare/finish a delivery. Abandoned work is
recoverable; a late worker cannot overwrite a newer lease.

Statuses: pending, sending, retryable, sent, permanent_failure. Fields record attempts,
next attempt, lease, provider ID, accepted/sent timestamp, safe error classification
and a future provider-status field for delivered/bounced/failed/complained.
`sent` means **Resend accepted**, not proven inbox delivery.

The initial recipient is resolved from `auth.users` server-side. At first attempt
the complete provider request is frozen privately to keep recipient/from/template
and CTA identical on retries if account/configuration changes. This deliberate
private email snapshot is not exposed through the notification feed or Realtime.
Provider raw responses, keys and handoff credentials are never stored in it.

Resend key: `campus-marketplace/<delivery-id>`. Maximum five attempts; backoff is
60s / 300s / 900s / 3600s. Rate limits, server failures and unknown transport outcomes
retry the same payload/key; permanent request/sender errors stop. Automatic retries
stop at 23 hours after first attempt, before Resend's 24-hour idempotency window
expires. An uncertain send is never automatically restarted with a new key.

Attempted provider audit survives source-notification fixture cleanup with its
original notification identity and private envelope. Unattempted synthetic work may
be deleted. No frontend can read/write deliveries, call worker RPCs, create a
notification, or mark another user's notification read.

Notifications store bounded internal destinations; presentation reconstructs only
allowlisted routes/UUIDs. No chat content, exact address, QR token, handoff code,
payment or session secret is placed in notification/email text or URLs.

## UI and Realtime

`NotificationBell` is present in Home's desktop/mobile header and Market controls
for authenticated users. It uses the existing FadingDialog and StatefulButton.
The bounded feed supports count/99+, explicit Unread text, timestamps, pagination,
mark-one/read-before-navigation, mark-all-read, loading, empty and retryable error states.
Per-account keyed state prevents feed carryover between users.

The optional notification callback extends the existing `connectMessagesRealtime`
user-private Broadcast/session lifecycle. Original Messages callers keep their
original listener path. Notifications send only `{changed:true}` on that existing
private namespace, then refetch the authoritative feed. Reconnect refetches;
logout/unmount removes subscriptions and invalidates late requests. `/api/notifications`
is no-store and NetworkOnly in the existing PWA cache rules.

## Staging sender and real test

Existing server-only secrets: `RESEND_API_KEY`, `EMAIL_FROM`.
Additional test recipient secret: `RESEND_TEST_RECIPIENT` (Resend account's allowed
test inbox). The implementation does not retrieve or print their values.
The configured CTA origin is `NOTIFICATION_APP_ORIGIN=http://localhost:3000`.

`resend.dev` can send only to the Resend account email. A missing recipient blocks
the worker before claiming; normal Demo recipients are never silently redirected.
An explicitly private `test_only` delivery can use the configured test inbox.
Ordinary account delivery must match the allowed inbox when using that sender;
otherwise it is classified sender-restricted. Arbitrary-recipient sending requires
a verified sending domain and appropriate sender configuration, not a bypass.

`node tests/notification-foundation-staging.cjs` uses isolated journaled Auth users
and controlled notification events. It checks two authenticated sessions, real
private Broadcast, RLS, three independent overlapping claim transactions, a
Vault-authenticated real Resend test and a sent-row retry that must claim zero.
It removes synthetic Auth/feed/event data while retaining attempted provider audit.
`--email-only` skips already-qualified claim races when resuming recipient setup.
A blocked real-send is reported separately; it is never fabricated as success.

Offline checks: `tests/notification-email-worker.cjs`, `tests/notifications-api.cjs`,
`tests/messages-realtime-client.cjs`, `tests/notification-bell.browser.cjs`.
Rollback SQL tests: existing `notifications-domain-staging.sql` plus
`notification-delivery-staging.sql`, enclosed in a transaction rolled back by the runner.

## Deferred provider webhooks

No webhook signing secret was configured, so no unverifiable webhook endpoint is
exposed. A later dedicated verified endpoint needs `RESEND_WEBHOOK_SIGNING_SECRET`
from a Resend webhook configured for delivered/bounced/failed/complained events.
It must verify the original request with Resend's documented signature mechanism
and apply provider event IDs idempotently. The current send pipeline does not
depend on webhook setup. Message-email digests, push, preferences UI and marketing
mail remain out of scope.

## Qualification result for this implementation pass

- TypeScript and focused ESLint pass; `git diff --check` and sensitive-pattern scan pass.
- Actual API/service tests and existing Messages Realtime regression pass.
- Bell/feed browser checks pass at 390 / 430 / 820 / 1280 / 1536.
- Two disposable authenticated staging accounts prove actual private Broadcast,
  live unread/feed updates, cross-user read/mark denial and blocked client writes/claims.
- Six overlapping claim races across two qualification runs: one claimant per row,
  no deadlocks/timeouts. Each run uses three pairs of independent transactions and
  an observed advisory-lock barrier while the first transaction holds its claim.
- Actual deployed Offer Accept, both Agreement confirmations, provider-independent
  Payment, numeric Handoff, Protection and TEXT RPC notification integration passes
  in rollback-only scope. Repeat confirmations create no duplicate logical notices.
- Final native HTTP scheduler authentication works; an arbitrary `to` request is
  rejected with 400. Anonymous worker requests are rejected. Outbox RLS is enabled;
  authenticated roles have no table read/write or worker/invoker execution privilege.
- All synthetic Auth/feed/event fixtures are removed; the exact fixture journal is
  gone. Original data and `.env.local` fingerprints match. Attempted provider audit
  is retained privately; no result was fabricated as sent.
- **Final real-send qualification passed.** After the user configured the official
  Resend delivered test recipient, `node tests/notification-foundation-staging.cjs
  --email-only` exited successfully. The private Vault-authenticated worker claimed
  one synthetic delivery; Resend accepted it; status became `sent`, provider status
  `accepted`, and the provider message ID was stored. A second worker invocation
  targeting the same delivery claimed zero rows and sent zero emails. Its stable
  key remains `campus-marketplace/<delivery-id>`; the sent-row guard prevents another
  provider request. Offline tests separately confirm uncertain-ack retries preserve
  the exact provider body and key.
  Final read-only verification found one successful and four previous failed test
  audit rows retained privately, with one attempt each. Successful audit has a
  provider ID and no error; failed audits were not retried or rewritten. No recipient
  or secret was printed. Synthetic users/events are zero and the journal is gone;
  original/manual/D1 data and `.env.local` fingerprints match. Resend acceptance at
  an official test address does not prove delivery to a real user's inbox.
- No production access/secrets changes, commit or push occurred. Local work remains
  eight modified tracked files plus sixteen new files; the Git index is unchanged.

Applied staging migration SHA-256 values match local source:

| File | SHA-256 |
| --- | --- |
| `202610150004_notification_delivery_foundation.sql` | `341ecd36ad6b1057905bd831d4067dfa7d3447234210cb635280eb1223a3c3bc` |
| `202610150005_notification_edge_service_claims.sql` | `d36d8f0b052b2688451beed5831c4e545e3967e7fc8daa5c03e762e2b8527099` |
| `202610150006_notification_scheduler_transport_privacy.sql` | `2b22cb67c35efd67fed2bee96e7c187c4de7b5068cc0ad7b5e74d9103890066e` |
| `202610150007_notification_agreement_trigger_return.sql` | `aed177853332df2a163b91b1bea9dbc59cec890513e2f6dcce29bba8a4cba759` |
| `202610150008_notification_delivery_audit_retention.sql` | `25230fa721e3e1b9d2fe91f231f89aa48a0efba641acf4b1ef79ad240f33c255` |

Exact changed/new files:

```text
components/home/animated-sidebar-demo.tsx
components/listings/market-layout.tsx
components/notifications/notification-bell.module.css
components/notifications/notification-bell.tsx
docs/NOTIFICATIONS_EMAIL_FOUNDATION.md
lib/messages-realtime.ts
lib/notification-presentation.ts
lib/server/notifications-service.ts
next.config.js
pages/api/notifications.ts
supabase/config.toml
supabase/functions/notification-email-worker/index.ts
supabase/functions/notification-email-worker/worker.js
supabase/migrations/202610150004_notification_delivery_foundation.sql
supabase/migrations/202610150005_notification_edge_service_claims.sql
supabase/migrations/202610150006_notification_scheduler_transport_privacy.sql
supabase/migrations/202610150007_notification_agreement_trigger_return.sql
supabase/migrations/202610150008_notification_delivery_audit_retention.sql
tests/notification-bell.browser.cjs
tests/notification-delivery-staging.sql
tests/notification-email-worker.cjs
tests/notification-events-staging.sql
tests/notification-foundation-staging.cjs
tests/notifications-api.cjs
```

Sources: [Resend test sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Supabase scheduling/Vault](https://supabase.com/docs/guides/functions/schedule-functions).

# Notifications nav polish and Contact Seller first contact

Staging target: `pcaqxezdfxofysghssyo`; real application: `localhost:3000`.

## Navigation

The Home desktop rule matched only `a[href^="#"]`. Notifications used its real
route `/home?section=notifications`, so it inherited the shared component's 10px
padding, 40px height and 20px icon slot instead of the Home sibling link contract:
19px padding, 60px height and the existing 22px desktop icon token. The same
selector now includes the Notifications route. Gap remains the existing 12px.
No arbitrary margin or navigation redesign was introduced. Shared sidebar/pin
components are unchanged.

Both desktop and mobile entries now render the ordinary Bell icon, with no custom
wrapper or unread dot. The global Bell's count, styling and authoritative state
are unchanged. Notifications remains immediately above Settings and keeps its
active state. Actual icon/text geometry was compared with sibling Settings at
390, 430, 820, 1280 and 1536 after existing animations settled; no horizontal
overflow was observed. Existing Keep expanded behavior is unchanged.

## First-contact authority

Contact Seller / the currently-labelled Message Seller action uses the existing
`useMessageSeller` hook, existing conversation POST and existing exact Messages
navigation. It adds only `intent: contact-seller`. The API validates the intent;
the repository chooses `marketplace_contact_seller` only for this intent.
Make Offer continues using the original `marketplace_find_or_create_conversation`
path and does not generate automatic first-contact messages.

The new security-definer RPC derives Buyer from `auth.uid()`, actual Seller and
Listing from the database, and the public name from `profiles.display_name`.
Client names, sender IDs and automatic origins are not accepted as authority.
Existing canonical conversations are returned without adding any messages,
including empty conversations and unavailable/deleted Listing history already
accessible to that Buyer.

For a newly inserted canonical conversation, one transaction creates:

1. a private first-contact initialization record;
2. one Buyer interest message;
3. one Marketplace automatic acknowledgement;
4. the existing single Seller `new_message` notification from the intro.

Intro:

> Hi, I'm {buyerDisplayName}. I'm interested in your {listingTitle}. Is it still available?

If the authoritative public name is unavailable/invalid, the natural fallback is:

> Hi, I'm interested in your {listingTitle}. Is it still available?

Acknowledgement:

> Thanks for reaching out. I've received your message and will get back to you as soon as I can.

## Provenance and unread behavior

The additive `messages.origin` values are `user`, `buyer_interest`, and
`marketplace_auto_reply`. Existing messages default to `user`. The generated
acknowledgement stores the initiating Buyer UUID, not the Seller UUID; its origin
identifies Marketplace authorship. MessageHistory renders it as Marketplace with
`Automatic reply · Marketplace`, using the existing avatar/bubble/label language.
The conversation preview also says `Automatic reply`. It is not presented as a
manually typed Seller message.

Only the private initialization record can authorize a generated origin for the
exact intro/ack UUIDs. Clients cannot insert messages directly, access the private
record, change origins, or withdraw an automatic acknowledgement. Normal TEXT,
IMAGE, withdrawal, composer, Offer, Order and QR behavior is unchanged.

Automatic acknowledgements are excluded from both API conversation unread counts
and the authoritative mark-read RPC's count. The message notification projector
skips them. They therefore create no Buyer notification, no fake chat unread and
no email. The intro reuses only `new_message`: exactly one Seller notification,
with the existing exact Selling conversation destination. No second interest
notification/event family was added. A later real Seller send remains `user` and
produces the normal single Buyer new-message notification. Message emails remain
disabled in the existing event matrix. No worker/Resend/scheduler code changed.

The private record stores a default acknowledgement template key, with the default
text centralized server-side for a later seller-template extension. No Settings
or customization UI was added.

## Atomicity and concurrency

The RPC uses a transaction-scoped advisory lock for Buyer + Listing, plus the
existing unique Buyer + Seller + Listing conversation identity. Only a successful
new conversation insert initializes the pair; concurrent or subsequent callers
return the same canonical row. Database message sequencing, initialization,
notification and source-key deduplication commit together. An injected failure
on the acknowledgement rolled back conversation, intro and notification; retry
then created exactly one pair. Email transport availability is not part of this
transaction.

Concurrent qualification uses two independent staging database transactions. A
first initializer remains uncommitted behind an observable advisory barrier;
`pg_stat_activity` must show the second transaction waiting on the first-contact
advisory lock. Final assertions require the same conversation ID, one intro, one
ack, one Seller notification, zero Buyer notices and zero message email deliveries.
No client-only flag or retry loop implements idempotency.

Final independent-transaction qualification passed: the advisory wait was observed,
both callers returned the same conversation, cardinality was exactly 1/1/1 for
intro/ack/Seller notification, Buyer notifications and message deliveries were zero,
and no deadlock or timeout occurred. The final synthetic graph/media cleanup and
original-data/environment fingerprint comparison passed. The live journal is absent.

## Migration

Applied staging-only additive migration:
`202610150009_contact_seller_first_contact.sql`

SHA-256:
`7b9622566228c7f14e99499e48f73868946f5e8083a66a2ae12a7e6d757625d4`

Candidate rollback qualification passed before deployment. Deployed rollback
qualification passed after deployment, including real authenticated outsider RLS,
direct INSERT denial, generated-origin spoof/withdraw denial, RPC grants, existing
conversation reuse, normal Seller reply and atomic failure recovery. The private
table has RLS and no client grants; the contact RPC is authenticated-only.
Previously applied migrations were not edited.
The final read-only check also confirmed the recorded migration SQL exactly equals
the local migration source.

## Verification

- Real Buyer opens Listing on mobile and uses Message Seller: exact conversation,
  one intro, one labelled automatic reply. Seller sees conversation and Bell +1
  through existing private Realtime without refresh. Buyer Bell stays zero.
- Repeated Contact Seller returns the same conversation with unchanged pair and
  notification cardinality; client-supplied name/sender fields cannot impersonate.
- Seller Bell -> Notifications -> new-message row opens exact conversation and
  marks the notice read. Actual Chat Send reaches Buyer and produces a normal
  Buyer notification.
- Live 390/430/820/1280/1536: sibling nav icon/text geometry matches, no nav dot,
  global Bell preserved, active Notifications and automatic reply fit without
  horizontal overflow.
- Offline regression: 448 ordinary message sizing cases; 48 Gallery/full-viewer
  geometry cases; Listing contact versus Offer intent/availability; Notifications;
  Order Agreement/handoff and QR at all five widths; notification API, safe routes,
  Messages API, conversation reuse, Realtime, email worker, Order presentation and
  current-step passed. Email worker tests are offline.
- TypeScript, focused ESLint and `git diff --check` passed.

All hosted tests use new isolated users/Listings/conversations and exact fixture
journals. Every attempted live run cleans its own graph/media and compares original
staging and `.env.local` fingerprints, including test-harness failures. Earlier
harness issues were a text encoding assertion, a selector matching both chat and
preview, animation measurement timing, and multi-statement result extraction;
these did not expose a product invariant failure and did not change product rules.

## Exact files changed in this pass

- `components/home/animated-sidebar-demo.module.css`
- `components/home/animated-sidebar-demo.tsx`
- `components/notifications/notification-bell.tsx`
- `components/notifications/notification-bell.module.css`
- `components/home/message-history.tsx`
- `components/listings/use-message-seller.ts`
- `lib/messages-api.ts`
- `lib/server/supabase-messages-repository.ts`
- `pages/api/messages/conversations/[[...segments]].ts`
- `types/message.ts`
- `supabase/migrations/202610150009_contact_seller_first_contact.sql`
- `tests/notification-bell.browser.cjs`
- `tests/listing-actions.browser.cjs`
- `tests/listing-contact-reuse.cjs`
- `tests/contact-seller-staging.cjs`
- `tests/contact-seller-staging.sql`
- `tests/contact-seller-first-contact.browser.cjs`
- `docs/NOTIFICATIONS_UI_V2.md`
- `docs/CONTACT_SELLER_FIRST_CONTACT.md`

The worktree also retains earlier uncommitted Notifications/email work. No existing
backend/email migration was rewritten. No production access/write, commit or push.
The Git index remains empty; the working tree is intentionally not clean.

# Messages backend design

**DRAFT — NOT APPLIED. Design for review, 2026-10-06.**

Phase 1A TEXT migration is authored and **applied/behavior-verified on disposable
hosted STAGING only; NOT applied to production**:
[202610070001_messages_text.sql](../supabase/migrations/202610070001_messages_text.sql).
See [staging verification](MESSAGES_STAGING_VERIFICATION.md) for real RLS/RPC,
FK/trigger, concurrent-session results and cleanup. No API, chat-image bucket,
subscription or frontend integration has been added. SQL below remains a future IMAGE-target illustration, not the
Phase 1A migration; it is incomplete without the named guards and
it must not be copied into production or treated as an approved migration.

## 1. Existing boundaries and proposed direction

### Approved Phase 1A decisions (2026-10-07)

The authored migration uses the established `listing_origin_id` name for immutable
source identity, alongside nullable `listing_id ON DELETE SET NULL`. Participant
profile FKs also SET NULL; new creation still requires both real participants.
Historical sender UUIDs deliberately have no cascading Auth FK. Conversation
deletion may administratively cascade its messages; normal users have no delete
grant/policy, and listing/account deletion does not cascade chat history.

Approved: new Marketplace find/create only for a published available listing;
seller comes from that row and buyer from auth.uid(), with buyer != seller.
Existing conversations remain readable/sendable after sold/deleted listings.
Snapshot is immutable title/cent price/CAD currency/category, without guaranteed
retained imagery. Sent messages are immutable. TEXT is trimmed at its edges,
preserves internal newlines and has a **2,000-character** maximum. IMAGE is only
a reserved discriminator; the Phase 1A table also enforces TEXT-only rows.
No image table, bucket, upload, API or Realtime configuration is added.

Phase 1A public RPCs (actual authored signatures) are:

- `marketplace_find_or_create_conversation(p_listing_id uuid)` → conversations row.
- `marketplace_send_text(p_conversation_id uuid, p_client_message_id uuid, p_content text)`
  → messages row. The caller's nonce column is now `client_message_id`.
- `marketplace_mark_conversation_read(p_conversation_id uuid, p_through_sequence bigint)`
  → conversation_id / last_read_sequence / unread_count JSON.

All RPCs verify Western Auth/participant identity, harden search_path, and expose
EXECUTE only to authenticated. Table access is SELECT only with participant RLS.
Send locks the conversation before retry lookup; insert triggers allocate the
next local sequence/server time and update activity plus only sender's watermark.
Exact retries return the same message without consuming sequence or moving read
state again; changed trimmed content for the same nonce is rejected.

**Approved read behavior overrides the earlier proposal:** a successful new send
from inside Chat acknowledges prior durable messages through its resulting
sequence. It can therefore clear previously unread incoming messages in that
conversation. Own messages are excluded from derived unread counts regardless.
An idempotent retry never acknowledges newer messages. Mark-read keeps the explicit
rendered sequence boundary, verifies it belongs to this conversation and cannot
exceed its last sequence; it advances only the caller via greatest and never
changes last_message_at. No-op acknowledgments do not touch updated_at.

Existing `touch_updated_at` is reused for conversation updates. The TEXT migration
is protected by identity/snapshot, sender/sequence and immutable-message triggers.
Its static test (`tests/messages-text-migration.cjs`) inspects source only. Phase 1B
now executed the full chain and real RLS/FK/trigger/concurrent-send tests on explicitly
authorized hosted staging; details/limitations are in the verification report.

Read [PROJECT_STATUS](PROJECT_STATUS.md#current-repository-architecture-2026-10-07)
first. Verified source boundaries are [server client](../lib/supabase/server.ts),
[server auth](../lib/server/marketplace-auth.ts),
[listing repository](../lib/server/supabase-listings-repository.ts),
[Conversation](../components/client-card.tsx), [Message](../types/message.ts),
[Messages state](../components/home/messages.tsx),
[history renderer](../components/home/message-history.tsx) and
[image composer](../components/home/message-attachments.tsx).

Keep Browser → Next.js 12 Pages API/SSR → request-scoped Supabase server client →
Supabase Auth/PostgreSQL/Storage. That client uses the anon key plus the user's
HTTP-only session; no application service-role key is needed for ordinary actions.
Reuse requireMarketplaceUser, requireSameOriginWrite, marketplaceRequest and
private/no-store responses. Do not introduce Spring Boot, Express, an ORM, Firebase
or a browser Supabase application client. Messages currently has no persistence;
the design below is separate from the working local/demo UI.

## 2. Conversation identity and creation integrity

A conversation is exactly **listing + buyer + seller**. Fixed buyer_id/seller_id
columns are preferable to a participant join table for this two-person marketplace:
they directly express Buying/Selling, avoid membership synchronization, and permit
simple participant RLS. A join table is justified only if group chat becomes a
separate approved product.

Store listing_origin_id as an immutable original UUID, plus nullable listing_id
as the live FK. A unique constraint on (listing_origin_id, buyer_id, seller_id)
prevents duplicate active-user conversations even after the live listing is deleted.
Normal creation sets both listing IDs to the same database listing ID. Browser
input supplies only listingId; buyer is auth.uid(), seller is the listing's seller_id.
Reject self-contact, missing/unpublished listing, unverified/non-Western user and
spoofed identity fields. IDs/participants/snapshot cannot be reassigned afterward.

Use a guarded find/create RPC, not an unprotected SELECT-then-INSERT. Under a
transaction, authenticate, look for that buyer's existing conversation by the
original listing ID, then lock the live listing FOR SHARE, derive seller and
validate eligibility before inserting. A unique constraint plus INSERT ... ON
CONFLICT DO NOTHING and a subsequent SELECT returns the same row for concurrent
calls. At READ COMMITTED that subsequent statement sees the winner; at stronger
isolation handle serialization retry. No no-op upsert should change activity.
The listing lock serializes creation with sold/deletion updates. Phase 1A Marketplace
find/create rejects sold/deleted listings even if a prior conversation exists;
historical access uses its conversation ID directly instead.
The RPC is the only granted creation path; a BEFORE INSERT/UPDATE integrity guard
also checks listing ownership/snapshot and forbids identity rewrites for privileged
maintenance mistakes. SET NULL changes caused by approved FK deletion are a narrow
exception, not a client permission.

## 3. Listing status, snapshot and retention

| Listing state | New conversation | Existing conversation |
| --- | --- | --- |
| Published available | Allowed for another authenticated buyer | Read/send allowed |
| Sold | Blocked | History retained; read/send remains allowed |
| Unpublished | Blocked | Unexpected privileged transition must not expose listing data |
| Deleted | Blocked | History and messages retained; read/send remains allowed |

Do not cascade conversations/messages when a listing is deleted. Use listing_id
ON DELETE SET NULL and retain listing_origin_id. Sending after sold/deletion is
approved for pickup/follow-up. Retention/moderation policy remains separate.

At creation capture immutable title, integer-cent price, CAD currency and category
from the database, not the request. Do not copy the full Listing domain object.
Use the snapshot for stable chat/list context. View Listing can show current details
when authorized and still present, explicitly distinguishing them from the original
snapshot. For sold items, use participant-authorized RPC projection for live status;
do not weaken listings_public_read just to make the ordinary listing endpoint work.

Phase 1 deliberately does not promise a retained image snapshot. A copied public
URL would break after existing listing deletion removes its objects. Show a normal
no-image/unavailable preview when live photos cannot be fetched. If retaining a
thumbnail is approved later, copy only that thumbnail into participant-protected
private storage and track its retention/cleanup separately; do not store a fragile
public URL as a durable guarantee. No listing description/contact/location snapshot
is needed for the initial backend.

## 4. Tables and canonical activity

Minimum TEXT phase: conversations and messages. IMAGE phase adds message_images
and a private bucket; no participant table. The SQL below depicts the final TEXT +
IMAGE target, so Phase 1 migration would omit IMAGE staging columns/child table
or deny IMAGE workflows until Phase 2. It is not permission to ship Phase 2 early.

conversations stores the participants, original/live listing IDs, lightweight
snapshot, created_at, last_message_at and last_message_sequence. Do not duplicate
lastMessage text: derive the latest sent message through an indexed lateral query.
For IMAGE derive Photo or N photos from the validated manifest. Cache a preview
only if measured list-query cost later justifies maintaining it transactionally.

Activity is coalesce(last_message_at, created_at). Opening, marking read, failed
send, reserving images and duplicate retries never bump activity. Successful send
updates the message and conversation in one database transaction.

Server timestamps are canonical. Under the conversation row lock assign a
conversation-local sequence and created_at = greatest(clock_timestamp(), previous
last_message_at + interval '1 microsecond'), treating a null previous time normally.
Sequence is the authoritative ordering/read boundary; timestamps remain monotonic
within a conversation and match the existing frontend createdAt display contract.
Use database-generated UUID message IDs. The browser may supply a requestId UUID
only as an idempotency nonce, never as identity/time authority. Unique
(conversation_id, sender_id, client_message_id) makes lost-response retries return
the original message. A repeated nonce with different content/manifest returns 409.

## 5. TEXT/IMAGE validation and immutability

Use a text CHECK for type IN ('TEXT','IMAGE'), consistent with existing project
constraints rather than adding an enum migration lifecycle.

- TEXT: nonblank content, approved maximum 2,000 characters, no image count or
  child rows; preserve internal line breaks, trim only as current send does.
- IMAGE: content null, immutable expected_image_count between 1 and 4; contiguous
  unique slots 1..count, exactly that many validated ready child records at finalize.
- MIME is exactly image/jpeg, image/png or image/webp; bytes 1..3,145,728 per image.
  Server validates streamed byte count and file signature, not only browser MIME.
- Sent messages/children cannot be updated or deleted by participants. No message
  editing, reactions or deletion endpoints in the initial versions.
- IMAGE pending rows are creation state, not sent messages: no sequence, sent time,
  list preview, unread or Realtime event until complete finalization. Author alone
  may inspect/manage their pending record; recipient cannot see partial uploads.

Cross-table image-count validation needs a deferred constraint trigger covering
parent and child writes, plus mutation guards and the transactional finalization
RPC. A parent CHECK cannot count child rows. Sent IMAGE children are immutable;
TEXT children are always rejected. These guards are REQUIRED, not supplied fully
by the representative SQL below. Race-test parent/child locks before approval.

## 6. JSONB versus message_images

| Approach | Benefits | Costs |
| --- | --- | --- |
| JSONB array on messages | Simple one-row payload; ordering inherent | Per-image validation/path uniqueness/cleanup references harder; weaker relational upload lifecycle |
| message_images child table | Slot uniqueness, path constraints, image-specific RLS/cleanup, metadata and future moderation | Join needed; finalization must enforce count atomically |

Recommend **message_images**. One IMAGE message remains one parent record with
1–4 ordered images. Store image ID, message FK, slot, immutable storage path,
original filename (display only), MIME, bytes, ready state, and optional dimensions
only when actually decoded/verified. Do not trust client dimensions. Do not persist
signed URLs or object URLs. No speculative moderation/retry columns in Phase 1;
the child identity makes later additions possible without rewriting message shape.

## 7. Private storage and future IMAGE flow

Create chat-images as PRIVATE in Phase 2 only. Never reuse listing-images. Use
senderUUID/conversationUUID/messageUUID/imageUUID.ext; senderUUID is the verified
uploader's Auth ID, remaining UUIDs are server-reserved, extension is server-derived
from validated MIME, and filenames are not part of paths. The sender prefix permits
orphan-delete ownership checks after draft metadata is removed; it is not read
authorization, which always requires participant membership through metadata.

Recommended flow:

1. POST image draft with requestId and imageCount; guarded RPC verifies participant
   and reserves one pending IMAGE message plus ordered child identities.
2. Upload each slot through a Next.js binary API. Verify sender owns the pending
   message, slot/path were reserved, exact MIME/bytes/signature and no upsert.
3. Store object through the existing user-session Supabase client, then record
   verified metadata/readiness. No direct browser upload grant is added.
4. Finalize under the conversation/message locks: verify complete 1–4 manifest,
   objects/metadata, ready ownership, assign sequence/server time, set sent status
   and update conversation activity atomically. Retry returns the same sent record.
5. API returns one IMAGE DTO with ordered signed image URLs; existing gallery renders it.

Reserve/finalize is preferable to arbitrary temporary uploads followed by a message
POST: it establishes exact ownership/object paths before Storage writes and avoids
unassociated uploads. Adapt listing manifest lessons without copying its public
bucket, six-photo contract or permanent unpublished-listing UI.

Storage and database changes are not one transaction. On cancel/failure, remove
pending child metadata/reservations before deleting orphan objects. A draft abandon
RPC rejects sent rows and serializes with finalization; uncertain finalize responses
must reconcile the same draft before cleanup. Pending drafts expire (proposed 24h)
and need a separately approved bounded cleanup worker. It may need narrowly scoped
administrative credentials for expired objects; these are not required by ordinary
API requests and are not implemented here. Never allow user deletion of an object
referenced by a sent message. Future message/account deletion must schedule metadata
and object cleanup deliberately.

Participants may read sent image metadata and objects. Only the author may read
their pending images. Storage INSERT checks exact reserved path, pending author and
participant membership. No authenticated Storage UPDATE/upsert policy. DELETE is
restricted to uploader-path ownership plus absence of any referenced sent/pending
metadata (parse UUID segments safely; malformed names return false, not cast errors).
A finalized reference cannot be removed through user APIs, closing the delete bypass.

Prefer short-lived signed URLs (proposed 5 minutes) minted by the Next.js API after
participant checks with the current user client. Storage SELECT RLS checks the same
membership; the anon-key client cannot sign arbitrary objects. Return expiresAt and
an authorized refresh endpoint. Cached URLs are bearer capabilities until expiry:
membership removal cannot instantly invalidate a previously issued URL. An
authenticated streaming API is an alternative if immediate revocation is required,
at higher proxy cost. Do not log signed query strings, file contents, message text
or authorization cookies. Return private/no-store headers; explicitly exclude all
future /api/messages and signed-image endpoints from PWA caching before integration.
Browser fetch/cache handling must not persist private images across sign-out.

## 8. Read/unread and race handling

| Candidate | Assessment |
| --- | --- |
| last_read_at per role | Simple, but equal timestamps/concurrent commits can be skipped |
| last_read_message_id per role | Precise anchor; must verify conversation and resolve an ordering tuple |
| participant state table | Appropriate for groups, unnecessary for fixed two-person roles |

Use two **last_read_sequence** watermarks on conversations. They are a robust form
of per-role last-read-message position without a join table. Each sent message gets
a local sequence allocated while holding the conversation row lock until commit.
Unlike a global identity allocated outside that lock, a later lower-sequence commit
cannot appear behind a previously marked-read boundary. An abandoned IMAGE draft
has no sequence. Mark read accepts the highest message sequence actually rendered,
not server now or the latest sequence blindly fetched after rendering.

mark_read locks conversation, verifies the actor's role and that the supplied
sequence is a sent message in that conversation (0 means no messages), and advances
only that role using greatest(old, requested). It never writes the other role or
activity timestamp. Messages arriving after the acknowledged watermark remain unread.
Only visibly open Chat should issue mark-read; a hidden mounted mobile Chat is not
open. A successful new send also advances the sender's watermark as approved above.

Derive unreadCount from sent messages with sequence > caller's watermark and
sender_id <> auth.uid(). Own sends do not increase unread; approved Phase 1A sending
acknowledges through its new sequence. When visibly open, the frontend marks rendered new
messages read separately. Use one set-based/lateral query for the bounded list
page, not one network call per conversation. Begin with the sequence index and
measure before adding a sender-specific index or denormalized count.

## 9. Draft SQL — NOT APPLIED

Target table sketches, including Phase 2 staging. No SQL has been executed. UUID
generation follows the existing gen_random_uuid convention. Names may be refined
when an actual migration is reviewed.

```sql
-- DRAFT — NOT APPLIED. Not a complete executable migration.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_origin_id uuid not null,
  listing_id uuid references public.listings(id) on delete set null,
  buyer_id uuid references public.profiles(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  listing_title_snapshot text not null check (length(listing_title_snapshot) between 1 and 120),
  listing_price_cents_snapshot bigint not null check (listing_price_cents_snapshot between 0 and 9007199254740991),
  listing_currency_snapshot text not null check (listing_currency_snapshot = 'CAD'),
  listing_category_snapshot text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz,
  last_message_sequence bigint not null default 0
    check (last_message_sequence between 0 and 9007199254740991),
  buyer_last_read_sequence bigint not null default 0,
  seller_last_read_sequence bigint not null default 0,
  activity_at timestamptz generated always as (coalesce(last_message_at, created_at)) stored,
  unique (listing_origin_id, buyer_id, seller_id),
  check (buyer_id is null or seller_id is null or buyer_id <> seller_id),
  check (buyer_last_read_sequence between 0 and last_message_sequence),
  check (seller_last_read_sequence between 0 and last_message_sequence),
  check ((last_message_sequence = 0) = (last_message_at is null))
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  -- Stable historical Auth UUID, validated against participants at creation;
  -- deliberately no cascading Auth FK: deletion must not erase message history.
  sender_id uuid not null,
  client_message_id uuid not null,
  type text not null check (type in ('TEXT', 'IMAGE')),
  content text,
  expected_image_count smallint,
  status text not null check (status in ('pending', 'sent')),
  sequence bigint,
  created_at timestamptz,
  draft_created_at timestamptz not null default clock_timestamp(),
  unique (conversation_id, sender_id, client_message_id),
  unique (conversation_id, sequence),
  check ((status = 'sent' and sequence is not null
      and sequence between 1 and 9007199254740991 and created_at is not null)
    or (status = 'pending' and type = 'IMAGE' and sequence is null and created_at is null)),
  check ((type = 'TEXT' and content is not null
      and length(btrim(content)) between 1 and 2000 and expected_image_count is null)
    or (type = 'IMAGE' and content is null and expected_image_count between 1 and 4
      and expected_image_count is not null))
);

create table public.message_images (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type text check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer check (byte_size between 1 and 3145728),
  width integer check (width > 0),
  height integer check (height > 0),
  ready boolean not null default false,
  unique (message_id, slot),
  check (not ready or (mime_type is not null and byte_size is not null))
);

create index conversations_buyer_activity
  on public.conversations (buyer_id, activity_at desc, id asc);
create index conversations_seller_activity
  on public.conversations (seller_id, activity_at desc, id asc);
create index conversations_live_listing on public.conversations (listing_id);
create index messages_sent_history
  on public.messages (conversation_id, created_at desc, id desc)
  where status = 'sent';
-- UNIQUE(conversation_id, sequence) already supplies unread/sequence-range lookup.
-- UNIQUE(message_id, slot) already supplies ordered image lookup.
-- The identity unique index already starts with listing_origin_id for historical lookup.

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_images enable row level security;
revoke all on public.conversations, public.messages, public.message_images
  from public, anon, authenticated;
grant select on public.conversations, public.messages, public.message_images to authenticated;

create policy conversations_participant_read on public.conversations
  for select to authenticated using (
    (select marketplace_private.is_western_user())
    and (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()))
  );
create policy messages_participant_read on public.messages
  for select to authenticated using (
    exists (select 1 from public.conversations c where c.id = conversation_id
      and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid())))
    and (status = 'sent' or sender_id = (select auth.uid()))
  );
create policy message_images_participant_read on public.message_images
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_id)
  );

-- Defense in depth if INSERT is ever granted; initial writes remain RPC-only.
create policy messages_sender_insert on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = conversation_id
      and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid())))
  );
-- No participant UPDATE/DELETE policies or grants for sent records.
-- No direct conversation INSERT policy/grant: guarded RPC derives identities.

-- Representative Phase 2 Storage policies: helper bodies/privileges are REQUIRED
-- review work, not implemented here. Bucket must be private.
create policy chat_images_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-images'
    and marketplace_private.can_read_chat_image(name));
create policy chat_images_reserved_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images'
    and marketplace_private.can_upload_chat_image(name));
create policy chat_images_orphan_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images'
    and marketplace_private.can_delete_chat_orphan(name));
-- No UPDATE policy. Helpers use exact reserved paths and the rules in section 7.
```

Required before any executable migration: derive/guard initial participants and
snapshot; lock/sequence/time/activity allocation; idempotency payload checks; read
watermark guards; pending/sent lifecycle; exact image count/deferred integrity;
metadata/object readiness; deny sent mutation even for accidental privileged writes;
restrict privileged deletion to an explicit retention workflow. RLS alone does not
validate these cross-row invariants. No direct column grants allow bypassing them.

message_images ON DELETE CASCADE is only for an explicitly removed pending message
or an approved administrative retention operation, never for listing deletion.

## 10. RPC boundaries and privileges

Draft signatures (declarations only, NOT implemented):

```text
public.marketplace_find_or_create_conversation(p_listing_id uuid) -> conversations row
public.marketplace_send_text(p_conversation_id uuid, p_client_message_id uuid, p_content text) -> messages row
public.marketplace_mark_conversation_read(p_conversation_id uuid, p_through_sequence bigint) -> read state JSON
public.marketplace_reserve_image_message(conversation_id uuid, request_id uuid, image_count smallint) -> draft/slots
public.marketplace_finalize_image_message(message_id uuid) -> Message
public.marketplace_abandon_image_message(message_id uuid) -> void
public.marketplace_record_chat_image_ready(image_id uuid, verified metadata...) -> void
```

Recommend guarded SECURITY DEFINER for find/create (seller/source snapshot may need
access beyond public listing RLS), sending/finalization (atomic immutable writes plus
activity allocation), mark-read (update only caller's role, no arbitrary conversation
UPDATE grant), and pending cleanup. Ordinary authorized reads can be SECURITY
INVOKER queries; do not elevate list/history merely for convenience.

Every definer function uses SET search_path = '', fully qualified objects,
auth.uid() nonnull and is_western_user checks, participant/author checks, row locks,
bounded validation, explicit controlled return projection and no dynamic SQL.
Revoke EXECUTE from PUBLIC and anon; grant only necessary public entry functions
to authenticated. Private trigger helpers are not publicly callable. Restrict
function ownership, and review default function grants before migration approval.
The readiness operation must independently verify reserved object MIME/size in
storage.objects; do not trust caller-supplied ready=true or bytes. Server signature
validation remains a second check. Trigger lifecycle checks prevent direct writes
from constructing sent malformed images if grants change later.

## 11. Pages API contract

Proposed catch-all organization:
pages/api/messages/conversations/[[...segments]].ts, plus separate binary image
upload routes. No route files are created in this pass. Every route requires
requireMarketplaceUser; writes additionally requireSameOriginWrite. Membership is
verified by API/repository AND DB/RLS/RPC, using the verified session. Reject
authoritative senderId/buyerId/sellerId fields rather than trusting them.

| Method / path | Request | Response | DB/authorization |
| --- | --- | --- | --- |
| GET /api/messages/conversations | destination=buying or selling; limit default 20/max 50; cursor | items, nextCursor | Only caller's buyer/seller rows; latest sent message + unread projection |
| POST /api/messages/conversations | {listingId} | {conversation}, 200 find / 201 create | Guarded find/create; buyer from session, seller from listing |
| GET /api/messages/conversations/:id | UUID | {conversation} | Participant-only snapshot/live-status projection |
| GET /api/messages/conversations/:id/messages | before cursor; limit default 50/max 100 | {messages,nextCursor,readThroughSequence} | Participant; sent rows only, ordered page oldest→newest |
| POST /api/messages/conversations/:id/messages | {type:'TEXT',content,requestId} | {message,sequence}, 201 / 200 retry | Participant; transactional TEXT send |
| POST /api/messages/conversations/:id/read | {throughSequence} | {lastReadSequence,unreadCount} | Guarded monotonic caller-only update |
| POST /api/messages/conversations/:id/image-drafts | {requestId,imageCount} | {draftId,slots,expiresAt} | Phase 2 participant/author reservation |
| POST /api/messages/image-drafts/:id/images/:slot | raw image body, Content-Type | {imageId,ready} | Phase 2 pending author only, max-byte stream/signature validation |
| GET /api/messages/image-drafts/:id | UUID | pending/sent reconciliation state | Author-only; supports lost responses |
| POST /api/messages/image-drafts/:id/finalize | UUID; no client identity/time | {message,sequence} | Phase 2 complete manifest finalization |
| DELETE /api/messages/image-drafts/:id | UUID | 204 | Phase 2 author, only pending; metadata-first orphan cleanup |
| POST /api/messages/images/:id/url | UUID | {url,expiresAt} | Phase 2 participant of sent message; authorized URL renewal |

Errors: 400 malformed/blank/invalid cursor/nonce; 401 no session; 403 unverified
Western account or rejected origin; 404 inaccessible/missing conversation/image
(avoid disclosing private existence); 409 unavailable/self-contact listing,
changed nonce payload, expired/finalized incompatible draft or incomplete manifest;
413 oversized upload; 415 unsupported MIME/signature; 429 rate limit when implemented;
503 provider/storage failure. 405 includes Allow. Bound bodies, limits and cursor
sizes; distinguish safe user errors from redacted server diagnostics. Images are
unsupported on the TEXT-phase message route, not silently downgraded.

## 12. DTO mapping without a UI rewrite

Conversation DTO:

```ts
type ConversationDTO = {
  id: string
  destination: 'buying' | 'selling'
  person: { id: string | null; name: string; avatar?: string }
  listing: {
    originalId: string
    liveId: string | null
    title: string
    price: number // canonical cents; server ensures JS safe integer
    currency: 'CAD'
    category: string
    availability: 'available' | 'sold' | 'deleted' | 'unavailable'
    imageUrl?: string // optional currently authorized live image, not durable snapshot
  }
  createdAt: string
  lastMessage: string // newest TEXT or Photo / N photos; '' when empty
  lastMessageAt: string | null
  unreadCount: number
  lastReadSequence: number // bounded safe integer on API serialization
}
```

Never return email, Auth metadata or the other participant's read watermark. Public
profile fields come from profiles; avatar is omitted until real avatar persistence
exists. Deleted profile uses name='Former member', id=null; no invented real identity.
Keep id/person/lastMessage/createdAt/lastMessageAt/unreadCount mapping and the shared
sorter. Remove static demo time labels; format from canonical timestamps locally.
Current Conversation embeds a full Listing, which a snapshot cannot truthfully
satisfy. In implementation introduce a narrow ChatListingContext and adapt
View Listing to it; do not fabricate description/condition/seller/status just to
cast to Listing. This is a localized type boundary change, not a renderer redesign.

Message DTO keeps current TEXT/IMAGE union. Server sets senderId and createdAt.
Return a sequence envelope for read state/cursors without forcing presentation
components to animate differently:

```ts
type MessageEnvelope = {
  sequence: number
  message:
    | { id: string; conversationId: string; senderId: string;
        type: 'TEXT'; content: string; createdAt: string }
    | { id: string; conversationId: string; senderId: string;
        type: 'IMAGE'; createdAt: string; images: Array<{
          id: string; name: string; size: number; mimeType: string;
          previewUrl: string; expiresAt: string
        }> }
}
```

previewUrl is now an authorized expiring HTTPS signed URL, not a blob URL. Keep
the presentation field for the existing image/gallery renderer; expiresAt supports
renewal. Do not revoke HTTP URLs via URL.revokeObjectURL. Width/height may be added
only when available; original names are escaped display text. No unread dots in chat.

## 13. Pagination and indexes

History: fetch latest sent page DESC by (created_at,id), then reverse for rendering.
Older-page cursor encodes full-precision database timestamp + UUID and direction;
query tuple < boundary. Do not round microseconds through JS Date before encoding
the cursor. Row-lock timestamp assignment above keeps this chronological and
consistent with sequence watermarks. Alternatively sequence-only history cursors
are simpler/precise and are recommended for the implementation if the repository's
PostgREST tuple filtering is cumbersome; that is a deterministic equivalent, not
offset pagination. Validate/parameterize cursors; never interpolate SQL strings.

Conversation list: ORDER BY activity_at DESC, id ASC to match current shared sorter.
Next page predicate is activity_at < t OR (activity_at = t AND id > cursor_id).
Activity changes can move rows between pages; client deduplicates by conversation
ID and refreshes the first page, rather than promising a frozen live-list snapshot.

Buyer/seller activity indexes serve each destination separately. Live listing FK
index serves deletion SET NULL/linked lookups. Unique original identity index serves
find/create. Sent history timestamp index serves newest message/older pages; unique
conversation sequence serves unread counts/read validation. Image slot/path indexes
come from UNIQUE constraints. No speculative broad search/message-content indexes.
No infinite scrolling implementation is authorized by this design pass.

## 14. Realtime — future only

Phase 1/2 remain request/response persistence. For Phase 3 prefer server-mediated
Supabase private conversation channels/Broadcast delivered through an authenticated
Next.js SSE stream, preserving the no-browser-Supabase boundary. Database commit
must precede notification. Event is an invalidation/message ID, not unfiltered private
content; the normal authenticated history/list API returns canonical records/URLs.
Deduplicate by message ID/sequence; reconnect refetches committed state. The SSE
server must verify session/membership, authorize upstream channels, terminate on
auth loss and renew appropriately; feasibility depends on hosting duration limits.
Do not use an elevated broad feed that sends every user's messages to each client.

If the eventual hosting environment cannot support durable SSE, use authorized bounded polling as
the first update mechanism. A direct authenticated Supabase browser subscription
is an ALTERNATIVE requiring explicit architecture approval and session/token
delivery design; current HTTP-only cookies do not automatically authenticate that
browser client. No service-role key may reach the browser. A dedicated gateway is
another later option, not part of the default current architecture.

Choose sent-message insert events and conversation activity invalidations, excluding
pending images. Own API response and notification merge idempotently. Visibly open
chat renders then marks that watermark read; closed chat derives unread. Persist
first → event → authorized fetch → history/activity update → read acknowledgment.
No transient receipt of an event should invent canonical timestamps or counters.
This entire section is future design: no publication, channels or subscriptions
have been configured.

## 15. Account deletion and privacy policy boundary

Buyer/seller profile FKs SET NULL preserve conversations after account deletion;
sender_id keeps a historical opaque UUID (no Auth FK) so grouping remains stable,
with deleted-user fallback identity. Normal creation requires both participants;
null is only an account-deletion outcome. The uniqueness rule guarantees normal
live participants; after SET NULL the original deleted identity cannot sign in or
create a duplicate, and new conversations still require a live listing owner.

Existing listings.seller_id FK does not cascade, so a future account deletion
workflow must first delete/reassign that user's listings deliberately; their chat
references then SET NULL. Do not pretend this pass implements account deletion.
Choose a retention/anonymization policy before shipping deletion: whether historic
content/image metadata is retained for the other participant, for how long, and
how erasure/legal requests are handled. No automatic conversation cascade is proposed.
When both participants are gone, an approved administrative retention workflow
may remove messages/objects. Distinct sent-content deletion privileges are required.

## 16. Implementation phases and acceptance

### Phase 1: TEXT persistence only

1. Review/apply a separate approved conversations + TEXT messages migration,
   constraints/RLS/functions/grants and local database race/security tests.
2. Implement find/create, destination list, context/history, TEXT send and mark-read
   APIs using the existing server-client pattern and no-store/PWA exclusions.
3. Replace demo TEXT collections with canonical DTOs; derive sender from real session,
   preserve Buying/Selling, recent three/+N, grouping, keyboard/IME and navigation.
   Do not pass demo IDs/listings into durable APIs. Keep local IMAGE demo separate
   or explicitly unavailable on durable conversations until Phase 2; never present
   a refresh-lost local image as a persisted send.
4. Acceptance: send TEXT → database → browser refresh → same conversation/history;
   concurrency produces one conversation; retries one message; outsider denied;
   read watermark races safe; own send not unread; sold/deleted history survives.
   No Realtime required. Approved future tests may use local SQL, not this design pass.

### Phase 2: durable IMAGE

Approve private bucket, message_images/pending-manifest guards, reserve/upload/
finalize/reconcile/abandon APIs and cleanup plan. Test 0/1/4/5 images, MIME/size/
signature, partial uploads, lost finalize response, double send, outsider URL denial,
expired URL renewal, URL/object cleanup and sender grouping. One selection produces
one IMAGE message. Reuse current FileDrop/preview/gallery and animations. Preserve
sent images after refresh and listing deletion without leaking public URLs.

### Phase 3: incoming updates

Approve hosting-compatible Supabase event transport, participant authorization,
reconnect/dedupe, visible-chat read behavior and live destination ordering. Keep
canonical APIs/persistence authoritative. Realtime is not a prerequisite for Phase 1.

## 17. Genuine decisions needing approval

- Confirm account deletion/anonymization and message/image retention periods,
  including both-participants-deleted cleanup and erasure requests.
- Confirm whether immutable listing thumbnail retention is needed beyond the text
  snapshot; proposed Phase 1 uses an unavailable/no-image state after deletion.
- Confirm pending-image expiry (24h), and
  whether five-minute signed-URL revocation latency meets privacy expectations.
- Before Phase 3, confirm hosting support/transport: authenticated SSE bridge,
  polling fallback, or separately approved direct Supabase browser subscription.

Established rules (listing-bound two-person conversation, separate destinations,
TEXT/IMAGE, 1–4 photos as one message, private images, activity sorting, own-send
not unread and no listing-deletion history cascade) do not need reconfirmation.

## 18. Review checklist for this document

Cross-checked against the current union, Conversation shape, HTTP-only Auth server
client, same-origin API convention, listing/publication/storage model and renderer.
Draft SQL has NOT been executed or migration-tested. The Phase 1A TEXT migration
has been authored separately with full trigger/RPC bodies and static source tests,
and is applied/behavior-verified on STAGING ONLY. The future IMAGE/Storage helper bodies illustrated here are
intentionally incomplete. Applying the TEXT migration still needs independent
production review/approval; staging execution is not production authorization. No chat-image bucket/API/frontend
integration/Realtime changes were made. Current demo behavior remains untouched.

# Messages Phase 1C — staging TEXT integration

Implemented and verified 2026-10-07. **STAGING ONLY. Production was not modified.**
The verified Phase 1A migration remains unchanged. No Realtime, chat bucket,
durable IMAGE backend, commit or push.

## Local staging selection

The CLI-confirmed target is `western-marketplace-staging`, ref
`pcaqxezdfxofysghssyo`. `.env.local` is unchanged. A separate ignored
`.env.staging.local` contains only:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://pcaqxezdfxofysghssyo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging public anon or publishable key>
```

Run `npm run dev:staging -- -p 3100`. The launcher validates the exact staging URL
and rejects secret/service-role or another project's legacy JWT key. It puts the
two values into the child Next process before Next loads its normal env files;
the other existing env settings remain available. Next's “Loaded .env.local” log
does not mean those two process values were replaced. No actual key is committed
or printed by the setup/test scripts.

Every Messages API operation also checks the staging host before constructing a
Supabase client. A production-configured app receives 503 for Messages without
an Auth/database request. This is an intentional Phase 1C deployment gate.

## API/auth contract

All endpoints are Pages Router APIs with `Cache-Control: private, no-store` and
32 KB JSON body limits. Writes require the existing same-origin/custom-header
check. The request-scoped server client uses the current HTTP-only Auth cookie
session and public key. `requireMarketplaceUser` verifies the user through
`auth.getUser()` and requires a confirmed Western address. No browser Supabase
application client or service-role application access was introduced.

| Method/path | Input/result |
| --- | --- |
| GET `/api/messages/conversations?role=buying\|selling&cursor=…` | Viewer-role list, up to 50 DTOs, `nextCursor` |
| POST `/api/messages/conversations` | `{ listingId }`; guarded find/create RPC, canonical conversation DTO |
| GET `/api/messages/conversations/[id]` | RLS-authorized conversation DTO; inaccessible/missing IDs return 404 |
| GET `/api/messages/conversations/[id]/messages?before=…` | Latest/older 50 TEXT messages ascending by sequence, `nextBefore` |
| POST `/api/messages/conversations/[id]/messages` | `{ type: 'TEXT', content, clientMessageId }`; canonical persisted TEXT DTO |
| POST `/api/messages/conversations/[id]/read` | `{ throughSequence }`; viewer's canonical watermark and unread count |

Unsupported methods return 405; invalid data 400; nonce/content conflicts 409;
missing session 401; account/permission errors 403; temporary database failures
503. Raw provider/SQL errors are not exposed. Sender identity is never accepted
from the browser. RLS and the existing guarded RPCs remain authoritative.

`Conversation` contains `id`, `role`, counterpart `person`, `listing` context,
`lastMessage`, `createdAt`, `lastMessageAt`, `activityAt`, `lastMessageSequence`,
`lastReadSequence` and `unreadCount`. Counterparts expose display identity only;
a removed profile uses the shared avatar fallback with “Former member”.

`ChatListing` contains original `id`, nullable `liveId`, immutable title/price/
currency/category snapshot, available photo URLs, `availability` and optional
real `live: Listing`. It never fabricates description, pickup area, subcategory
or seller data to cast a snapshot into a full Listing. A sold listing may be
`unavailable` to a buyer because existing Marketplace RLS hides that live row;
this does not block historical chat. Listing preview retains the accepted
overlay/fade/focus behavior and shows snapshot information when live data is gone.
Its existing listing-share action remains visual-only.

Persisted TEXT maps into the existing `Message` union: `id`, `conversationId`,
`senderId`, `type: 'TEXT'`, `content`, `createdAt`, canonical `sequence` and
`clientMessageId`. Local IMAGE renderer/types remain available; no IMAGE is
returned from this phase's durable API.

## State and UI behavior

- Normal authenticated Messages starts from backend data, without the old 18+18
  hardcoded conversations. Demo-history helpers remain isolated to tests.
- Buying/Selling retain separate collections/selections. Recent three/+N and
  expanded/mobile lists use the same shared immutable activity sorter. It now
  preserves PostgreSQL submillisecond ordering before the UUID tie-break.
  Sends refresh canonical conversation activity rather than using a client clock
  or manual promotion. Read changes do not update activity.
- Conversation list pagination uses `(activity_at DESC, id ASC)` with a validated
  opaque cursor. History uses the existing unique `(conversation_id, sequence)`
  index, exclusive `before` boundaries and a lookahead row. Database sends have
  monotonic sequence/time, so this matches canonical history chronology. Loading
  older messages retains the viewport position; new messages scroll to bottom.
- `MessagesChat` clears submitted text immediately and awaits the real API using
  StatefulButton's existing pending/loading/success/error discipline. Same-content
  retries keep the original `crypto.randomUUID()` submission ID. Message rows are
  merged by canonical ID. A failed response creates no fake durable message; text
  is restored only if the user did not edit a newer draft. Failed text remains
  visible in a bounded error region if a new draft exists. Old completion cannot
  alter another conversation's draft. A successful send followed by a failed
  detail refresh is not incorrectly reported as a failed send.
- Read acknowledgment follows the highest sequence actually rendered by active
  MessageHistory. Hidden mobile chat does not acknowledge messages. Only that
  conversation's backend-derived unread state updates; own messages are excluded
  by the database. Older read responses cannot move the UI watermark backwards.
- Contact Seller in real published cards and individual listing pages uses the
  shared find/create hook. Unauthenticated entry resumes the exact listing after
  the existing Western password login. Home opens
  `?section=messages&destination=buying&conversation=<uuid>`. That entry intent is
  consumed once, so later mobile destination switches still return to neutral lists.
  Explicit fixture-only Market/Welcome cards retain their demo auth interaction.
- Attachment selection/preview/navigation/discard and its local slide/mounting
  behavior remain. Send is disabled even with valid selected photos, with explicit
  temporary/no-upload copy. Cancel/context change/unmount still revoke pending
  object URLs. Existing single-image/gallery rendering is retained unchanged.
- TEXT messages and read state survive refresh/remount through staging persistence.
  Unsent drafts remain temporary; they are not saved per conversation.

## Verification

`tests/messages-api-staging.cjs` pins and checks the CLI staging project and
checks the running API target before mutation. It creates disposable confirmed
Western users/password identities and SQL-only listing/image metadata, logs in
through the actual app Auth endpoint, and exercises real HTTP/RLS/RPC behavior.
It does not mock Messages responses for persistence/access tests. Two explicit
failure simulations cover lost response after a real committed send and an
uncommitted temporary failure. Fixtures/password SQL stay in temporary files;
final cleanup removes users/conversations/listings/storage metadata and deletes
those files. No physical images are uploaded. No policies/schema are replaced.

Passed:

- Real Western password sessions; anonymous rejection; Buying/Selling roles;
  find/create repeat identity; self/unpublished/sold entry rejection; outsider
  detail/history/send rejection; sender spoof and IMAGE send rejection.
- Blank/2001-character errors, trimmed multiline TEXT, canonical sender/sequence,
  exact nonce retry and nonce/content conflict.
- Read through rendered boundaries, monotonic viewer watermark, exclusion of own
  messages, remaining incoming unread and unchanged activity after reads.
- 62-message history: latest 50 sequences 13–62, older page sequences 1–12;
  load-older UI; real send after sold/deleted listing and correct snapshot fallback.
- **390, 430, 1280, 1536**: canonical TEXT send and browser refresh persistence;
  immediate draft clearing/new draft protection; Enter, Shift+Enter and both IME
  guards; original mobile forward/back slide and neutral destination list;
  Buying/Selling navigation; unrelated unread dot retention; recent rail/+N;
  listing overlay; attachment slide/gate/cancel; card containment/no horizontal
  overflow; no browser runtime errors.
- Desktop failure test: first request really commits, response is replaced with
  503, retry retains the same submission UUID and leaves exactly one persisted row.
  A separate held failure preserves newly typed text and retains failed text.
- Marketplace Contact Seller → real sign-in → existing conversation → selected chat.
- All staging fixture cleanup counts are zero.
- TypeScript, scoped ESLint, local API target/CSRF/cursor tests, shared activity/
  message/image tests and static migration contract checks. Static SQL checks are
  not presented as database execution evidence; Phase 1B covers hosted SQL behavior.

Visual artifacts (ignored, local): `tests/artifacts/messages-phase1c/` contains
normal/TEXT/attachment screenshots at every width and mobile list screenshots.
The screenshots were visually inspected for header/composer and card/nav containment.

To rerun the hosted suite, start the staging dev server, set `PLAYWRIGHT_MODULE`
to an installed `playwright-core` module and `BROWSER_EXECUTABLE` to Chrome, then
run `node tests/messages-api-staging.cjs` with the already authorized staging CLI.

## Files changed in Phase 1C

| Area | Files |
| --- | --- |
| API/model | `pages/api/messages/conversations/[[...segments]].ts`, `lib/server/supabase-messages-repository.ts`, `lib/messages-api.ts`, `types/conversation.ts`, `types/message.ts` |
| Messages UI | `components/client-card.tsx`, `components/home/messages.tsx`, `messages-chat.tsx`, `messages-chat.module.css`, `message-history.tsx`, `message-attachments.tsx`, `messages-listing-overlay.tsx`, `messages-listing-preview.tsx` (last six also under `components/home/`) |
| Entry/navigation | `components/home/animated-sidebar-demo.tsx`, `components/listings/use-message-seller.ts`, `components/listings/published-listing-card.tsx`, `pages/listings/[id].tsx` |
| Shared activity | `lib/conversation-state.ts`, `tests/conversation-state.cjs` |
| Environment/cache | `scripts/dev-staging.cjs`, `scripts/.eslintrc.json`, `package.json`, `.gitignore`, `next.config.js`; generated ignored `.env.staging.local` |
| Tests/docs | `tests/messages-api.cjs`, `tests/messages-api-staging.cjs`, `docs/PROJECT_STATUS.md`, `docs/MESSAGES_PHASE1C.md`; ignored visual artifacts |

Existing unrelated workspace edits were retained. `package-lock.json` and all
Supabase migrations were not edited by this Phase 1C implementation.

## Limits and next phases

Not production-live. The production gate stays closed pending a separately
authorized deployment. No migration changes, Realtime, polling, incoming live
delivery, image upload/storage/moderation/progress/retry backend or generic files.
Lists/history refresh on opening/navigation or explicit Retry; incoming data does
not appear live. DTO enrichment currently uses bounded per-conversation queries
(up to 50 per page); optimize with a separately reviewed query contract if scale
requires it. Role-list cursor validation is unit checked, but the hosted browser
fixture has five Buying conversations, not a greater-than-50 conversation load.
The suite verifies existing password login, not email signup/delivery or actual
Storage HTTP uploads. Historical local-fixture browser suites need DTO fixtures
before rerunning against this backend UI; their local-only assumptions no longer apply.

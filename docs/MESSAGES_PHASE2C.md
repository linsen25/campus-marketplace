# Messages Phase 2C: durable IMAGE API/frontend and staging E2E

2026-10-07. Frontend acceptance **PASS on hosted STAGING only**, using the local
Next.js app against western-marketplace-staging (`pcaqxezdfxofysghssyo`). There is
no hosted frontend deployment. Production IMAGE is not deployed or enabled.
No migration, production operation, Realtime, commit or push was performed.

## Implementation

The existing FileDrop/attachment composer now sends actual browser Files through
prepare, private binary upload, independent stored-byte verification/receipt and
atomic finalize. A successful Send adds only the canonical durable IMAGE message;
selection, reservation and incomplete upload never add provisional history rows.
Exactly 1-4 JPEG/PNG/WebP files, each at most 3145728 bytes, remain the contract.
No captions, compression or replacement of sent images.

- [JSON API](../pages/api/messages/images/[[...segments]].ts): prepare, finalize,
  cancel and participant-authorized URL renewal. HTTP-only verified Western
  session and existing same-origin/custom-header write protection are retained.
- [Binary API](../pages/api/messages/image-upload/[submissionId]/[imageId].ts):
  author-only RLS reservation/slot lookup before consuming bytes; streamed size,
  declared MIME, signature and SHA256 checks. All request network work shares a
  55-second abort deadline and disconnect handling.
- [Server service](../lib/server/message-image-service.ts): immutable upsert=false
  upload, duplicate reconciliation, info/download/hash verification and the
  service-only receipt RPC. Canonical paths come from the authorized reservation;
  signing paths come exclusively from normal participant-RLS image metadata.
- [Server Storage capability](../lib/server/chat-image-storage.ts): requires
  APP_ENV=staging, the exact staging URL/public key and a staging legacy
  service_role JWT. Missing/wrong-project/public server key fails closed. The
  privileged client is never used for ordinary history, sends or read watermarks.
- [Repository](../lib/server/supabase-messages-repository.ts): unified TEXT/IMAGE
  DTOs, one bounded metadata query and one signing batch per history page,
  Photo/N photos previews. IMAGE sequence participates in history merging and
  rendered read acknowledgment. Existing conversation-list N+1 is unchanged.
- [Attachment composer](../components/home/message-attachments.tsx): async Send,
  stable nonce/manifest retries, frozen selection after reservation, local blob
  revocation, cancellation and best-effort unmount cleanup. Unknown finalize
  outcomes reconcile the same ID; they never trigger automatic abandonment.
- [Private rendering](../components/home/message-photos.tsx): single-image and
  existing stacked gallery; five-minute URL renewal before expiry/on load error,
  without remounting the gallery. Sign-out clears account history. No signed URL
  is stored in the database or a draft/session file.
- [PWA configuration](../next.config.js): private chat signed/authenticated URLs
  use NetworkOnly before default image caching. Existing Next.js/PWA rules remain.

Production TEXT remains usable. IMAGE capability is false in production even if
a server key is present; all new IMAGE endpoints reject production before Auth,
database or Storage requests. Neither applied migration was edited. Environment
guard extraction preserves the existing Messages guard and exports.

## Real frontend acceptance and fixtures

Executed [messages-images-e2e-staging.cjs](../tests/messages-images-e2e-staging.cjs).
The harness pins the CLI link/project, verifies the applied IMAGE version and
validates both key project claims before creating anything. Staging keys/passwords
stay in process memory; no personal photos or production data were requested.
It starts an isolated local staging server with an in-memory server credential.

Three disposable confirmed Western Auth users sign in through the normal Auth
API into independent browser cookie contexts: Seller, Buyer and Outsider. Seller
creates/uploads/publishes a clearly named TEMP listing through the normal form.
Buyer uses the real listing Contact Seller button to create/open the conversation.
Primary IMAGE messages are sent through FileDrop and the actual application APIs;
there is no direct IMAGE insertion for the frontend acceptance flow.

Real locally generated JPEG/PNG/WebP and fourth PNG decode with sharp and the
browser. An exactly-3145728-byte valid JPEG, 3145729-byte JPEG and unsupported TXT
exercise boundaries. All files live in an ignored per-run test directory and are
removed afterward.

| Acceptance | Result |
| --- | --- |
| Browser File -> FileDrop -> prepare -> upload -> receipt -> finalize -> renderer | PASS for one and four images; correct order and canonical sequence |
| Mixed history | TEXT then IMAGE(1)/IMAGE(4); sequences 1/2/3; correct durable types |
| Reload and independent Seller session | Private images decode; Seller read watermark acknowledges IMAGE and unread becomes zero |
| Private renewal | Actual normal-session signing endpoint returns all four URLs with JWT lifetime 300 seconds; Outsider signing/prepare denied |
| Frontend load-error renewal | Simulated image error requests the real authenticated endpoint; expanded gallery stays expanded and photos remain decodable |
| Negative UI selection | Oversize, unsupported and five files rejected; exact 3 MiB JPEG sends and renders |
| Lost finalize response | Hosted finalize commits, browser transport discards response, same selection/nonce retry returns the original message without duplicates |
| Partial upload/cancel | First upload succeeds, second transport fails; no durable history; UI Cancel abandons and supported Storage API removes the uploaded orphan |
| Incoming and mobile | Independent Seller IMAGE appears incoming for Buyer; 390px layout has no horizontal overflow |
| Runtime errors | Zero browser runtime errors |

Final complete run passed **13 groups** (including target, fixture/session and
cleanup assertions). Earlier failed runs were harness issues: immediate chat-entry
Send synchronization, an operator SELECT lacking a table grant, a Seller history
assertion before fetch completion, and a size-message regex differing from the
existing validator wording. Used the proven full-page chat/keyboard helper,
administrative SQL reads only for fixture cleanup, explicit history waits and the
actual validation text. No Storage policy/grant or migration was changed to make
tests pass. The first interrupted cleanup was separately recovered and verified;
all later runs cleaned their fixtures.

## Cleanup and verification

Final read-only staging check reports zero Phase2C Auth users, profiles, listings,
conversations, TEXT/IMAGE messages, message_images, submissions/receipts, cleanup
queue entries, chat-images objects and listing-images test objects. Administrative
conversation deletion performs DB cascades; physical deletion uses supported
Storage remove, never raw storage.objects DELETE. Guarded queue acknowledgment
uses an explicitly scoped fixture-clock age adjustment for only test paths.
The private chat-images bucket remains with the exact MIME/3145728 limits;
listing-images configuration is unchanged. All six migration versions still match.

Generated image fixtures and temporary SQL are removed. Browser contexts close;
no storageState, password, key, cookie or session files are written. The isolated
server stops. Temporary run evidence is removed after recording this report.
Production `.env.local` remains byte-for-byte unchanged.

Local TypeScript, focused ESLint, IMAGE API/credential guards, existing Messages
API/environment/CSRF tests, image-selection/grouping tests and both migration
static suites pass. Hosted staging database lint reports no schema errors.
Production-mode build completed successfully (exit 0) with staging public config
and an explicitly empty server key; it did not deploy or contact production.
Its global lint step logged a naming-convention/parserServices error on unchanged
components/ui/GlideSelect.jsx, reproduced by isolated lint. Focused changed-file
lint passed; no unrelated JSX/lint configuration was edited. Browserslist also
reported its existing outdated-data notice. This is not a clean whole-repository
lint result.

Documentation validation passed 135 local links across 18 Markdown files with
zero missing targets/anchors; git diff --check passed. Scanning 45 generated
client scripts found zero server Storage capability markers or service-role
tokens. Source and generated service worker both put private chat media under
NetworkOnly before default caching. Unit tests also verified oversized/MIME
rejection before body reads, stalled-stream abort and staging-launcher key guards.

Phase 2C changed browser API/types and the attachment/history/chat/gallery
components; added MessagePhotos, server Storage/service/environment modules,
two IMAGE API routes, API/security tests and real frontend staging tests; updated
the staging launcher/PWA configuration, this report, PROJECT_STATUS and the
design's historical-status pointer. No dependency changes or migration edits.

## Configuration and limits

For later local staging work, use the ignored `.env.staging.local` or the process
environment for SUPABASE_SERVICE_ROLE_KEY; never NEXT_PUBLIC or a committed file.
[dev-staging.cjs](../scripts/dev-staging.cjs) validates its project/role and explicitly
sets an empty secret when none is configured, preventing production dotenv
inheritance. A key is required only to enable IMAGE operations; TEXT does not need it.
This phase used an ephemeral test-process key and did not add one to an env file.
New opaque sb_secret keys are intentionally unsupported by this project-ref gate.

Signing failure after commit is a retry of the same finalize/presentation, not
proof that send failed. Cancel may lose a race to finalize; the UI retains the
submission and asks the user to retry Send to reconcile it. Queued cleanup and
tombstones remain available for unknown/late upstream writes. No expiry worker,
inventory sweeper or scheduled physical cleanup is deployed.

The UI renewal test simulates an image-load failure; it does not claim a real
five-minute expiry wait. The abort deadline is implemented, but long upstream
timeout/late-write chaos is not hosted-tested here. Signed URLs remain bearer
capabilities until expiry. Phase 2B's independent database concurrency and
historical-retention evidence remains in the
[staging verification report](MESSAGES_IMAGE_STAGING_VERIFICATION.md).

**STAGING ONLY. PRODUCTION NOT MODIFIED. PHASE 1 TEXT CONTRACT PRESERVED.
NO REALTIME. NO DEPLOYMENT. NO COMMIT. NO PUSH.**

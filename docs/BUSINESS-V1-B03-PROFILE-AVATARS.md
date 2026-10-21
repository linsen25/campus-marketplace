# B03 persistent profile avatars — local implementation

Status: locally implemented and qualified; **the single B03 migration is now deployed and the authorized local-app-to-Staging acceptance passed**. See deployment/acceptance evidence below. No Production access. B02 deferred verification stays recorded in `BUSINESS-V1-B02-ACCOUNT-VALIDATION.md`; B04 is not started.

## Implemented behavior

- Existing Settings Set avatar/AvatarDialog uploads through the existing verified Western Auth identity. No second identity/profile system.
- Server streams at most 3 MiB, checks JPEG/PNG/WebP signatures and actual Sharp decoding, rejects SVG/animation/corrupt input, limits each dimension to 4096 and total input pixels to 16,777,216.
- Sharp auto-orients, strips metadata, preserves proportions without cropping, and produces WebP within 1024 x 1024 without enlargement. Output is also bounded to 3 MiB.
- `profiles.avatar_path` is the canonical current pointer. Paths are immutable `owner UUID/action UUID.webp`; browser-supplied owner/path is never accepted.
- A stable action UUID is reused after ambiguous failures. Different content/version with the same UUID conflicts. Prepare/commit serialize on the owner and check both the expected current pointer and the newest prepared generation. A late old request cannot overwrite a newer avatar. Replaying an old successful command returns the current projection instead of reactivating old media.
- Existing Home Profile/Settings restore the canonical avatar, clear account-specific state on identity/logout changes, and ignore delayed former-account responses.
- Public Seller UUID/username routes use the same existing projection. The public media API accepts only Profile UUID + avatar version, checks the current pointer, downloads that exact private object, then rechecks the pointer before responding. No arbitrary Storage paths or service keys are returned.
- No avatar means the existing `UserAvatar` fallback. No CSS, geometry, typography, button copy or animation changes. The approved Save exception waits for success, blocks duplicate Save, retains the selection/error on failure, and retries. Cancel/Escape/outside close behavior remains available.

## Migration and authority

New forward-only file: `supabase/migrations/202610180002_profile_avatar_persistence.sql`.

1. Adds nullable `public.profiles.avatar_path`, constrained to that Profile UUID's WebP path. No historical backfill; pre-existing profile fields and timestamps stay unchanged.
2. Adds private `profile_avatar_uploads` command/media metadata: UUID, owner UUID, monotonic generation, source/stored hashes, size, expected pointer, generated path, lifecycle timestamps/state. Owner UUID is retained for cleanup even if the account is later deleted; this is media bookkeeping, not an identity system.
3. Creates private `profile-avatars` bucket, WebP only, 3 MiB limit. Existing buckets are untouched.
4. Enables private-table RLS and revokes direct browser/service table and sequence access. Existing Profile grants/policies remain unchanged; browser UPDATE still cannot write the new pointer column.
5. Adds a restrictive Storage policy denying anon/authenticated direct access to this bucket, including under future permissive policies. Other buckets retain their existing rules.
6. Adds only four service-role-executable SECURITY DEFINER functions with empty search_path: prepare, commit, claim cleanup, finish cleanup. No Order/payment/scheduler function or trigger is modified.
7. Notifies PostgREST to reload schema only after transaction commit.

The upload endpoint checks the explicit staging environment and matching service-role configuration before Auth/provider I/O. Auth itself still uses the request-cookie/public-key client. Avatar operational credentials remain server-only. Public Seller data lookup remains anonymous.

New preparations are capped at 20 per owner/hour; retries of an existing matching command do not consume a new preparation.

## Replacement and orphan cleanup

Upload new immutable media first; commit the pointer atomically; only then retire the former object. Failed upload/commit leaves the previous pointer intact.

Unreferenced pending/retired assets have a 24-hour grace period. Claiming cleanup holds the same owner lock and marks the command `deleting`, preventing later commit. Current referenced paths are excluded. Storage deletion failure leaves a durable retryable record; success is acknowledged separately. A deleted record whose object reappears after an unusually late upload remains discoverable for another safe cleanup attempt. Cleanup is bounded independently and cannot fail an already committed Save.

No background cron was added. Successful uploads opportunistically clean up that owner's eligible old objects. Idle/crash-only queues require a later authorized server maintenance invocation of the existing cleanup helper; there is no guarantee of automatic idle cleanup in this pass. Do not delete Storage rows directly or run broad prefix/bucket deletes. No existing remote objects were touched.

## Exact application files

New:

- `lib/profile-avatar.ts`: shared limits and canonical projection.
- `lib/profile-avatar-api.ts`: raw upload client.
- `lib/server/profile-avatar-repository.ts`: guarded server Storage/RPC capability and timeouts.
- `lib/server/profile-avatar-service.ts`: stream/decode/normalize/upload/commit/cleanup.
- `pages/api/profile/avatar.ts`: authenticated upload.
- `pages/api/profile/avatar/[id].ts`: current-reference-only public media.
- `hooks/use-profile-avatar.ts`: owner-bound restoration/retry/stale-response handling.
- `types/sharp.d.ts`: narrow declarations for the already-installed Sharp 0.30 dependency; no package/dependency change.

Modified:

- `components/home/animated-sidebar-demo.tsx`: replace persisted blob state with the owner-bound hook.
- `components/home/profile-avatar.tsx`: approved async Save and input validation.
- `components/home/profile-overview.tsx`: asynchronous save callback type.
- `pages/api/profile/account.ts`: own canonical avatar projection.
- `lib/server/public-seller.ts`, `lib/public-seller.ts`: use existing public avatar field.

## Local verification

New test files: `tests/profile-avatar-api.cjs`, `tests/profile-avatar-db.cjs`, `tests/profile-avatar-db.sql`, `tests/profile-avatar-persistence.browser.cjs`.

Updated test files: `tests/profile-account.cjs`, `tests/public-seller.cjs`, `tests/profile-avatar.browser.cjs`, `tests/account-workflow-api.cjs` (account projection's added avatar fields).

- `node tests/profile-avatar-api.cjs`: real Sharp JPEG/PNG/WebP conversion, orientation/metadata stripping, invalid type/signature/truncation/size/dimension/animation rejection; raw API, auth/origin/owner rejection, ambiguous upload retry, command conflict, cleanup failure, public arbitrary-path rejection and replacement/read race. HTTP/Storage transport is mocked; no remote I/O.
- `node tests/profile-avatar-db.cjs`: isolated native PostgreSQL 17.11, actual base/username/pending-profile and B03 migrations, with Supabase-owned Auth/Storage schema stand-ins. Tests private ACL/RLS, owner paths, retry, wrong/unverified owners, stale pointers, failed uploads, cleanup grace/retry/success and preservation of the current avatar. Two real DB connections verify rechecking after owner-lock contention. Existing Profile data/timestamps are compared before/after migration.
- `node --openssl-legacy-provider tests/profile-avatar-persistence.browser.cjs`: real AvatarDialog, hook, upload client and CSS at 390/430/820/1280/1536. Tests async pending/duplicate prevention, failed selection retention, same-UUID retry, reload restore, account changes/logout and stale responses, modal fit and overflow. API responses are controlled fixtures; this is not hosted Auth/Storage E2E. Pending screenshots are under ignored `tests/artifacts/message-payload-qualification/avatar-pending-*.png`.
- `tests/profile-account.cjs`, `tests/public-seller.cjs`, `tests/profile-polish-api.cjs`, `tests/account-workflow-api.cjs`, `tests/marketplace-session.cjs`: passed locally. The B02 tests here use intercepted transport, not repeated remote B02 qualification.
- `tests/stripe-setup.cjs`: existing offline provider/setup regression passed; no Stripe implementation or configuration was changed.
- Application-source TypeScript, focused ESLint, and tracked/new-file whitespace checks passed.

Existing `tests/profile-avatar.browser.cjs` was updated to use supported WebP and canonical async persistence mocks instead of asserting local-only blobs/SVG acceptance. Its app-server-based suite was not executed in this pass; the new standalone suite above was executed at all five widths.

Early local harness/type/lint failures were corrected; no failing final B03 check remains. No environment file, credential fixture, package manifest, CSS or historical migration was edited.

## Reviewed Staging rollout plan (subsequently authorized and executed below)

1. Use an isolated context and explicit `pcaqxezdfxofysghssyo`, never the default linked project. Read-only confirm current Profile columns/ACL, applied versions, new bucket/table/function name availability and existing Storage policies. Stop on drift/collision.
2. Review the exact single migration and record its hash. Apply only this migration transaction and its migration-ledger record; do not batch other pending migrations. Never rewrite applied history.
3. Read-only confirm nullable pointers, existing Profile timestamps, bucket privacy/limits, restrictive policy and function ACL/search_path.
4. Deploy/run the matching application code only after the schema is available. Current account/public Seller queries select the new column; running this code against the old schema will fail safely rather than invent an avatar or silently hide a deployment gap. Production remains disabled for avatar writes/storage.
5. Under separately authorized disposable users, test real Storage upload/reload/relogin, two-user RLS/direct access, stale concurrent replacements, failure/retry, current-only anonymous Seller/media reads, metadata stripping and cleanup. Verify the deployed runtime's Sharp native binary. No real user account/image changes.
6. Exercise cleanup only on exact fixtures after explicit authorization. Do not backdate real media, change other workers, or delete a whole bucket. Preserve command/audit evidence and check no current pointer references a deleted object.
7. Stop and report on any anomaly; no automatic schema rollback/data deletion. For application rollback, retain the nullable column/private bucket/metadata to avoid destroying references; any database reversal needs its own reviewed plan/approval.

The local-only stage stopped for explicit approval. The next section records the later authorized Staging operations; this does not authorize Production or a hosted application deployment.

## Authorized Staging deployment and acceptance

Target was explicitly pinned to `pcaqxezdfxofysghssyo`, using the isolated `tests/artifacts/b01/staging-context` and an explicit CLI project ref. The default Production-linked context was never used. No emails or payments were executed.

Only `202610180002_profile_avatar_persistence.sql` was deployed, transactionally with one migration-ledger entry. SHA-256: `c452c5436a5d1417ba8dafef293f3ab0d4f4c7f00b184c7af35929fa2f268af9`. Preflight confirmed the prior Profile/Auth definitions, grants and Storage policies matched the recorded baseline, with no avatar-name collisions. Post-deployment checks confirmed exact archived source, all four RPC ACLs, empty search_path/SECURITY DEFINER, restrictive Storage policy and private WebP-only 3 MiB bucket.

`tests/profile-avatar-staging.cjs` was added as an explicit opt-in acceptance harness. It runs the actual local Auth/account/avatar handlers, server services, Sharp decoder, public Seller projection and existing AvatarDialog/ProfileAvatar/hook in a loopback-only test server. Requests reach real Staging Auth/Storage/RPCs; there is no external app deployment. The wrapper page is a test harness, not the complete Home page.

Passed actual tests:

1. Two disposable users per run, no-email Admin creation and ordinary existing password-login handler.
2. JPEG, PNG and WebP server conversion, real private Storage upload, correct WebP output and canonical anonymous image response.
3. SVG/oversized/corrupted rejection without changing the current pointer.
4. Failed replacement preserves the previous avatar. Failure was injected at the server transport boundary; it was not an actual hosted Storage outage. Same action retry and successful replay did not duplicate or overwrite media.
5. Two real concurrent commit calls: the newer prepared intent succeeds, the older conflicts; former public avatar URL returns 404.
6. Cross-user RPC/Profile-pointer/Storage write attempts denied. Even authenticated owner and anonymous direct reads of the private object are denied. Arbitrary public media path input rejected.
7. Public Seller UUID and username aliases return the same current avatar URL; the actual public image API returns and decodes that image without Auth.
8. Real browser upload and refresh at 390/430/820/1280/1536, followed by actual image decode (`complete` and `naturalWidth > 0`), no overflow, and avatar persistence after logout/relogin.
9. New-account existing initial-letter fallback remains correct.

The first successful run's screenshot check was strengthened to await image decode rather than merely an attached img element. A second run passed the stronger check. Across the two runs, four unique temporary accounts were created and deleted. There was no product-code fix during Staging qualification.

Evidence (ignored, sanitized):

- `tests/artifacts/b03-preflight.json`, `b03-schema-verify.json`: schema/ACL/source preservation.
- `tests/artifacts/b03-live-5acd6714-f161-499c-824a-229bfa47addd/result.json`: first run, cleanup complete.
- `tests/artifacts/b03-live-d78c9394-2ed4-4da9-887c-2c171523d91a/result.json`: final run, cleanup complete; `avatar-390.png` through `avatar-1536.png` show loaded media.
- `tests/artifacts/b03-cleanup-final.json`: zero fixture users/sessions/preferences, avatar objects, upload records and set pointers after cleanup.
- `tests/artifacts/b03-final-state.json`: all original Profile/Auth/Order/Listing fingerprints equal deployment preflight.

Cleanup deleted only run-owned accounts, then enumerated and removed only their exact UUID-prefix objects after the official profile pointer disappeared. Only corresponding upload metadata was removed. No bucket-wide delete, historical object deletion, cron change, RLS relaxation or trigger disabling occurred. The new private bucket and schema intentionally remain deployed.

Final TypeScript, focused acceptance-harness ESLint and diff checks passed. No final test failure remains. UI/CSS/layout/animation sources were not changed in this deployment pass. B03 is accepted for the authorized Staging/local-runtime scope. A separately deployed hosting runtime's Sharp availability, idle orphan automation and Production rollout remain outside this acceptance. No stage/commit/push, no Production and no B04.

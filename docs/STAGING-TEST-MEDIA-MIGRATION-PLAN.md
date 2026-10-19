# Execution update ? 2026-10-18

User explicitly approved all six Listing photo/title changes, including category-accurate titles, the temporary media publication-lock exception and the additional timestamp-trigger exception. The original four-Listing proposal below is retained as audit history, not the executed scope.

Executed: seven new WebP uploads with upsert=false, then one exact-ID transaction changing seven media UUIDs/generated paths and six titles. New titles: Desk Lamp; Books Collection; Laptop Workspace; Desktop Monitor; Canvas Sneakers; Game Controller. All other Listing fields including timestamps, status and provenance are unchanged. `search_text` was automatically regenerated. No descriptions, taxonomy, financial or lifecycle fields were edited.

Full-row preconditions and row-count checks passed. `listing_images_publication_lock` and `listings_updated` were temporarily disabled only within the locked transaction and restored before commit; `listing_image_ready` remained enabled. Read-only postflight confirmed all Listing/image/trigger invariants. Audited fields of six Conversations, nine Offers, four Orders and four private media copies match the preflight. Final postcommit public GET verified SHA-256 for all seven original objects and all seven replacements. Seven original Storage objects remain available and are backed up locally; no object was deleted or overwritten.

Local ignored evidence: staging-media-preflight.json, staging-media-upload-results.json, staging-media-apply-approved.sql, staging-media-apply-result.json, staging-media-postflight.json, staging-media-consumers-post.json, staging-media-original-backups/, staging-media-rollback-statements.sql and staging-media-rollback-guarded.sql. The full guarded rollback transaction is prepared but NOT executed. Reverse statements require the same guarded maintenance transaction and current-row verification before use; they have NOT been executed.

Actual staging-backed local Market: five available seed Listings verified at 390/430/820/1280/1536, new final Storage URLs decode and match between collapsed/expanded cards, no horizontal overflow. Browser font requests were aborted to exercise fallback and avoid external font readiness blocking; application DOM/data were not overridden. Screenshots: tests/artifacts/staging-market-migrated-<width>.png. Canvas Sneakers remains pending and absent from the public available feed; do not claim it was made publicly browsable. Historical Order photos remain frozen synthetic snapshots by design. Authenticated owner Manage Resale additionally rendered the pending Canvas Sneakers at all five widths with no overflow and its exact new image path; its public direct detail remains inaccessible, so no eligibility bypass was used.

---

# Staging test media: approval checkpoint

Status: READ-ONLY AUDIT COMPLETE. No uploads, DB changes, schema changes, or production access.

Target: western-marketplace-staging (`pcaqxezdfxofysghssyo`). Audited 2026-10-18.

## Exact six Listing records

| Listing ID | Owner ID | Title | Channel / current status | Proposed photo key | Decision |
|---|---|---|---|---|---|
| `5e1234d0-0f67-4af1-a036-0c18e4a8693a` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2` | [DEMO] Desk Lamp | resale / available | `deskLamp` | Propose |
| `82680659-1f93-405c-a0b6-cebe52011498` | `eb0fc272-b774-4253-af20-dd53713222a0` | [DEMO] Calculus Textbook | resale / available | `textbook` | Propose |
| `90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2` | [DEMO] MacBook Air M2 | resale / available | `laptop` | Propose |
| `cbbc071e-4ea5-447e-b048-e700187234f9` | `eb0fc272-b774-4253-af20-dd53713222a0` | [DEMO] 24-inch Monitor | resale / available | `monitor` | Propose |
| `d5fcc2b1-2369-4757-b604-cd98f1f0e650` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2` | [DEMO] Nike Dunk Low | resale / pending | `sneakers` | HOLD: wrong model photograph |
| `f0629930-524c-452c-91e4-c47a3a231ae6` | `eb0fc272-b774-4253-af20-dd53713222a0` | [DEMO] PS5 Controller | resale / available | `controller` | HOLD: wrong model photograph |

All six have matching seed catalog IDs, exact description markers, seller-a/seller-b app metadata with `demo_system=campus-marketplace-staging-demo-v1`, and matching seed account identity. Title matching was not used as authority. No genuine user records are included.

Photos are illustrative test photography, not proof of exact model. Laptop photo is a laptop/workspace and books photo is books; neither proves M2/Calculus. Controller photograph visibly depicts Xbox-style controls, not PS5; sneaker photograph depicts Converse-style shoes, not Nike Dunk Low. These two replacements are excluded pending suitable approved existing assets. Titles and other Listing text will not be changed. MacBook retains two existing image slots; both would use the same canonical laptop photograph, not invent a second product angle.

## Seven exact existing objects and proposed destinations

Bucket: `listing-images`. Public URL prefix: `https://pcaqxezdfxofysghssyo.supabase.co/storage/v1/object/public/listing-images/`. Paths have no extension because the database generates them from UUIDs. Content-Type for new objects: `image/webp`.

### [DEMO] Desk Lamp / slot 1
- Existing media ID: `358a65e8-e50a-4c6b-9885-1e23f364035e`
- Old path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/5e1234d0-0f67-4af1-a036-0c18e4a8693a/358a65e8-e50a-4c6b-9885-1e23f364035e`
- Proposed media ID: `a9df6c31-3fea-5d47-af88-fc3983e9eff3`
- Proposed path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/5e1234d0-0f67-4af1-a036-0c18e4a8693a/a9df6c31-3fea-5d47-af88-fc3983e9eff3`
- Source: `public/static/testPic/desk-lamp.webp` (`deskLamp`)
- SHA-256: `055b4d2862921ab1cd43b8887d3577a64e2eedf9da77ea6425b634ad95e7d13c`
- Status: proposed, requires approval

### [DEMO] Calculus Textbook / slot 1
- Existing media ID: `8a4fe4e0-227d-4e69-ae4b-fdb43b1dd0ba`
- Old path: `eb0fc272-b774-4253-af20-dd53713222a0/82680659-1f93-405c-a0b6-cebe52011498/8a4fe4e0-227d-4e69-ae4b-fdb43b1dd0ba`
- Proposed media ID: `566acd2e-2c35-5a9a-8d23-709cf027fc1f`
- Proposed path: `eb0fc272-b774-4253-af20-dd53713222a0/82680659-1f93-405c-a0b6-cebe52011498/566acd2e-2c35-5a9a-8d23-709cf027fc1f`
- Source: `public/static/testPic/textbook.webp` (`textbook`)
- SHA-256: `6e76590e24d9eaf34f7f56a6421f4e0ebd15fdb19baa20e7a332b684160d0bd7`
- Status: proposed, requires approval

### [DEMO] MacBook Air M2 / slot 1
- Existing media ID: `d5ccc0b1-8ce9-4e3c-9fd0-6d9b509c821d`
- Old path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/d5ccc0b1-8ce9-4e3c-9fd0-6d9b509c821d`
- Proposed media ID: `70b98526-6bd6-57bd-b412-aa1dbc3c64bd`
- Proposed path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/70b98526-6bd6-57bd-b412-aa1dbc3c64bd`
- Source: `public/static/testPic/laptop.webp` (`laptop`)
- SHA-256: `5b859a6204aaeb161f96b1c01cd15b63c64e09ad10dd4ba17119014f1c0928fa`
- Status: proposed, requires approval

### [DEMO] MacBook Air M2 / slot 2
- Existing media ID: `e1275464-4f5e-426e-b39c-375a54c2eb2d`
- Old path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/e1275464-4f5e-426e-b39c-375a54c2eb2d`
- Proposed media ID: `a5f68cb2-c6d7-5c72-985a-bff129e43700`
- Proposed path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/a5f68cb2-c6d7-5c72-985a-bff129e43700`
- Source: `public/static/testPic/laptop.webp` (`laptop`)
- SHA-256: `5b859a6204aaeb161f96b1c01cd15b63c64e09ad10dd4ba17119014f1c0928fa`
- Status: proposed, requires approval

### [DEMO] 24-inch Monitor / slot 1
- Existing media ID: `2d7be7e6-58dd-4d66-8df2-05591dc38e8e`
- Old path: `eb0fc272-b774-4253-af20-dd53713222a0/cbbc071e-4ea5-447e-b048-e700187234f9/2d7be7e6-58dd-4d66-8df2-05591dc38e8e`
- Proposed media ID: `ef1c35cf-f05f-5756-82d4-2c5c8c413fae`
- Proposed path: `eb0fc272-b774-4253-af20-dd53713222a0/cbbc071e-4ea5-447e-b048-e700187234f9/ef1c35cf-f05f-5756-82d4-2c5c8c413fae`
- Source: `public/static/testPic/monitor.webp` (`monitor`)
- SHA-256: `e9d40daf29d48a6785b377ac1fac984fdc8658857be79461d27f582aba403be5`
- Status: proposed, requires approval

### [DEMO] Nike Dunk Low / slot 1
- Existing media ID: `f912e481-566c-4a6d-b6f7-7f250289285e`
- Old path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/d5fcc2b1-2369-4757-b604-cd98f1f0e650/f912e481-566c-4a6d-b6f7-7f250289285e`
- Proposed media ID: `d171cd7a-e2af-5104-9f3a-50aa81da88a0`
- Proposed path: `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/d5fcc2b1-2369-4757-b604-cd98f1f0e650/d171cd7a-e2af-5104-9f3a-50aa81da88a0`
- Source: `public/static/testPic/sneakers.webp` (`sneakers`)
- SHA-256: `dcf332504fedc00d2aea8ed1791f75ff1cdb2c875f178172fd1f34899d3c4362`
- Status: HOLD; do not upload or update

### [DEMO] PS5 Controller / slot 1
- Existing media ID: `6deb87ab-8c38-4586-bdd3-506ec469785e`
- Old path: `eb0fc272-b774-4253-af20-dd53713222a0/f0629930-524c-452c-91e4-c47a3a231ae6/6deb87ab-8c38-4586-bdd3-506ec469785e`
- Proposed media ID: `b38b1581-6bc3-5878-84b6-9bd34ec04fa5`
- Proposed path: `eb0fc272-b774-4253-af20-dd53713222a0/f0629930-524c-452c-91e4-c47a3a231ae6/b38b1581-6bc3-5878-84b6-9bd34ec04fa5`
- Source: `public/static/testPic/controller.webp` (`controller`)
- SHA-256: `a400569ed008c719608f434592f82c9385b2dd545f4ab6e7f41a676c707b3b53`
- Status: HOLD; do not upload or update

## Existing consumers

Read-only query found 6 conversations, 9 Offers and 4 Orders associated with these Listing IDs. All nine Offers and four Orders concern Nike. Offer listing_media_snapshot arrays are empty. Conversations use live Listing photoUrls (`lib/server/supabase-messages-repository.ts`), so current Listing replacement can propagate there without editing messages.

The four Nike Orders reference separate immutable `order-snapshot-media` assets. Their source_path/source_media_id cite the old Nike image. Preserve all four assets and all source references; do not rewrite historical snapshots. Order images may therefore remain synthetic. This is intentional historical preservation, not a claim that every historical image has been migrated.

| Order ID | State | Frozen asset ID |
|---|---|---|
| `52d48552-e1c9-4b91-8bb5-54dcb38aa293` | cancelled | `ae996c9d-b8b1-4660-b91c-7695a3e31ce1` |
| `fda25a07-1c57-483e-93f1-2ae81b39b6c7` | cancelled | `9a52553f-8468-4abb-9079-465ac00ada77` |
| `0abe1e4e-5213-46d9-a229-6fbe69780d80` | open | `434fb796-f5ce-46da-b19e-d6ebc66f2e6b` |
| `16150ed7-36cb-43a2-acf9-107078a7f975` | cancelled | `cf8635b3-ac64-43d0-9e46-cc4861d1969a` |

Exact conversation/Offer IDs and full private source/copy paths are in the local backup manifest `tests/artifacts/staging-media-migration-proposal.json`.

## Authority constraint requiring explicit approval

`listing_images.path` is GENERATED from owner/listing/media IDs. `listing_images_publication_lock` rejects media identity changes and any published Listing media mutation; a regular owner upload/update cannot perform this operation. Storage versioning is disabled. Do not overwrite old object contents, bypass in frontend, change Listing publication/status, or invent a general published-media edit API.

Proposed narrow administrative exception, only if specifically approved: one short staging maintenance transaction locks the six parent rows and the media table, revalidates exact old rows and trigger definitions, temporarily disables only `listing_images_publication_lock`, changes only the five approved media UUIDs with exact existing-value predicates, and re-enables the trigger before commit. Keep `listing_image_ready` verification active; no RLS/policies/schema definitions are permanently changed. Require exact expected row count, statement/lock timeouts, and abort on drift or unexpected inbound foreign keys. This is a backend maintenance exception and is NOT authorized by the read-only audit.

## Upload / backup / rollback plan

1. Requery provenance, full Listing/media rows and relevant consumers immediately before any authorized operation. Compare to the reviewed manifest; stop on drift. Save refreshed backup locally (ignored artifacts); never log credentials.
2. Download the seven original objects to local backup; record bytes, MIME, SHA-256 and successful decoding. Keep all original Storage objects in place.
3. For the approved subset only (currently four Listings / five image rows), upload exact existing local WebP bytes to the listed new UUID paths using Storage API with upsert=false. Do not write storage.objects directly. Verify remote SHA-256, MIME, size and decode before any DB attachment.
4. Execute the approved exact-ID maintenance transaction described above. Preserve listing_id, owner_id, slot, ready and created_at; only media ID and its generated path change. No Listing fields/timestamps, favorites, conversations, Offers, Orders or permissions change. Verify affected count=5 and unchanged snapshots/Listing rows before commit.
5. After commit verify real Market URLs/decoded photos at 390/430/820/1280/1536, collapsed/expanded cards and live consumers. Nike stays pending, not made publicly available merely for testing. Verify historical private Order snapshots remain unchanged.
6. If any precommit check fails, ROLLBACK restores all database state including trigger state; any new unattached objects remain harmless and are not deleted in this pass.
7. Postcommit rollback uses the same specifically approved scoped maintenance exception, matching exact new media UUID/path/owner/listing/slot/created_at preconditions, reversing each approved manifest pair new_id -> old_id. Generated paths return to old paths, old bytes still exist. Re-enable trigger before commit; verify exact row count=5. Do not alter snapshots or delete old/new objects. Stop if rows have changed since migration.

## Approval requested / remaining limitations

Approve only the four semantically usable Listing replacements (five media rows), their new Storage uploads, and the explicitly scoped temporary publication-lock maintenance exception. Controller and Nike remain excluded until suitable existing approved imagery is identified. If six-of-six is mandatory, those two photos are a remaining prerequisite; no unrelated photos or title changes will be used.

No Market-fix success claim yet: no uploads or mutations have occurred, and post-migration browser verification is pending. The queued Profile color / UI V1 handoff task resumes after this higher-priority media operation is resolved.

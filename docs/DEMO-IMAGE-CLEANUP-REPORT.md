# Demo/test image cleanup report

Audit date: 2026-10-18. Phase: local inventory complete; authorized staging image/title migration executed. See STAGING-TEST-MEDIA-MIGRATION-PLAN.md execution update.

## Scope and method

Walked current local worktree (including ignored tests/artifacts): 1248 image files and 3369 eligible text files; 73 public image assets. Excluded dependencies, Git internals and generated .next/out/dist caches. Environment files and credentials were not inspected. Searched source, CSS, fixtures, scripts and tests for synthetic labels, paths and candidate filename stems; SHA-256 identified exact duplicate groups. Binary images are not conclusively classified by text search. Filename/stem hits are candidate references, not proof of active use; absence of a literal path is not proof of safe deletion for dynamically composed paths.

## Deletions and space reclaimed

- Deleted files: none.
- Reclaimed space: 0 bytes.
- No whole-folder deletion, unrelated worktree cleanup or Storage deletion.
- No new application image system; canonical 30-photo registry remains lib/fixtures/test-pictures.ts, reused by scripts/lib/test-pictures.cjs.

## Retained assets and reasons

| Resource | Reason retained |
|---|---|
| public/static/testPic/*.webp (30) | Canonical real photographs; runtime/local fixtures and browser tests use these. |
| public/static/icons/*, public/favicon.ico | Logo/favicon/PWA/UI assets are expressly outside deletion scope. |
| public/lanyard/* | Welcome brand/interactive assets, not obsolete product illustrations. |
| public/static/images/banners/* and home/banner.jpg | Legacy category/landing assets with candidate references; unrelated to target synthetic product migration. No deletion without proving dynamic consumers obsolete. |
| public/static/images/socials/* | Metadata/social identity resources, not product illustrations. |
| masked-heading-fill.svg | Decorative UI asset, not a product illustration. |
| tests/artifacts/checkpoint-head-baseline/** | Historical comparison baseline; duplicate hashes do not make it disposable under this task. |
| tests/artifacts/*build*/** and screenshot evidence | Generated test artifacts were inventoried but excluded from deletion; removing unrelated artifacts is prohibited. |
| tests/artifacts/staging-old-*.png | Read-only evidence/backup of seven legacy staging objects; preserve during migration. |
| QR/avatar/invalid-image technical specimens | Still useful for behavioral/security/encoding tests; not replacements for demo product photography. |

## Confirmed remaining synthetic media

Seven old persisted objects have been replaced as current media references for six verified seed Listings; the original bytes remain retained for rollback. Four independent private Order snapshots additionally retain the Nike synthetic image. These are not abandoned public/ source files. Preserve all originals and frozen historical media. Exact IDs, old/new paths, provenance, backup and rollback are documented in STAGING-TEST-MEDIA-MIGRATION-PLAN.md and the local manifest. No Storage deletion is requested or authorized.

Public/source searches found no literal Synthetic illustration or Not for sale marker in active components/lib/public text. The marker still exists in downloaded staging imagery and audit evidence. This does not prove every opaque binary or historical artifact contains no illustration.

## Approved and executed title cleanup

| Exact Listing ID | Proposed title matching category-level photo |
|---|---|
| 5e1234d0-0f67-4af1-a036-0c18e4a8693a | Desk Lamp |
| 82680659-1f93-405c-a0b6-cebe52011498 | Books Collection |
| 90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60 | Laptop Workspace |
| cbbc071e-4ea5-447e-b048-e700187234f9 | Desktop Monitor |
| d5fcc2b1-2369-4757-b604-cd98f1f0e650 | Canvas Sneakers |
| f0629930-524c-452c-91e4-c47a3a231ae6 | Game Controller |

The user explicitly approved this expansion, superseding the prior keep-title / hold-Nike-and-controller plan. It would permit semantic category photography without asserting a false model. Historical Offer/Order title snapshots must remain unchanged. Preflight inspected title triggers; separately approved temporary timestamp-trigger exception preserved original updated_at. Do not strip [DEMO] globally, run the broad seed command, or change actual user records.

## Validation

- Canonical photo unit test: PASS (30 normalized, distinct, provenanced photos).
- Application-source TypeScript: PASS.
- Focused ESLint: PASS (registry, canonical CJS adapter and photo unit/browser tests).
- git diff --check: PASS.
- Browser photo regression: PASS at 390 / 430 / 820 / 1280 / 1536. All 30 photos decode; three fixture identities retain consistent photos across Market/expanded/Favorites/owner/Messages/Sales/Purchases/Order Detail. Shop covers and crops verified, no horizontal overflow; real failed uploaded URLs remain unchanged. Controlled LOCAL fixtures using real presentation components; NOT a live staging migration test.

## Remaining sequence

1. Approved staging migration: complete; exact data/trigger checks passed.
2. Actual public Market: five available seed records verified at all five widths. Pending seed retained its original status and its new image was additionally verified in authenticated owner Manage Resale; no access-authority bypass. Historical snapshots remain unchanged.
3. Post-migration local reference inventory found no safely deletable obsolete product illustration; deletion set remains empty. No unrelated test artifact cleanup.
4. Continue UI V1 Profile color/handoff work.

No production access, no commit, no push. No environment changes. Cleanup itself changed no application code; subsequent Profile-only color changes are documented separately.

Seed-source consistency: scripts/staging-demo.cjs now uses the six approved photo-matching display titles for NEW fixture creation, without [DEMO]. Original catalog wording remains only in the exact legacy description identity lookup so re-running a seed does not create duplicate Listings after a rename. No seed/reset command was executed. Legacy tests that search exact old [DEMO] titles (formal-ui-recovery.browser.cjs and order-manual-fixture-staging.cjs) require a separate fixture-contract update before reuse; frozen historical snapshots are not renamed.

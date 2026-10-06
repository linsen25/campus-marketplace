# Listings V1 backend foundations — pending migration review

Exact SQL: [202610050001_marketplace_publication_favorites.sql](../supabase/migrations/202610050001_marketplace_publication_favorites.sql).
Apply only after the already-applied taxonomy migration, following explicit review.
This work has not applied live SQL. Existing Home/Create/Favorites UI is deliberately unchanged.

## Publication contract

`published_at` is nullable, with no default. `expected_image_count` is a required,
immutable 1-6 creation manifest with no default. At least one photo is mandatory;
JPEG / PNG / WebP, 3 MB per image and max 6 are unchanged.

Before backfilling, the migration aborts clearly if any existing listing lacks a
complete valid 1-6 image set: correct owner, contiguous slots, ready metadata and
matching valid Storage metadata. It deletes nothing and requires manual review.
Valid existing rows receive `published_at = created_at` and their exact metadata
image count, preserving previous publication. Status remains `available` / `sold`.

1. Validate all listing fields and selected files before creating anything.
2. `POST /api/listings` with `photoUrls: []` and `expectedImageCount` creates a
   private, unpublished row. Identity/owner are assigned by the database.
3. Sequential `POST /api/listing-images/:id` reserves ordered slots, uploads
   supported files, and marks each reservation ready only after Storage succeeds.
4. `POST /api/listings/:id/finalize` invokes the authenticated owner-only
   `marketplace_finalize_listing` RPC. It locks the listing, verifies exactly the
   expected number of ready images, contiguous slots, matching owner, and valid
   existing Storage object metadata, then sets `published_at`.
5. Repeating finalization returns the already-published listing without changing
   the timestamp. Generic PATCH cannot set publication or the manifest.

`createPublishedListing(input, files)` in `lib/listing-publication.ts` implements
this sequence for the next UI pass. It returns a discriminated `PublicationResult`:

- `state: 'published'`: confirmed success, with `listingId` and the listing.
- `state: 'unpublished'`: confirmed incomplete publication, preserving `listingId`,
  `retryable: true` and the error. Do not create a second row.
- `state: 'unknown'`: owner reconciliation failed or its response was incomplete;
  preserve ID/form/files. Do not create another row or abandon/delete it.

After two finalize response failures, authenticated owner-side
`GET /api/listings/:id/creation` reconciles the same ID. Already-published state is
success. `continueListingPublication(listingId)` retries finalization/reconciliation
on that exact ID and never calls Create, upload, or abandon.
`reconcileListingPublication(listingId)` can check state without finalizing.
No caller-owned form/file state is mutated. The existing UI is deliberately not
wired to these contracts yet; that belongs to the next Listings UI pass.

An upload failure first reconciles state. If published, return success; if unknown,
return unknown without cleanup. Only confirmed unpublished state authorizes the
helper's best-effort `POST /api/listings/:id/abandon`, followed by the upload error.
The endpoint's atomic `published_at IS NULL` DELETE predicate independently refuses
to delete an already-published listing.

For individual image removal and failed-upload cleanup, remove image metadata
first. Its trigger locks/checks the parent. Only a successful metadata removal is
followed by `client.storage.from('listing-images').remove(...)`. Never issue SQL
mutations of `storage.objects` from application code. Abandon/full-listing deletion
cascades metadata before Storage API removal. Storage cleanup failure may leave an
orphan object, but not an attached published image. If metadata cleanup fails, no
Storage deletion is attempted. No draft UI or automatic janitor is added.

Public list/search reads default to published available listings. Public detail
may read published sold listings; it never returns unpublished rows, even to the
owner. A private owner-authenticated creation read supports uploads and reconciliation. My Listings
returns only published available/sold rows. Trends counts published available rows.

Published photo mutations are rejected by the image API and the
`public.listing_images` trigger, which locks the parent listing and serializes with
finalization. Metadata deletion first makes the required set incomplete, so
finalization fails. Finalization first publishes the row, so metadata deletion
fails and the object stays referenced.

Storage INSERT requires a verified Western owner, a matching not-ready reservation
and an unpublished available parent. Storage DELETE requires the owner's eligible
bucket/path and NO remaining image metadata reference. There is no UPDATE/upsert
policy and no custom trigger/function installed on `storage.objects`.
Unpublished metadata can be removed/re-reserved/retried within the manifest.
Published individual photos cannot be added, deleted, replaced or reordered.

Storage and Postgres are not a single transaction. The existing public image
bucket remains public: a known raw URL is not a confidentiality boundary for an
unfinished upload. Listing visibility remains gated by publication. The local
tests simulate Storage metadata, not the hosted Storage service's byte operations.

Published available Edit permits title, integer-cent price, description, optional
condition, and pickup area. Sold Edit is rejected by API and trigger. Taxonomy
immutability is unchanged. No payments or new status values are introduced.

## Favorites contract

`public.listing_favorites` has exactly:

```sql
user_id uuid not null references auth.users(id) on delete cascade,
listing_id uuid not null references public.listings(id) on delete cascade,
created_at timestamptz not null default now(),
primary key (user_id, listing_id)
```

RLS permits authenticated users to read/delete only their own relationships.
INSERT additionally requires a verified Western user and another seller's
published available listing. A parent-locking trigger verifies eligibility against
concurrent sold/deletion transitions. There is no UPDATE grant or public SELECT.

- `GET /api/favorites`: own published available favorite listings.
- `GET /api/favorites/:id`: own relationship's `{ favorited }` state, including
  retained relationships for sold listings.
- `POST /api/favorites/:id`: add; duplicate is idempotent at API, unique in DB.
- `DELETE /api/favorites/:id`: remove; repeated removal is safe.

The API uses the existing authenticated cookie client and same-origin write guard.
It derives user identity from Auth, never from a request body. Read filters:
`category`, `subcategory` (with parent), `condition`, `place` / `pickupArea` (Place), optional
search/price bounds, pagination. Sort accepts existing Market `newest`, `price-asc`,
`price-desc` and domain aliases `price-low`, `price-high`. An inner Favorites join
keeps sorting, filtering, and pagination on the favorite subset. Sold relationships
remain private but disappear from the purchasable subset; listing/user deletion
cascades them.

## Local verification

Use the already-installed external PGlite module, without installing packages:

```powershell
$env:PGLITE_MODULE = "$env:TEMP/pwa-phase4-db-tests/node_modules/@electric-sql/pglite"
node tests/marketplace-foundations-db.cjs
node tests/marketplace-foundations-api.cjs
node tests/marketplace-taxonomy-db.cjs
node tests/marketplace-taxonomy.cjs
node tests/profile-polish-api.cjs
node tests/marketplace-domain.cjs
node tests/marketplace-home.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

DB tests run the real four-migration chain in memory and discard the database.
API/domain tests mock only provider boundaries and execute the actual repository,
handlers, query builder, and publication orchestration. They cover private reads,
filters/sorts, partial failures, immutable photos/taxonomy, sold editing, cascades,
metadata-first cleanup, no Storage trigger/overwrite policy, and same-ID reconciliation/retry behavior. Hosted Storage and concurrent multi-session
locking are not live-tested in this pass.

Next UI pass: reuse the accepted card Cancel button component/style for Profile
Overview actions. No Profile visual changes are included here.

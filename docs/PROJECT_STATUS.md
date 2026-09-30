# Campus Marketplace — Project Status

## Purpose

A mobile-first student marketplace initially intended for the Western University
community. The product is Campus Marketplace; the current V1 focus is second-hand listings.

Future possible modules, not part of the current implementation:

- Carpool
- Find Classmates
- Housing

Currency is CAD. Prices are stored as integer cents and displayed as `CA$30`,
`CA$12.50`, or `FREE`.

Marketplace categories:

| Label            | ListingCategory value |
| ---------------- | --------------------- |
| Furniture        | `furniture`           |
| Electronics      | `electronics`         |
| Books            | `books`               |
| Clothing         | `clothing`            |
| Home & Kitchen   | `home-kitchen`        |
| Free             | `free`                |
| Sports & Hobbies | `sports-hobbies`      |
| Other            | `other`               |

## Architecture

The application remains **one Next.js repository**:

- Next.js Pages Router
- TypeScript
- Tailwind
- Existing responsive/PWA foundation
- Supabase PostgreSQL as the marketplace source of truth
- Supabase Auth, Storage, and Row Level Security (RLS)
- Algolia retained for the original retail/search implementation

We are **not using Spring Boot**. Algolia has not been connected or synchronized
to the new marketplace listings. Do not remove it until that decision is made
deliberately.

Marketplace UI uses the canonical `Listing` model and `lib/listings-api.ts`.
Browser requests go through Next.js API routes; SSR calls pass a request/response
context to a request-scoped Supabase client. The database mapping layer keeps SQL
row shapes out of presentation components. Auth tokens use HTTP-only cookies.
Marketplace/auth API and page-data requests are excluded from PWA runtime caches.

Useful entry points:

- [Domain types](../types/listing.ts)
- [Listing API boundary](../lib/listings-api.ts)
- [Supabase repository](../lib/server/supabase-listings-repository.ts)
- [Session client](../lib/supabase/server.ts)
- [Auth checks](../lib/server/marketplace-auth.ts)
- [Supabase setup and acceptance checklist](supabase-setup.md)
- [Phase 4 implementation and validation report](phase4-report.md)

## Completed Development

### Phase 1 — Marketplace Domain Foundation

Completed. Includes:

- Canonical `Listing`, `ListingCategory`, `ListingCondition`, and `ListingQuery`
- CAD cent-based pricing and reusable price formatting
- `listings-api` boundary
- Isolated student marketplace fixtures
- `ListingCard` and `ListingGrid`

### Phase 2 — Marketplace Browsing

Completed. Routes:

- `/listings`
- `/listings/[id]`

Includes marketplace search, category/condition/price filters, newest/price
sorting, responsive grid, listing details, and not-found handling. Default browse
results show available listings. Contact Seller remains an unavailable placeholder;
messaging has not been implemented.

### Phase 3 — Listing Management

Completed. Routes:

- `/listings/new`
- `/listings/[id]/edit`
- `/profile/listings`

Includes create, edit, delete with confirmation, mark as sold, My Listings, and
validation. Temporary development persistence was implemented for this phase and
has since been retired from the active data path.

### Phase 4 — Supabase Backend

**COMPLETED AND LIVE-VERIFIED LOCALLY AGAINST CLOUD SUPABASE**

Manual verification was reported by the project owner on 2026-09-30. This
finalization pass does not claim to have repeated those cloud tests.

Includes:

- Supabase PostgreSQL, Auth, and Storage integration
- HTTP-only application session; email OTP sign-in and sign-out
- `@uwo.ca` account restriction and confirmed-email checks
- Profiles linked to real auth users; public listings do not expose email
- RLS ownership protection, backed by restricted database column grants
- Persistent marketplace repository behind the existing API boundary
- Up to 6 listing images; JPEG/PNG/WebP; maximum 3 MB (3 MiB / 3,145,728 bytes) each
- Server-side image size/type/signature checks and owner-controlled Storage paths
- Security, domain, and session tests

Use **"Western email verified"**, not "Verified Western student". Email ownership
does not prove current student status.

**Phase 5 has not started.**

## Supabase Cloud Setup and Live Verification

The owner reports the following configuration and manual cloud checks completed
on 2026-09-30, using the local Next.js app against the real Supabase project:

- Project created in Canada; environment variables configured locally
- SQL migration executed
- Before User Created hook enabled: `public.before_western_user_created`
- `@uwo.ca` restriction active; Site URL configured for localhost
- Email signup and confirmation enabled; anonymous and phone sign-in disabled
- Real `@uwo.ca` OTP delivery, OTP verification, and login passed
- Auth user and profile row creation passed
- Listing creation, image upload, My Listings, edit, mark as sold, and delete passed
- Data persists after restarting the Next.js development server
- Supabase tables and Storage contain the expected data
- Ownership/security behavior tested successfully

This supersedes the earlier pending-cloud-verification and local-configuration
snapshots. Keep real configuration in ignored `.env.local`; never commit real
credentials. No service-role key is required. The pre-existing modification to
`.env.sample` was not changed by this finalization pass; review it before committing.

## Phase 4 Finalization

Removed the unused memory repository, shared development seller, development
notice, and obsolete development-persistence documentation after checking imports.
The active Supabase data path has no memory fallback.

The Photos field shows **JPEG, PNG, or WebP · max 6 images · 3 MB each**, inline
validation errors with filenames and size/type explanations, and valid selected
file counts/names. Backend validation, upload ordering, and Storage behavior are
unchanged. The final frontend polish has local compile/lint checks; the owner's
manual verification above predates this finalization pass.

## Auth and Email Delivery

Current login: **@uwo.ca email → OTP → session**. Public browsing does not require
login. Writes require authentication and database-enforced ownership. Use
**Western email verified**; email ownership does not prove current student status.

Development SMTP currently uses **Gmail SMTP**. Real Western mailbox OTP delivery
and sign-in passed according to the owner's manual verification. The earlier
default-SMTP/template blocker is resolved for local development. Keep the
**Magic link or OTP** template configured to include `{{ .Token }}`.

**TODO BEFORE PUBLIC LAUNCH:**
Replace Gmail SMTP with a transactional email provider using an owned domain, such as Resend, Postmark, SES, or Brevo. Verify deliverability to @uwo.ca accounts before launch.

Do not remove this TODO until production SMTP has actually been configured and
tested. See [setup instructions](supabase-setup.md) for configuration and repeatable
acceptance checks.

## Supabase Database

Migration: [`supabase/migrations/202609290001_marketplace.sql`](../supabase/migrations/202609290001_marketplace.sql).

Important tables:

- `profiles`: auth user UUID, display name, creation/update timestamps
- `listings`: seller, marketplace fields, integer CAD cents, status, timestamps
- `listing_images`: owner/listing references, six numbered slots, object path,
  upload/publication state

Storage bucket: `listing-images`.

The migration enables RLS. Ownership must remain enforced at the database level;
do not replace RLS with frontend-only checks. Public browsing is allowed, while
listing management requires a confirmed Western email and ownership.

The source of truth is PostgreSQL, not fixtures or server memory. Fixtures remain
isolated and are not assigned to invented real users. Database and Storage writes
are not one transaction: failed or interrupted image operations may leave pending
slots/orphan objects. Follow the cleanup procedure in [supabase-setup.md](supabase-setup.md).

## Known Limitations / Issues

### Production build

Phase 4 finalization validation results (2026-09-30):

- TypeScript: passed
- Scoped ESLint: passed
- `npm run build -- --no-lint`: passed
- Normal `npm run build`: blocked by pre-existing CRLF/Prettier errors inherited
  from the original repository

Do not make a broad repository-wide formatting change merely to clear the build
without deliberate review. The Supabase SDK versions currently require Node.js 22+;
finalization validation uses Node 24.

Local tests cover PostgreSQL/RLS rules, domain/price/image validation, and session
cookie behavior. The SQL tests use stand-ins for Supabase-owned schemas, and the
session tests mock the Auth transport. Neither replaces live cloud verification.
Test commands and coverage are documented in [supabase-setup.md](supabase-setup.md)
and [phase4-report.md](phase4-report.md).

### Old retail application

The original implementation intentionally remains:

- `/`
- `/catalog`
- `/product/[objectID]`
- Original fashion data and Product components
- Algolia implementation
- Spencer & Williams branding
- WOMEN / MEN / ACCESSORIES navigation
- Old homepage and global header/footer

This is intentional until Phase 5 is explicitly authorized.

### Development code retained

[Listing fixtures](../lib/fixtures/listings.ts) remain as isolated canonical Listing
sample data from Phase 1, useful for future tests/previews. After removing the
memory adapter they have **no runtime or test imports**; they are not currently
needed by tests and are not seeded into Supabase or mixed into Algolia. Keeping
sample domain data does not retain development persistence or a fake auth identity.

## Phase 5 Plan — Not Started

Planned milestone: **Marketplace takeover**. Make the student marketplace the real
application shell:

- Make `/` the marketplace home
- Remove old fashion branding from active UI and replace old navigation
- Make the marketplace the primary experience while preserving Supabase functionality
- Decide which old retail/Algolia code can safely be removed
- Keep visual redesign controlled and incremental

Do not implement Phase 5 without explicit instruction. No Phase 5 work was performed
in this finalization pass.

## Git

- Primary repository: `linsen25/campus-marketplace`
- Primary/current branch: `main`
- `origin`: `https://github.com/linsen25/campus-marketplace.git`
- `upstream`: `https://github.com/nkada/pwa.git` (original PWA template repository)
- Current local foundation checkpoint: `129af34` — `Build campus marketplace foundation`

The foundation checkpoint contains Phases 1–4 code. Remote URLs, branch, and local
HEAD were inspected for this document; remote synchronization was not checked.
At the start of this documentation task, `git status --short` showed an existing
modification to `.env.sample`. Preserve unrelated working-tree changes and inspect
the current status again before making changes or committing.

## Product Decisions

Do not add these to V1 unless explicitly requested:

- Payments, checkout, or shopping cart
- Currency exchange
- Ratings/reviews
- Complex messaging
- Carpool
- Find Classmates
- Housing

Keep the marketplace simple. Primary V1 journey:

**Browse → View Listing → Sign In → Post → Edit → Mark Sold / Delete**

## Branding / UI

Visual redesign has deliberately been postponed. Do not yet make broad changes to
colors, fonts, branding, animations, or global layout.

Future direction: clean, mobile-first, professional, student-oriented, and grounded
in the Western community. Branding must not imply official Western University
endorsement or pretend this is an official university product.

## Rule for Future Codex Sessions

Before making substantial changes:

1. Read this file.
2. Run `git status` and preserve unrelated working-tree changes.
3. Inspect the existing implementation and relevant files.
4. Do not assume chat history or an earlier progress snapshot is current.
5. Update this document after a significant phase, architecture change, or verified
   cloud milestone. Distinguish owner-reported setup from independently tested behavior.
6. Do not continue into a new phase unless explicitly instructed.

Last updated: 2026-09-30

Current phase: Phase 4 complete

Next milestone: Phase 5 Marketplace takeover

# Phase 4 implementation and validation report

Repository implementation and local validation are complete. On 2026-09-30 the
owner reported successful live verification locally against cloud Supabase: real
Western OTP/login, user/profile creation, CRUD, images, My Listings, restart
persistence, expected stored data, and ownership/security behavior. Development
SMTP uses Gmail. See [Project Status](PROJECT_STATUS.md) for the authoritative status
and production SMTP TODO. Validation sections below also retain historical evidence.
No Phase 5 work was performed. The retail homepage, catalog, Product routes, Algolia,
and global visual identity were preserved.

## 1. Files created

- `lib/supabase/server.ts` — request-scoped cookie client.
- `lib/supabase/listing-mapper.ts` — database-to-Listing adapter.
- `lib/server/supabase-listings-repository.ts` — persistent listing operations.
- `lib/server/marketplace-auth.ts` — verified identity and same-origin checks.
- `lib/marketplace-auth.ts` — email and return-path validation.
- `lib/listing-images.ts` — image limits and signature validation.
- `pages/api/auth/[action].ts` — email code, verification, session, sign-out.
- `pages/api/listing-images/[id].ts` — bounded image upload/removal.
- `pages/auth/sign-in.tsx` — minimal email-code sign-in UI.
- `components/listings/marketplace-actions.tsx` — local marketplace actions.
- `supabase/migrations/202609290001_marketplace.sql` — schema, grants, RLS, bucket, triggers.
- `tests/marketplace-security.cjs` — PostgreSQL privilege/RLS regression tests.
- `tests/marketplace-domain.cjs` — domain, email, price, image, mapping tests.
- `tests/marketplace-session.cjs` — SDK/cookie tests with mocked Auth transport.
- `tests/.eslintrc.json` — Node JavaScript test lint configuration.
- `docs/supabase-setup.md` — dashboard instructions and acceptance checklist.
- `docs/phase4-report.md` — this report.

## 2. Files modified

- `package.json`, `package-lock.json` — Supabase dependencies, preserving earlier lockfile work.
- `.env.sample` — public Supabase configuration placeholders.
- `next.config.js` — configured Supabase image hostname; NetworkOnly marketplace/auth
  cache rules; CommonJS-specific lint configuration. Existing retail caches remain.
- `lib/listings-api.ts` — browser HTTP / request-scoped SSR boundary and image operations.
- `lib/listing-validation.ts` — remove Cloudinary-only URL validation; image attachment
  is now controlled by the upload boundary.
- `pages/api/listings/[[...segments]].ts` — authenticated request context, CSRF checks,
  bounded JSON body.
- `components/listings/listing-form.tsx` — upload selection, validation, removal,
  partial-failure retry without duplicate listing creation.
- `pages/listings/index.tsx` — local auth actions and explicit setup/error state.
- `pages/listings/[id].tsx` — persistent SSR lookup with request context.
- `pages/listings/new.tsx`, `pages/listings/[id]/edit.tsx`, `pages/profile/listings.tsx`
  — authenticated SSR access and removal of development notices.
- `lib/server/development-listings-repository.ts`, `lib/server/development-seller.ts`,
  `components/listings/development-notice.tsx` — removed during finalization after import checks.
- `docs/marketplace-development-persistence.md` — removed obsolete adapter documentation.

## 3. Dependencies added

- `@supabase/supabase-js` **2.117.2**
- `@supabase/ssr` **0.12.7**

Node.js 22+ is required by these SDK versions; local validation used Node 24.
PGlite was installed in a temporary directory only for SQL tests, not added to app dependencies.

## 4. Supabase architecture

Pages Router SSR and API routes use per-request Supabase clients with public keys
and the user's cookie session. Browsers call the application's API boundary.
There is no service-role client, shared authenticated client, or UI table query.
PostgreSQL is the source of truth; Algolia synchronization is not implemented.

## 5. Database schema

`profiles` has auth UUID, display name, and timestamps. `listings` maps marketplace
fields to snake_case columns, storing safe integer cents and CAD. Its constraints
enforce the canonical categories, conditions, statuses, and text lengths.
`listing_images` reserves six uniquely numbered slots with generated owner/listing
paths and a ready flag. The canonical Listing/SellerSummary types remain unchanged.

## 6. RLS and security

Anonymous reads are allowed. Confirmed Western users can insert their own listings
and update/delete only their own rows. Column grants prevent spoofed seller IDs,
IDs, timestamps, and image paths. RLS checks Auth-table identity, not user metadata.
Images require owner-controlled reservations; another user's writes and deletes
are denied. Cookies are HTTP-only/SameSite and Secure in production except loopback
development. API writes require a custom header and reject foreign origins.
Marketplace/private API and Next page-data responses are excluded from PWA caches.

## 7. Authentication flow

Sign In sends an email code; verification creates a cookie session. A new profile
is created automatically, using the optional display name. Sessions refresh through
server requests. Post Listing/My Listings/edit redirect anonymous visitors to Sign In.
Sign Out clears the local session and reloads the page to clear router state.
The product says "Western email verified", never claims verified student status.

## 8. Western email restriction

Exact `@uwo.ca` matching runs in UI/server validation. A Before User Created hook
and an Auth email trigger reject other domains and subsequent email changes outside
the domain. Database write policies additionally require a confirmed current email.
Subdomains and lookalike suffixes such as `@uwo.ca.example.com` are rejected.

## 9. Image uploads

Six images maximum; JPEG/PNG/WebP; 3 MiB each. The server checks byte length, declared
MIME type, file signature, verified session, and listing ownership. The Storage
bucket enforces MIME/size limits, and database slots enforce the count under races.
No cloud URL input or upload provider other than Supabase remains in active forms.
Deletion attempts object cleanup; orphan/interrupted-upload limitations and manual
cleanup are documented because Storage and PostgreSQL are not one transaction.

## 10. Listing API

All seven existing functions now use the Supabase repository. Browser calls retain
their existing signatures; SSR calls supply the request/response context. Search,
category/condition/price/status filters, newest/price sorting, pagination, sold
behavior, and lookup semantics remain. `uploadListingImage` and `removeListingImage`
were added to the same boundary.

## 11. Temporary code retirement

The unused memory repository, development seller, notice, and obsolete persistence
documentation were removed after the owner confirmed live acceptance. Import checks
found no active consumers. There is no memory fallback. Fixtures remain isolated
as sample domain data for future tests/previews; no current runtime or test imports
remain, and they are not seeded into invented real user accounts.

## 12. Environment variables

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon or
publishable key). No server-only secret is required. No credentials were written.

## 13. Manual setup

Follow [supabase-setup.md](supabase-setup.md): create a dedicated project, add the
two environment variables, run the migration once, configure Email/Auth hook,
custom SMTP and OTP templates, set the site URL, verify bucket limits, restart
Next.js, and perform the two-account acceptance checklist. OTP code entry needs
no callback route or wildcard redirect list.

## 14. TypeScript

`npx --no-install tsc --noEmit --incremental false` — **passed**.

## 15. ESLint and tests

Scoped ESLint on Phase 4 TypeScript/TSX/config and new JavaScript tests — **passed**.
The CommonJS Next configuration and Node test scripts have appropriate scoped rules;
legacy files were not broadly reformatted.

- PostgreSQL/PGlite: migration, constraints, anonymous/unverified denial, cross-user
  denial, spoofing denial, owner CRUD/sold, My Listings scoping, image slots/RLS,
  cleanup ownership, and profile privacy — **passed**.
- Domain tests: email boundaries, safe redirects, CAD cents/display, image signatures
  and limits, database mapping and ready-image ordering — **passed**.
- SDK contract with mocked Auth transport: code/session handling, cookie flags,
  refresh rotation, sign-out removal, domain and CSRF checks — **passed**.
- Production HTTP with no Supabase configuration: write endpoints fail closed with
  explicit 503 setup errors, protected pages redirect, CSRF/method rejection,
  sign-in page and original homepage — **passed**.

## 16. Build

`npm run build` is blocked by the known legacy CRLF/Prettier errors.
`npm run build -- --no-lint` — **passed**, including PWA compilation and all routes.
Only the PWA rule needed for new authenticated marketplace data was added.

## 17. Historical verification limits (superseded by owner live verification)

At the initial implementation pass, no Supabase credentials or configured test
mailboxes were available. The following describes that historical state, not the
current acceptance status. Actual email
delivery, live hosted Auth sessions, hosted PostgREST CRUD/404s, Storage upload and
cleanup, deployed RLS configuration, and persistence across a real server restart
remain on the manual acceptance checklist. Local SQL tests use stand-ins for the
Supabase-owned Auth/Storage schemas; they do not replace hosted verification.

Automatic approval review rejected starting the production server with temporary
Supabase test environment values, returning only "blocked by policy". That command
was not retried through another mechanism. The production HTTP checks instead used
the existing unconfigured environment and verified safe rejection/setup handling.

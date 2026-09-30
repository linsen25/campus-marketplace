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

**Phase 5 Marketplace takeover is implemented. See the Phase 5 section for validation and remaining manual checks.**

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
credentials. No service-role key is required. Environment files were not changed in Phase 5.

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

### Legacy cleanup - completed safe removal pass

Removed 70 audited files, including `/catalog` (all catch-all paths) and
`/product/[objectID]`. They now return 404; no redirects or replacement features
were added. The exact deletion inventory and retention rationale are in
[legacy-cleanup.md](legacy-cleanup.md).

Removed old header/footer/navigation/logo, retail product cards/details, fashion
size/color/rating/discount UI, homepage showcases, retail InstantSearch widgets,
refinement panels, retail AutocompleteBasic/popular-search adapter, search layout,
results utility, and three exclusive retail stylesheets. Shared ProductImage remains.

The current working-tree marketplace search, right drawer, chips, cards, layout,
header/footer, PWA, domain and Supabase/auth/Storage/CRUD code were not edited in this
cleanup. Existing uncommitted work was treated as the baseline and preserved.

Algolia status:

- Marketplace listing results come through getListings/Supabase, not an Algolia index.
- Active marketplace search reuses Algolia Autocomplete UI/theme and original
  animation/search-button plugins. These remain required.
- AppLayout still initializes the Algolia client and search-insights, and utils/env
  still requires the InstantSearch variables. This retained shared setup means
  Algolia packages and environment placeholders are not yet safe to remove wholesale.
- CLI/config/dev tooling, some retained hooks/types, and global CSS still reference
  retail infrastructure/packages. They are explicitly deferred rather than severed
  speculatively. No dependencies, environment variables, or config were removed.
- No image/icon assets were deleted. Shared artwork and assets reachable through
  dynamic/CLI configuration remain pending a dedicated asset audit. Current manifest
  and document metadata already use Campus Marketplace; no icon redesign was needed.

Validation: TypeScript, domain, homepage, session and SQL/RLS security tests passed.
Production build with --no-lint passed. Ordinary scoped ESLint hits pre-existing
CRLF/Prettier errors; the same scope passes with endOfLine:auto accepted in the lint
invocation only. No lint config or source formatting was changed to suppress them.
Test-file ESLint passed. Production Edge checks at 390px/1536px passed animated
search, same-page queries, right drawer, Apply, all filter fields, chips/Clear,
sorting, refresh/Back/Forward, shared URLs, Escape and no overflow. Retired routes
returned 404. Cloud data was empty; no authenticated writes were performed. Code
inspection confirms listing detail/create/edit/sold/delete/My Listings, auth next
redirects and image uploads retain their original implementation/imports.

### Development code retained

[Listing fixtures](../lib/fixtures/listings.ts) remain as isolated canonical Listing
sample data from Phase 1, useful for future tests/previews. After removing the
memory adapter they have **no runtime or test imports**; they are not currently
needed by tests and are not seeded into Supabase or mixed into Algolia. Keeping
sample domain data does not retain development persistence or a fake auth identity.

## Phase 5 Marketplace Takeover - Completed

Implemented on 2026-09-30:

- `/` is the public marketplace homepage, with brand, search, all eight canonical
  category shortcuts, latest available listings, and Sell an item actions.
- The homepage calls `getListings({ status: 'available', sort: 'newest', page: 1, pageSize: 10 })` with the SSR request context and renders the existing ListingGrid.
  Empty and service-error states are explicit; no retail fallback or fixture seeding.
- Search and category links use the existing `/listings` query/filter model.
- A shared responsive header/footer replaces the retail promotion, logo, menus,
  and retail footer on all routes. It uses visible wrapping links, without hover
  menus, and states that the marketplace is independent of Western University.
- The existing MarketplaceActions/session endpoint is reused once in the global
  header and refreshed on navigation. Logged-out visitors see Browse, Sell, Sign In;
  signed-in visitors also see My Listings and Sign Out. Sell keeps the protected
  route's existing `next=/listings/new` flow. Sign-out returns to the new home.
- Existing listing/auth routes retain their behavior with updated page titles and
  duplicate page-local navigation removed. No database/auth/Storage/CRUD changes.
- Root HTML and root Next page-data use NetworkOnly PWA routing. Automatic start-URL
  caching is disabled so it cannot override this rule. Other PWA caching remains.

Validation:

- TypeScript and scoped ESLint passed.
- Existing domain, mocked-session, and PostgreSQL/PGlite security tests passed.
- New `node tests/marketplace-home.cjs` passed: available/newest query, no-store,
  category/search links, and populated/empty/error rendering with a mocked data boundary.
- Production build with `--no-lint` passed; standard-build legacy CRLF lint limitation
  remains. No broad legacy formatting cleanup was performed.
- Production HTTP smoke checks passed against the local configured app: anonymous
  homepage, eight category links, no retail shell, no-store response, filtered browse,
  anonymous session, sign-in page, and Sell/My Listings authentication redirects.
- No browser was available for visual mobile/tablet/desktop checks or a signed-in
  click-through. Repeat that manual UI check before release; prior Phase 4 live
  verification remains the evidence for cloud OTP, writes, images, and ownership.

Next recommended step: manual responsive and signed-in navigation acceptance, then
an explicitly scoped legacy-route/dependency cleanup and incremental design pass.
No full visual redesign or additional product modules were implemented.

## Browse UX Refinement - Historical first pass

Superseded by the search/drawer correction below; the bottom sheet and category
shortcut grid described here are no longer the active experience.

The listing grid remains the main browse content. Search and sorting stay visible;
a Filter button opens a native modal bottom sheet on mobile and a compact right
sidebar on desktop (1024px+). Native dialog behavior provides focus containment,
Escape dismissal, and focus restoration; background scrolling is locked while open.

- Homepage categories now link to label-based URLs such as
  `/listings?category=Electronics`, without opening the filter panel.
- The existing filter parser accepts category labels case-insensitively as well as
  old canonical category IDs. Domain queries still use canonical ListingCategory values.
- Category, Condition, minimum/maximum CAD price, and Status are in the panel.
  Available is the default; Sold and All statuses use the existing ListingQuery.
- Apply validates through the shared parser and updates the same listing route via
  Next.js navigation. No separate category/filter pages or backend changes.
- Search, sort, and chips preserve other active filters in shareable query URLs.
  Refresh and browser Back restore the selected view. Chips can remove individual
  filters; Clear filters returns to default browse. Reset filters resets panel
  drafts, keeping search/sort, and takes effect when Apply is clicked.
- Invalid ranges display an inline error in the panel. Results accurately label
  Available/Sold/All views. Closed panels do not occupy layout space.

Validation: TypeScript and scoped ESLint passed; existing domain/home/session tests
passed, including added category aliases, status, CAD bounds, invalid ranges, and
URL serialization roundtrip cases. Production build with `--no-lint` passed.
Headless local Edge checks at 390px and 1280px passed for category landing, panel
geometry, Apply, URL persistence/reload/Back, search, sorting, chip removal,
validation, Reset/Clear, Escape/focus restoration, and no horizontal overflow.
Screenshots were inspected for mobile browse and the bottom sheet. The configured
cloud project returned no listings during this check, so browser results covered
the empty state; query conversion and populated rendering have separate automated
coverage. No listings or cloud settings were mutated during validation.

## App Shell / My Account - Completed

Current navigation supersedes the earlier global Sell/My Listings/Sign Out links.
Below 1024px, exactly two fixed bottom tabs link to Market (/) and My Account
(/account). Icons/labels, aria-current, a visible active border/background, and
64px minimum tab height provide clear keyboard/touch access. The bar includes
safe-area padding; the content wrapper reserves 72px plus the same safe-area inset.
At desktop widths the bottom bar is hidden and the top header provides Market and
an accessible account icon. The mobile header contains only the marketplace brand.

/account is public. The existing MarketplaceActions session request and sign-out
implementation now live exclusively on this page; no second auth store was added.
Logged-out users see Sign In; logged-in users see their display name and Western
email verified. Both can find Sell (/listings/new) and My Listings
(/profile/listings), retaining existing protected-route next redirects.
Selling, Buying, and Account sections organize the links. Sign Out lives here.

Reserved, data-free Coming soon routes:

- /account/favorites
- /account/messages
- /account/profile
- /account/settings

Only these four names are accepted; unknown account sections return 404. Sign-in
return-path validation now permits the account landing page and these exact paths.
Account HTML and Next page-data are excluded from PWA runtime caching; session
requests continue to use the existing no-store/auth flow. No schema, RLS, Storage,
CRUD, or identity validation changes were made.

Future account functionality (documentation only): Payments > Payment methods /
Payout account. No bank/card controls or payments implementation are shown.
Intended messaging flow: Market listing -> Message seller -> conversation ->
My Account > Messages. The messages route is only a placeholder; no chat backend
or favorites persistence was added.

Filter close animation: one shared exit handler is used by X, Apply, backdrop and
Escape. The modal stays open/mounted until slide-out completes, while the backdrop
fades out; body scroll lock and focus containment last through the animation.
Repeated close requests share the same pending exit. Reduced motion closes without
animation. Filter content, search, chips, sorting, results and query logic remain
unchanged. No broad visual redesign was performed.

Validation: TypeScript, scoped ESLint, domain/home/session/SQL-security tests passed,
including new account return-path allowlist/rejection cases. Headless Edge at 390px
and 1536px passed two-tab visibility/active states, desktop navigation, account and
all placeholders, logged-out Sell/My Listings redirects, four animated close paths,
reduced motion, and no overflow. Signed-in display/sign-out were checked with mocked
session endpoints, not a real mailbox. Existing animated search/filter regression
checks passed at both widths. Production account routes returned 200 and unknown sections returned 404. Browser
mock-session checks block service workers so Playwright can intercept the auth
requests; generated PWA account exclusions were inspected separately.
Mobile screenshot inspected; actual device safe-area
insets and real signed-in cloud writes were not re-tested. Production build with
--no-lint passed; existing standard-build legacy lint limitation remains.

## Responsive Layout / Account Navigation - Completed

This pass supersedes the original account link-list presentation, while retaining
the accepted search/filter behavior and backend architecture.

- The bottom navigation retains exactly Market and My Account. One persistent
  indicator spans half the bar and translates between tab centers; a centered 40px
  line slides with a 260ms transform transition. It is not keyed/remounted per tab.
  Icon/label active styling, equal tab widths, aria-current and safe-area padding
  remain. Reduced motion disables the indicator transition.
- Account destinations are full-width rows with 48px minimum touch height and right
  chevrons. Sell is a full-width primary action. The existing session request and
  sign-out logic are reused by one MarketplaceActions instance.
- AccountLayout persists across /account, its four reserved subroutes and
  /profile/listings. Below 1024px, subpages slide from the right over the parent;
  AnimatePresence keeps outgoing content mounted while it slides back to the right.
  The underlying account navigation is inert while covered. Parent navigation uses
  browser Back when entered from the account landing page; direct visits have a
  safe link to /account. Reduced motion makes transitions immediate.
- At 1024px and above the same account navigation forms a persistent 260px sidebar,
  with routed content on its right. Desktop has no full-page slide. Refresh, direct
  section URLs, and browser history retain real Next.js routes. No account feature
  implementation was duplicated; placeholders remain Coming soon.
- Listing form Category/Condition use a modal mobile picker below 1024px and native
  compact selects on desktop. Options stay inside an 85dvh scrollable sheet, show
  selection and close on selection; Escape/Close cancel. Arrow/Home/End plus Enter
  and native dialog focus behavior support keyboard use. The underlying select
  retains the original form field names, canonical values, and required validation.
  This does not alter the Filter drawer's controls.
- Market grids stay two columns on mobile. Cards now use explicit square aspect
  ratios and Next Image cover cropping, two-line clamped titles and compact metadata.
  My Listings changes from one to two mobile columns and shares the card component;
  its existing edit/sold/delete handlers are unchanged. More columns remain at
  tablet/desktop widths. Shared ProductImage is unchanged for detail views.
- The descriptive footer is hidden below 1024px. Bottom-navigation clearance remains
  72px plus safe-area inset. Container now centers content within max-w-6xl, keeping
  desktop search/filter/sort/grid relationships within a bounded area. Colors,
  branding, search, chips, Filter drawer and backend behavior were not redesigned.

Validation: TypeScript, scoped ESLint, marketplace domain/home/session and SQL/RLS
security tests passed. Edge checks at 390px, 1280px and 1536px verified full-width
account rows, persistent indicator/sidebar DOM identity, forward/back transitions,
direct section URLs/history, picker dimensions/values and no horizontal overflow.
Additional browser-only mocked page data verified populated two-column Market and
My Listings grids, square cover images, compact title/card measurements, and required
category validation plus arrow/Enter selection. These mocks did not write to Supabase.
Existing search/filter/chips/URL/escape regression checks passed at 390px/1536px.
Screenshots were reviewed. Production build with --no-lint passed; existing standard
build lint limitations remain. Real device safe-area behavior and real cloud writes
were not re-tested. No messaging, favorites, payment or bank/payout functionality
was implemented.

## Market / Mobile Structure Cleanup - Completed

This pass supersedes the previous separate homepage teaser and browse page, and
corrects mobile account containment without changing backend behavior.

- Canonical Market route is `/`. `/listings` is a compatibility alias re-exporting
  the same page and SSR handler. Detail/create/edit routes and incoming links remain
  intact. Both browse URLs retain query parameters, reload and browser history.
- The mobile application brand header is hidden below 1024px with no reserved space.
  Desktop retains its header. Browse/account main content starts with 16px mobile
  padding; fixed bottom navigation and safe-area clearance remain unchanged.
- Removed the homepage introduction, Browse all listings, latest-only heading and
  bottom Have something you no longer need / Sell CTA. The browse hierarchy is now
  search, chips, Sort/Filter, result count and the existing grid. Sell remains in
  Account and existing listing-management routes.
- Both routes use the existing filter parser and getListings boundary. Default
  status is available; explicit Sold/All controls retain their existing behavior.
  The homepage-only 10-item limit is removed. Previous/Next use the existing API's
  20-item page query, making later results reachable with bookmarkable page URLs
  that preserve filters. Search/filter/sort changes start at page one. A full final
  page can offer Next to an empty page because the API has no total-count response;
  Previous remains available. No repository/API/schema changes were made.
- Sort and Filter share one flex group on mobile/desktop; chips wrap above as needed.
  Filter drawer styling/animations and animated search remain unchanged.
- On mobile, My Account's title belongs to account home. While a subroute is active,
  the parent sidebar is hidden and removed from layout flow; destination content
  occupies the main area from the top, without a parent title/menu above it.
  On Back, account home returns while AnimatePresence retains the outgoing page's
  rightward slide. Real routes/history, reduced motion, fixed bottom tabs and the
  desktop persistent sidebar/right pane are preserved. Account/session/CRUD logic
  is unchanged.

Validation: TypeScript, scoped ESLint, marketplace domain/home/session and SQL/RLS
security tests passed. Home tests cover removed CTAs, available query defaults and
pagination/filter forwarding. Edge checks at 390px, 1280px and 1536px verified header
visibility, all five account destinations, hidden parent content, Back/direct/reload
navigation, desktop panes, same-row Sort/Filter and no horizontal overflow. Measured
transforms verified forward/back slides and a reduced-motion browser load. Existing
search/filter regression passed Apply, chips, sort, Clear, refresh, Back/Forward,
compatibility URLs, Escape and animated X/backdrop close. Populated grid/My Listings
and picker regression checks passed. Pagination links were tested with mocked page
data. Screenshots were reviewed. Browser-only account/data mocks made no cloud writes;
real-device safe-area behavior was not re-tested. Production build with --no-lint
passed; existing standard-build legacy lint limitations remain. No additional product
features or backend functionality were implemented.

## Account Default / Mobile Title / Back Controls

- Desktop header account navigation now opens `/profile/listings`. Direct `/account`
  visits at 1024px and above replace the route with My Listings, retaining the
  persistent desktop sidebar. The existing protected-route login flow still applies.
  Mobile `/account` continues to show the account landing menu.
- Mobile Market (`/` and its `/listings` alias) again displays the Campus Marketplace
  page heading. Account screens do not display that brand heading; the shared mobile
  application header remains hidden. Desktop keeps its existing brand header.
- Added a reusable 44px icon-only BackButton with an accessible Back label and visible
  keyboard focus. Replaced textual return links on account subpages, My Listings,
  listing detail/create/edit and sign-in. Existing destinations remain intact;
  account children retain browser Back when entered from their parent and the safe
  parent fallback for direct visits. Desktop account panes keep the back control hidden.
- No backend, authentication, Storage, listing CRUD, card or filter behavior changed.

Validation: TypeScript, scoped ESLint and marketplace home/domain/session tests passed.
Edge checks at 390px/1280px verified the mobile-only Market title, mobile account home,
desktop header entry and direct-account default to My Listings, icon-only Back button,
account return transition, sign-in return destination and no horizontal overflow.
Signed-in display/My Listings used browser mocks; no cloud writes were performed.
Production build with --no-lint passed.

## Git

- Primary repository: `linsen25/campus-marketplace`
- Primary/current branch: `main`
- `origin`: `https://github.com/linsen25/campus-marketplace.git`
- `upstream`: `https://github.com/nkada/pwa.git` (original PWA template repository)
- Current local checkpoint before Phase 5: `d2bf059` - `Finalize Supabase marketplace backend`

Git was clean at the start of Phase 5. Preserve unrelated working-tree changes
and inspect the current status before making changes or committing.

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

Current phase: Account default / mobile title / back controls completed

Next milestone: Real-device safe-area and authenticated account acceptance; future features require explicit scope

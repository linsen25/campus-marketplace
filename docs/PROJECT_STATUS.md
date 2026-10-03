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

The 2026-10-03 auth continuation adds supplied Shift Tabs/Hold/Stateful controls
and username validation/persistence on the existing profiles architecture.
The username migration is prepared and locally tested; live SQL application and
the original Send code HTTP 400 diagnosis remain pending. See [Auth modal](AUTH_MODAL.md).

Current Welcome login: **@uwo.ca email + password → session**, using one shared
modal adapted from the supplied Velora source. Signup and password recovery use
real Supabase email codes. See [Auth modal](AUTH_MODAL.md) for implementation,
required Confirm signup/Reset Password token templates, password settings and
live acceptance still needed. Earlier owner-verified OTP results below apply to
the previous login flow, not the new password/modal flow.
Public browsing does not require
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

## Welcome Hero / Gradient Waves - Completed

- Added the supplied React Bits GradientWaves JSX and separated its CSS. Shader,
  uniforms, pointer handling, visibility observers, animation loop and cleanup are
  unchanged. The only integration edit in the supplied JSX moves its global CSS
  import to pages/_app.tsx, as required by the Next.js Pages Router.
- Existing uncommitted package changes already installed ogl@1.0.11 (^1.0.11).
  They were preserved; no dependency installation/version change was needed.
- GradientWaves is dynamically loaded without SSR for WebGL, with one canvas scoped
  to the hero. It uses all requested colors and numeric/interaction/grain settings
  exactly, with the temporary headline and supporting sentence and no center CTAs.
- Both `/` and the existing `/listings` alias show the same hero above the untouched
  marketplace. Their previous desktop shell header is replaced by the hero navigation;
  other routes keep their header. Hero height uses 100svh with a 100vh fallback and
  subtracts mobile bottom-navigation clearance/safe area. Responsive typography and
  spacing fit a phone; no duplicate mobile application header was added.
- Hero content sits above the WebGL background. Noninteractive text layers let pointer
  events reach the canvas; navigation links remain clickable. Native scrolling and
  existing fixed mobile tabs remain intact. Supplied offscreen/page visibility pause
  and unmount cleanup remain intact.
- Hero navigation reuses the existing no-store session endpoint and auth route:
  guests see Log in, members see My Account (existing mobile menu / desktop default
  My Listings). During session loading no guest link flashes. Sell/My Listings/Sign
  Out are not exposed in the hero. No authentication/backend architecture changed.
- Marketplace search/filter/sort/chips/grid/pagination/query logic and cards below
  the hero are unchanged. No text effects, new page transitions, gate, or other
  feature was introduced.

Validation: TypeScript and scoped ESLint for integration code passed; source comparison
confirmed supplied JSX unchanged except CSS import location. The upstream JSX is
excluded narrowly in .eslintignore to preserve its source and avoid the repository's
TypeScript-only naming rule crashing on JavaScript. It passed a standalone ESLint
JavaScript syntax/no-undef/no-unreachable check. Home/domain/session tests passed.
Edge at 390px, 1280px and 1536px rendered a single WebGL2 canvas without console/WebGL
errors or horizontal overflow; screenshots reviewed. Mouse movement was verified to
update the shader uMouse uniform. Login, mocked signed-in account entry, bottom tabs,
scrolling to Market and canvas cleanup passed. Existing search/filter regression
passed at 390px/1536px, including sort/chips/Clear/URL/reload/history/Escape. Browser
GPU checks used headless Edge software WebGL; physical-device GPU performance and live
OTP were not re-tested. Production build with --no-lint passed.

## Welcome Hero / Infinite Spiral Refinement - Completed

- Added the supplied InfiniteSpiral.jsx and its separated global CSS. Source comparison
  confirms the animation logic is unchanged; only the CSS import moves to _app.tsx
  for Pages Router compatibility. A small .d.ts describes the JSX integration without
  converting the implementation. Like GradientWaves, the supplied JSX is narrowly
  excluded from repository TypeScript style rules and linted separately as JavaScript.
- Desktop Hero now has left-aligned white headline/light-gray supporting copy and a
  right-hand image spiral, with reserved dimensions to avoid loading layout shift.
  The brand is white with no permanent border/box/shadow; keyboard focus remains visible.
  The top-right Log in / My Account link is styled as a high-contrast button. Existing
  session/auth behavior remains unchanged.
- GradientWaves props/shader/cleanup remain unchanged. The previously corrected neutral
  #0b0b0b backdrop remains; no overlay or canvas filter was added.
- Spiral uses the requested slow auto/up settings: speed .25, radius 155, cards 110x110,
  spacing 66, perspective 1000, seven cards/turn, zero rotation/tilt, radius 14,
  centerScale 1.12, edgeFade .35, edgeBlur 5, pauseOnHover, cover, grayscale 0.
- Image data comes from the existing page's Listing[] props: at most 12 photo entries,
  meaningful listing-title/photo alt text, and real listing-detail links. If fewer than
  seven images are available, only existing images repeat to complete the presentation;
  no duplicated records are inserted into marketplace data. No images means no gallery.
  Existing fixtures contain no photos, so no sample or third-party fallback was added.
  Consequently filtered/empty browse results can also leave the Hero without a gallery.
- Below 1024px, the spiral is not mounted. Mobile keeps
  the waves, left-aligned copy, account action and existing bottom tabs within the
  existing opening viewport sizing. No mobile visual replacement was added.
- Supplied hover/offscreen/reduced-motion behavior is preserved. Offscreen auto speed
  settles to zero, although the supplied implementation continues scheduling RAF;
  no claim is made that its RAF loop is suspended. Unmount cancels RAF/listeners/observers.
- Market controls/cards/pagination/query logic, backend and account architecture are
  untouched; the page only passes its existing listing data into WelcomeHero.

Validation: TypeScript, scoped ESLint for integration, separate JavaScript lint for
supplied source, home/domain/session tests passed. Edge 390/1280/1536 checked white
borderless brand, left-aligned text, right gallery without overlap, loaded listing
images, slow auto movement, hover/offscreen settling, mobile absence of Spiral,
scroll/search and no overflow/page errors. Reduced-motion and signed-in account exit
cleanup passed. Search/filter/chips/sort/URL/reload/history regression passed at
390/1536. Screenshots reviewed; headless software WebGL and mocked session checks do
not replace real-device performance/live OTP acceptance. Production build with --no-lint passed.

## Homepage Scene / Depth Text / Text Type / Tear Ticket

This pass supersedes Infinite Spiral and the earlier static Hero headline/subtitle.
The owner's correction also supersedes the proposed wave-container translateY design:
only the existing GradientWaves height uniform changes with scroll.

- Removed InfiniteSpiral.jsx/.css/.d.ts, its global CSS import and lint exclusion,
  Hero image mapping/repetition and gallery styling. No runtime references remain.
- Added supplied DepthText, TextType and TearTicket JSX/CSS plus small integration
  declaration files. Global CSS imports live in _app.tsx. Supplied JSX receives the
  same narrow style-lint exclusion and separate JS correctness check as GradientWaves.
- DepthText uses two left-aligned near-white lines with restrained 10 layers, .65
  depth, tilt 3, no auto orbit, no shadow. TextType types the original sentence once
  at 30ms/character, loop=false, showCursor=false, with space reserved for completed
  copy. It stays mounted when scrolling so it does not restart or delete the text.
- TearTicket uses simple brand copy only, no marketplace actions/claims. Pointer pull
  and keyboard Enter/Space remain from the supplied implementation. Desktop retains
  a 55/45 composition; mobile stacks the ticket beneath copy with the component's
  responsive fit. Ticket space and headline/subtitle dimensions are reserved to avoid
  loading shifts. Navigation remains plain white brand plus Log in / My Account.
- Installed gsap (required by supplied TextType). TearTicket reuses existing Framer
  Motion 6 instead of adding a second Motion package: import m as motion from
  framer-motion for the app's LazyMotion boundary. One motion template containing
  numeric literals uses an equivalent useTransform expression because Framer Motion
  6 only accepts MotionValues in template slots. Tear physics/geometry are unchanged.
- HomepageScene owns ONE dynamically loaded GradientWaves canvas in a fixed viewport
  behind both sections with neutral #0b0b0b backdrop. It is outside animated section
  wrappers. No canvas/container scroll translation, scaling or color overlay is used.
  GLSL shader and approved colors/other parameters remain unchanged.
- WAVE_SCROLL_DISTANCE = .8 viewport heights (80vh); WAVE_HEIGHT_TOP = 5.5;
  WAVE_HEIGHT_LOWERED = -12. Motion scroll progress clamps to [0,1]. GradientWaves
  accepts the height MotionValue and subscribes only to uHeight updates, unsubscribing
  on cleanup. Scroll does not set React state or recreate the WebGL instance. Beyond
  the threshold height remains -12 while iTime advances; returning to zero restores
  exactly 5.5. The only React viewport state updates occur on mount/resize.
- The sticky Hero scene lasts its opening viewport plus 80vh. Outgoing opacity reaches
  zero at 75% progress, moving up 40px/scaling to .97. Incoming remains invisible until
  78%, then reaches full opacity at 100%, moving from +45px/scaling .98 to 1. No spring
  overshoot, snapping, route transition, or crossfade. Hidden sections are inert and
  aria-hidden. The existing Market content is wrapped in a readable white surface
  with narrow outer gutters, leaving the persistent waves visible around it; its
  search/filter/sort/chips/grid/pagination logic is unchanged.
- A hydration-safe media-query hook keeps initial server/client markup consistent.
  Reduced motion uses static complete headline/subtitle, visible normal-flow sections,
  no scroll section transforms/fading, and stable height 5.5. Ticket uses its supplied
  reduced-motion handling. Wave flow itself remains enabled as requested.

Validation: TypeScript, scoped integration ESLint, separate JSX syntax/no-undef/
no-unreachable lint, home/domain/session tests passed. Edge at 390/1280/1536 verified
one persistent canvas, fixed canvas top=0 at every scroll sample, height interpolation
and clamp/reversal, ongoing shader time, sequential opacity gap, completed subtitle
surviving scroll, no overflow/page errors and keyboard ticket interaction. Screenshots
reviewed; fixed-time background comparison confirmed lowering height lowers the visual
horizon. Actual pointer tear passed at 390/1280. Reduced-motion content, keyboard tear,
hydration and bottom-navigation cleanup passed. Search/filter/sort/chips/clear/URL/
reload/history/Escape regression passed at 390/1536 after scrolling into Market.
Headless software WebGL does not verify physical-device GPU performance; no cloud writes
or live OTP re-verification. Production build with --no-lint passed.

## Welcome Hero / Drift Wall Replacement - Completed

This pass replaces Tear Ticket only; the approved text and scroll behavior remain.

- Removed TearTicket.jsx/.css/.d.ts, CSS import, lint exclusion, Hero ticket copy and
  ticket-only styles. No runtime TearTicket/tear-ticket references remain.
- Added supplied DriftWall.jsx/.css plus a small TypeScript declaration. Its animation,
  transforms, hover behavior, ResizeObserver and RAF cleanup are retained. Global CSS
  is imported through _app.tsx. The only source edits are that import relocation and
  removal of the Picsum demo defaults (items defaults to an empty array).
- Existing page Listing[] data is passed through HomepageScene into WelcomeHero. Up
  to 15 existing photo URLs use listing titles/photo numbers as alt text and real
  listing-detail hrefs. The supplied component opens those links in a new tab and
  repeats its tracks as needed. No new fetch/business logic, fake data or external
  sample URLs are introduced. Existing fixtures contain no images; empty results
  therefore show no wall rather than arbitrary fallback images.
- Desktop uses three columns, 150x110 tiles, 12px gaps, speed 22, variance .25,
  tilt 12, turn -12, depth 80, parallax .3, lift 24, fade .45, dim .85 and hover pause.
  Its transparent wrapper is at most 540px wide and clamp(360px,52vh,520px) high.
  Mobile uses two columns, 120x88 tiles and a 230px-high wrapper below the copy.
  One responsive instance is used; no separate mobile/desktop copies.
- The wall wrapper and overlayColor are transparent. Supplied tile-local surfaces
  and masks remain, with waves visible between/around tiles. Section two's previous
  white backdrop was corrected to transparent. A narrowly scoped foreground contrast
  adjustment keeps its text readable while selects and dialogs retain dark text on
  their existing light surfaces. Card structure and all Market functionality remain.
- Depth Text, Text Type, navigation, fixed bottom tabs and the existing 5.5 -> -12
  horizon interpolation/clamp over 80vh and sequential section fade gap are unchanged.
- Reduced motion uses the supplied static track behavior and disables pointer parallax.
  The supplied source does not implement offscreen suspension; its RAF still runs when
  hidden (also in reduced motion), and cancels on unmount. No false offscreen-pause
  claim is made. Animation frames update refs/styles, not React state.

Validation: TypeScript, scoped integration ESLint, separate supplied-JSX correctness
lint, home/domain/session tests passed. Edge at 390/1280/1536 confirmed one wall and one
canvas, correct right/stacked placement, transparent backgrounds, no overlap/overflow,
no page errors, no Picsum requests, and moving columns. Reduced-motion tracks and
navigation/unmount cleanup passed. Shader-uniform checks confirmed the existing
height interpolation, clamp/reversal, fixed canvas and continued shader time. The
outgoing/incoming opacity gap and completed subtitle were preserved. Existing Market
search/filter/sort/chips/Clear/URL/reload/history/Escape checks passed at 390/1536.
Screenshots reviewed. Tests used headless software WebGL; no cloud writes or physical
GPU acceptance was performed. Production build with --no-lint passed.

## Runtime Recovery / Landing Navigation ? 2026-10-01

Part A inspected `lib/listings-api.ts`, the dynamically imported Supabase
repository, My Listings SSR, auth/cookie helpers and their dependency graph.
The repository exists at the expected path; no missing/moved dependency or
circular import was found. No repository, auth, schema, storage or CRUD code
was changed and no fallback or error suppression was introduced.

No app Node process was running at inspection. The old `.next` contained dev
artifacts but no compiled My Listings page, so the original failing state could
not be replayed. Automatic approval rejected recursive deletion of `.next`;
instead the old directory was moved out of the project to
`%TEMP%/pwa-next-before-runtime-check-20261001` and Next generated fresh output.
Clean dev requests returned 200 for public Supabase listings (2 real rows) and
homepage SSR, and the expected 307 sign-in redirect for anonymous My Listings.
A separate process executed the actual webpack-compiled My Listings
getServerSideProps and dynamic repository with mocked Auth/HTTP transport;
the authenticated branch and seller-specific query passed without the reported
module error. This is not live signed-in cloud acceptance. Stale/mismatched
webpack state remains a plausible explanation, not a proven exact root cause;
retest My Listings with the owner's real session before declaring full recovery.
The dev build emitted a server-repository browser chunk, but browser callers
use API requests; no service-role key or server secret is used by this repository.
No speculative architecture rewrite was made to address the unreplicated error.

Part B completed the independent Welcome navigation change: brand at left,
About and Log in at right, no session-dependent My Account. About's final
scroll behavior is intentionally deferred. Other account navigation is unchanged.
Files touched this pass: `components/listings/welcome-hero.tsx`, its CSS module,
and this status document. Hero effects, Drift Wall, shared fixed Gradient Waves,
horizon interpolation and sequential section transition remain unchanged.

**Initial source blocker (superseded by the next entry):** the attachment contained
only `[paste exact source here]` for Lanyard, Flex Carousel and Motion Primitives
Transition Panel. The follow-up below implements all surrounding structure while
leaving those three supplied component integrations pending.

Validation so far: TypeScript, scoped ESLint, homepage/domain/session tests
passed. Headless Edge at 390/1280/1536 confirmed exact Hero navigation, one canvas,
no horizontal overflow and no page errors. Mobile screenshot inspected.
Production `npm run build -- --no-lint` passed. The compiled authenticated SSR
transport test also passed against the production build. Production HTTP checks
returned 200 for homepage and live public listings, and the expected anonymous
307 for My Listings. Existing Browserslist warnings were left unchanged.

## Landing Structure Prepared - 2026-10-01

Implemented the owner's follow-up to finish the surrounding layout immediately:

- `/` is now the Welcome landing page. `/listings` owns the original complete
  browse interface (search/filter/sort/grid/pagination); both reuse its existing
  request-scoped SSR query. Homepage Section 2 contains none of the old browse UI.
- Welcome navigation remains brand / About / Log in for all session states.
- Hero has a responsive right-side visual container: transparent Drift Wall at
  layer 0, an empty Lanyard slot at layer 1, and navigation at layer 2. Only
  supplied slot children receive pointer input. Desktop and mobile use separate
  sizing; Drift Wall extends beyond the right/bottom Hero crop and fades at its
  entry edges. No fake Lanyard interaction or text card was added.
- Section 2 is an empty transparent Flex Carousel slot with the existing incoming
  animation. Footer follows it with minimal independent-marketplace copy and a
  compact transparent Transition Panel slot. About navigation remains deferred.
- One fixed GradientWaves spans all three sections; shader, colors, flow, 5.5 to
  -12 horizon mapping/clamp and 75%/78% sequential fade thresholds are unchanged.
- Default shell footer is excluded from `/` to avoid duplication; `/listings`
  has the normal marketplace header/footer. Desktop and mobile Market links now
  target `/listings` so browsing stays accessible. Account links are unchanged.
- Removed obsolete homepage Market-specific contrast selectors and children
  composition. Repository search found no Lanyard/Flex Carousel/Transition Panel
  source and no remaining Tear Ticket/Infinite Spiral runtime references.

Still required: the actual Lanyard implementation plus its models/textures and
CSS/dependencies; Flex Carousel source/CSS/dependencies; Motion Primitives
Transition Panel source/API/dependencies. Slots accept ReactNode and contain no
invented replacement. Section 2 is intentionally empty until supplied source is
integrated; Lanyard physics, carousel and panel interaction cannot be tested yet.

Runtime error recheck: the existing repository import and My Listings GSSP were
reinspected. Dev anonymous My Listings redirects correctly; public Supabase data
returns 200 with 2 rows. The actual compiled authenticated My Listings SSR branch
again passes with mocked Auth/HTTP transport. No recurrence or source-level
import defect was found, so no backend rewrite or catch/fallback was introduced.
The earlier fresh-output recovery stands; live signed-in acceptance and the
original error's exact cache/module mismatch remain unconfirmed.

Validation: TypeScript, scoped ESLint, home/browse/domain/session tests passed.
Headless Edge at 390/1280/1536 verified empty transparent Section 2, transparent
single footer, exact navigation, one canvas, no horizontal overflow or page errors.
Shader uniform tests verified fixed canvas, horizon clamp/reversal, continued time
at footer and unchanged fade gap. Reduced motion, mobile Market navigation and
canvas cleanup passed. Browse regression at 390/1536 passed search, filter drawer,
apply/sort/chips/Clear, shareable URL, reload and back/forward. Screenshots reviewed.
Production `npm run build -- --no-lint` passed, as did production HTTP checks
for landing and filtered browse (200) and anonymous My Listings (307). The
compiled production My Listings authenticated SSR transport test also passed.
Existing Browserslist warnings were left unchanged.

Files edited this pass: `pages/index.tsx`, `pages/listings/index.tsx`,
`pages/_app.tsx`, `components/listings/homepage-scene.tsx` and its CSS module,
`components/listings/welcome-hero.tsx` and its CSS module,
`components/listings/marketplace-shell.tsx`, `tests/marketplace-home.cjs`,
and `docs/PROJECT_STATUS.md`. No backend, dependency or supplied shader edits.

## Homepage Transition Panel Footer - 2026-10-01

Used the owner's CLI-installed `components/motion-primitives/transition-panel.tsx`
and existing `motion` dependency without reinstalling or recreating the component.
The generated source referenced nonexistent `@/lib/utils`; switched only its
class-name helper import to the already-installed `classnames`, with repository
formatting/type-import lint fixes. AnimatePresence, popLayout, keyed motion.div,
and the component's original transition API remain intact.

Added `components/listings/homepage-footer.tsx` and its CSS module. HomepageScene
renders it immediately after the Flex Carousel section; removed the obsolete
empty footer slot/CSS. Transparent wrappers keep the shared Gradient Waves visible.
Footer has a restrained brand label, three 44px-minimum-height buttons, clear
selected/focus states and a compact panel with space reserved against text jumps.
Buttons use aria-pressed and aria-controls; content has polite announcements.

Panels use the owner's exact suggested copy:
- About: An independent marketplace for the Western community to buy and sell
  second-hand items nearby.
- Community: Built around local exchange, reuse, and easier connections within
  the Western community.
- Safety: Meet in appropriate public places, review listing details carefully,
  and use good judgment when arranging a transaction.

Motion is 250ms easeInOut: enter opacity 0 / y -30 / blur 3px; center opacity 1 /
y 0 / blur 0; exit opacity 0 / y 30 / blur 3px. Reduced motion removes travel/blur
and uses zero duration. About navigation remains deferred. Hero layout, text,
Drift Wall, Lanyard/Flex Carousel slots, waves and scroll transitions are unchanged.
No auth/backend/account changes or dependency installs were made.

The two new attachments now supply Lanyard and Flex Carousel code. This turn's
explicit scope excludes changes to those components; their integration remains
outstanding. Inspect their full supplied sources/assets in that future pass;
do not report their source as missing anymore. Lanyard's attached source references
`card.glb` and `lanyard.png`, which still need asset resolution at integration time.

Validation: TypeScript, scoped ESLint (including generated component), and existing
landing/browse tests passed. Headless Edge at 390/1280/1536 verified every panel,
button selection, Tab/Enter switching, reduced motion, footer order, transparent
background, one shared canvas, no horizontal overflow and no runtime errors.
Mobile and desktop screenshots reviewed. Production
`npm run build -- --no-lint` passed. Existing Browserslist warnings unchanged.

## Lanyard and Flex Carousel Integration - 2026-10-01

Integrated the supplied Lanyard and Flex Carousel JSX/CSS from attachments
3c66dd9c-998f-44d4-a517-cc6752ff45e5 and e86814b0-af77-47a0-93d1-1db502463662.
Added their files and thin TypeScript declarations in `components/ui/`, moved
required global CSS imports to `_app.tsx`, and connected both through client-only
dynamic imports in HomepageScene. Neither is an empty slot anymore.

Lanyard retains the supplied Rapier rope/spherical joints, rigid bodies and pointer
dragging. Downloaded missing `card.glb` and `lanyard.png` from the official React Bits
repository to `public/lanyard/`, with upstream license and attribution. Local SVG
card art says "Pull to join us" on both faces. Camera distance is 18 for readability
inside the existing constrained right-side slot (280px mobile / 440px desktop).
The wrapper is 100% slot height instead of the supplied full viewport height.
Added disposal for the generated card-face texture; retained existing cursor cleanup.
No payment/auth action is connected to pulling the card.

Flex Carousel consumes one primary photo per real Listing plus title, existing CAD
price formatter and pickup area. Removed all arbitrary Unsplash demo defaults.
It uses portrait cards and selects the real listing detail route via its original
onSelect callback; focusOnClick is false to let selection navigate. Source drag,
keyboard, shader, intersection observer and cleanup mechanisms remain intact.
No photos yields an honest empty message. Current cloud data has one listing with
a photo, so the supplied infinite carousel repeats that one real item.

Section wrapper stays transparent and the footer follows it. Set captureWheel=false
and changed source CSS overscroll containment to x-only, allowing vertical page
scroll through the carousel. There are three expected visible DOM canvases: ONE
Gradient Waves, ONE Lanyard and ONE Flex Carousel. Wave shader, horizon/scroll
behavior, Hero text, Drift Wall and Transition Panel are unchanged.

Added React 18-compatible dependencies: @react-three/fiber 8.18.0, drei 9.122.0,
rapier 1.5.0, three 0.170.0 and meshline 3.3.1. Pinned @types/three 0.160.0 to avoid
newer declaration syntax unsupported by the existing TypeScript compiler. No
framework upgrade, backend changes or unrelated dependency cleanup was performed.
Supplied JSX is narrowly excluded from legacy TS-centric lint and separately
checked for undefined identifiers/unreachable code.

Validation: TypeScript, scoped integration ESLint, standalone supplied-JSX lint,
and homepage/domain tests passed. Headless Edge at 390/1280/1536 verified real
card grab/drag, carousel render, keyboard selection to listing detail, vertical
wheel scrolling, no horizontal overflow, successful assets and route cleanup.
Emulated mobile touch vertical scrolling and reduced-motion rendering passed.
Screenshots reviewed. Production `npm run build -- --no-lint` passed; production
browser smoke test with normal Service Worker registration passed with three
intended canvases and no page errors. Blocking Service Workers in the production
test triggered the existing PWA registration waiting error; this unrelated behavior
was not changed. Local production preview is running at http://localhost:3000.
No physical GPU/device or cloud-write test was performed.
Lanyard's supplied physics does not have a reduced-motion or offscreen-pause API;
no such behavior is claimed. Flex Carousel retains its supplied reduced-motion
and intersection-based rendering behavior. Physical-device acceptance remains open.

## Depth Text Diagnosis and Integration Fix - 2026-10-01

Inspected the supplied DepthText mechanism before tuning: duplicate absolute text
layers on an inline-grid stage, negative translateZ per layer, positive 0.6px face,
900px perspective, preserve-3d, base/pointer rotation, CSS-variable colors and
color-mix shading. The layer saturate/brightness filter is part of supplied source;
no pseudo-elements, stroke or fake extrusion shadow were added. shadow remains false.

Rendered the exact existing component/props in a temporary diagnostic route through
a portal directly into body (transparent container, no heading class, no transform,
filter or overflow clipping). Compared at matched inherited typography, coordinates
and neutral background. The actual Hero and isolated captures had ZERO differing
pixels. Removing Hero overflow:hidden and isolation:isolate also changed ZERO pixels.
Computed layer styles matched, including 700 Inter / 88px at desktop, preserve-3d,
backface-visibility:hidden, translateZ(-6.5px), opacity:1 and native layer filter.
Face had #fafafa, no shadow, no filter/stroke override. Heading/copy/composition had
visible overflow, no transform/filter and opacity:1. The full Hero crop bounds were
well outside the glyph layers. Parent scroll opacity/transform affects the whole
section as intended, not its internal 3D construction. Global h1 and .copy h1 rules
did not override the internal font/color/3D declarations. No conflicting CSS selector
was found and no Hero/global/component CSS was changed for this fix.

Two causes were confirmed: normal mode was configured with only 10 * 0.65 = 6.5px
of total depth and tilt=3 (base rotation -0.96deg / 1.26deg), visibly subtle even in
isolation. In reduced-motion mode WelcomeHero's `reduced !== false` conditional
replaced the entire DepthText component with plain text, despite supplied DepthText
already supporting static 3D in reduced motion.

Changed only WelcomeHero integration: keep the hydration text fallback while reduced
is null, then render DepthText in both motion modes. pointerTracking={!reduced}
ensures a live preference change re-enters the source's static transform branch.
After ruling out CSS conflicts, set layers=24, depth=1.8, tilt=8 (total43.2px;
base rotation -2.56deg / 3.36deg). Preserved perspective=900, fontWeight=700,
fontSize=inherit, faceColor=#fafafa, depthColor=#77717f, shadow=false, autoOrbit=false.
The original JSX and CSS effect mechanism is unchanged.

Temporary `pages/depth-diagnostic.tsx` was removed. Diagnostics/computed-style JSON
and screenshots are temporary local artifacts only. TypeScript, scoped ESLint and
homepage/browse tests passed. Edge 390/1280/1536 verified 24 layers per line, glyph
bounds inside Hero, no overflow/runtime errors, unchanged fade timing and static
3D after switching reduced motion on. Before/after screenshots inspected.
Production `npm run build -- --no-lint` passed; diagnostic route absent from output.

## Focused Hero Composition / Supplied Hero Parallax - 2026-10-01

Source policy: the owner requires asking for missing component source, not fetching
another version. Latest supplied sources are attachment b00784e9-a03e-4838-a929-
6ba9ec6c5a80 (Velora Hero Parallax) and 5a1d44a5-b4ba-44bd-9a27-09178a44ae5e
(Gooey Nav JSX/CSS). Current implementations are based on these supplied files.
They were byte-equivalent after trimming to the earlier retrieved versions; the
Hero Parallax file was regenerated from the supplied attachment. No installer was
retried and no dependency/Tailwind installation or upgrade was performed this pass.

Confirmed Lanyard conflict BEFORE fixing: at 1280px mouse-down put the card in
`grabbing`, but wheel delta600 scrolled page to600 and the existing fade wrapper
became inert. Page scroll, not Drift Wall painting above the card, interrupted the
interaction. Fixed with a nonpassive wheel listener scoped to the Lanyard wrapper
that prevents only while actively grabbed; touch-action:none only on its canvas;
pointer propagation/capture and release on cancel/lost capture/window blur.
Canvas event coordinates now use client position relative to getBoundingClientRect
so the existing scroll scale/translation does not distort raycasting. Outside the
surface the page continues scrolling. No document-wide scroll lock was introduced.

Desktop right visual group now spans the Hero height and right48% width. Lanyard
canvas fills98% Hero height (882px at900px Hero, previously440px), giving approx2x
projected card size at unchanged camera distance18/card mesh scale2.25. Rope segment
length is1.3 on desktop (previously1), with anchorY4.4 (previously4). Three joints
produce a longer cord and the resting card center at about65% Hero height in both
1280/1536 captures, without top:66% positioning. Mobile retains280px local canvas,
segment length1 and anchorY4. Drift Wall desktop tile150x110 ->225x165, gap12 ->18,
with wall at lower-right and extending past the Hero crop. Its isolated wrapper
is layer0; Lanyard sibling layer1; nav layer2. The sibling stacking structure keeps
all wall transforms/masks below Lanyard. No absurd z-index or Hero-wide scaling.

Gooey Nav: `components/ui/GooeyNav.jsx`, CSS and declaration; stylesheet imported
from _app. Only About and Log in are shown alongside the existing brand. Original
particle animation retained; bounded timer/frame cleanup, accessible About control,
keyboard link activation and reduced-motion particle skip added. Scoped its easing
variable to its container and made the filter's black backdrop pseudo-element
transparent so it does not leave a black box over the shared background. About's
final scroll behavior remains deferred. Removed old plain action-button CSS/code.

Hero Parallax: `components/ui/hero-parallax.tsx` and CSS Module. Preserved supplied
useScroll target/offsets, useSpring260/40, rotateX18/rotateZ12/y60/opacity0.5->flat,
three-way slicing, alternating drift and keyboard focus nudge. Used existing
classnames instead of missing cn helper. Converted ALL Tailwind classes to CSS
Modules, including reduced-motion flatten/wrap, caption gradient, hover, shadow,
focus outline and 4:3 cards. Desktop288x216px; mobile168x126px, gap20/12px and
horizontal drift480/120px. Replaced cqh spacing with viewport spacing because no
size container exists; window remains the scroll container. Section2 transparent.
Removed FlexCarousel JSX/CSS/declaration and every runtime import.

`lib/fixtures/hero-parallax-demo-products.ts` contains21 clearly labeled visual-demo
items using existing local sample photographs (reused, not representative photos
of the named objects). No fake sellers/sales/activity, no broken listing hrefs.
Only homepage SSR in NODE_ENV=development imports/passes this fixture; production
uses real listing photos, repeated only as necessary to keep three populated rows.
The public browse backend, database, Storage and CRUD never receive the fixture.

Depth Text rechecked: no conflicting CSS found; the prior controlled isolated vs
Hero comparison was identical. The explicitly passed fontWeight700 was below the
supplied default900. Restored that supported prop to900; retained24 layers,
depth1.8, tilt8, original colors/perspective and shadow=false. Computed face weight
is900 at all three widths. Do not invent a CSS override root cause.

Validation: TypeScript passed; scoped ESLint has no errors (two original source
array-index-key warnings retained). Supplied JSX correctness lint passed.
Home tests now verify21 dev items and no demoProducts in production props;
home/domain/session tests passed. Headless Edge390/1280/1536 passed drag+wheel
protection/release, nav items, 3x7 Parallax rows, alternating drift, tilt flattening,
reduced-motion static/wrapped content, no horizontal overflow or page errors.
Touch pull/cancel and outside scrolling plus Gooey keyboard login passed. Reviewed
mobile/desktop screenshots. Wave props/horizon and sequential fade math unchanged.
Production build (`npm run build -- --no-lint`) passed. A later production HTTP
smoke check could not complete: the current .next directory no longer contains
BUILD_ID, so next start cannot serve that build. Production fixture isolation
is covered by the passing home test; runtime production verification requires
a fresh build. Physical-device acceptance remains outstanding.

## Homepage Parallax Scroll Timing - 2026-10-01

Separated section entry from the supplied Parallax animation. Previously the
outer opacity used global scroll over 0-80vh while HeroParallax independently
measured its own moving content with start/start to end/start offsets. There was
no dedicated post-entry range or sticky hold for its initial composition; its
unfolding was coupled to the content passing through the viewport. This change
explicitly guarantees the initial pose throughout entry rather than relying on
content height/label placement to delay it.

Preserved Welcome fade-out at 0-60vh, background-only gap at 60-62.4vh, and
Section 2 fade-in at 62.4-80vh. A new transparent parallaxScene wraps the sticky
Section 2 and adds 180vh bottom scroll space. Its independent, noninteractive
160vh timeline starts 20vh into the wrapper: absolute document scroll 100-260vh.
Thus entry and the following 80-100vh hold both keep progress exactly zero.
Further natural window scrolling advances the existing spring/rotateX/rotateZ/y/
opacity and alternating row transforms. Upward scrolling reverses them. No snap,
scroll interception, simultaneous crossfade or nested scrolling was introduced.
Reduced motion removes the added scroll space and sticky positioning.

Changed only homepage-scene.tsx, homepage-scene.module.css, hero-parallax.tsx and
this document. HeroParallax gains an optional scrollTarget ref; its original
self-target default and motion values/260/40 spring are unchanged. Wave shader,
horizon math, cards, demo data, Hero components and marketplace logic unchanged.

Validated headless Edge at 1280/1536/390 x 900: during entry and at full visibility,
rotateX18/rotateZ12/y60/opacity0.5 and row offsets0/0/0; hold until100vh;
subsequent unfolding and alternating drift; final offsets +/-480 desktop and
+/-120 mobile; upward return, reduced motion, no page errors or horizontal
overflow. Reviewed desktop/mobile entry screenshots. TypeScript and homepage
tests passed. Scoped lint: zero errors, two existing array-index-key warnings.
Production build passed; production / and /listings both returned HTTP200, with
no demoProducts or visual-demo IDs in homepage output. This also completes the
previous pending production runtime/data-isolation check. Physical-device visual
acceptance remains for the owner.

## Natural Parallax / Masked Heading / Lanyard-only Hero - 2026-10-01

Owner requested natural demo-like scrolling instead of the held Section 2 scene.
HomepageScene now defaults parallaxMode to natural. Section 2 is in normal flow,
with 30vh top composition space so tilted cards enter from below. Its independent
160vh target begins at document80vh, exactly when sequential entry completes;
there is no post-entry delay or sticky hold. Original motion mappings flatten the
plane after another35.2vh while the entire section moves upward naturally.
The previous choreography remains opt-in through parallaxMode="held" (20vh hold,
sticky section,180vh added scroll space), with reduced-motion overrides for both.
Welcome fade-out, background-only gap, Section 2 fade-in and wave horizon unchanged.

Replaced rendered DepthText with the owner's supplied MaskedHeading source from
attachment1a07fcdf. Preserved SVG text clip, measurement/ResizeObserver, GSAP reveal,
media drift and pointer parallax. CSS imported from _app as required by Pages
Router; added JSX declaration and narrow vendor lint exclusion. Existing gsap
used; no dependencies installed. Two span instances inside the accessible h1
retain the two headline lines. Left alignment, weight900, textScale0.14, rise
reveal; reduced motion disables reveal/drift/pointer parallax. Headline/subtitle
share the left edge; desktop copy remains vertically centered in its left column.

Removed DriftWall rendering, listing-image preparation, responsive wall hooks,
wall-specific CSS and obsolete DepthText/DriftWall global CSS imports. Their
standalone source files remain available but are not mounted/imported by homepage.
Right visual contains only the existing Lanyard; physics/drag behavior unchanged.

Owner allowed blank fill if no reusable Western promotional video could be found.
No clearly licensed reusable promotional footage was established. Western terms
https://www.uwo.ca/terms-of-use.html do not provide a general reuse grant. Added
local near-white SVG at public/static/images/masked-heading-fill.svg as a neutral
placeholder. No external video downloaded; supplied component retains video
support for future licensed media. White fill intentionally has no visible media
texture/drift, while the actual mask/reveal mechanism is installed.

Validation: headless Edge390/1280/1536x900 passed masked glyph measurement, two
heading lines, left alignment, Lanyard-only rendering, natural upward section
movement, initial18/12/60/0.5 state, flattening within40vh of entry, alternating
rows, reduced motion, no horizontal overflow or page errors. Reviewed Hero/entry
screenshots. TypeScript, scoped lint, supplied JSX correctness lint and homepage
tests passed. Production build passed. Production HTTP checks for /, /listings
and local fill SVG passed; natural mode and production fixture isolation verified.
Physical-device acceptance remains outstanding.

## Unified First-screen Hero Parallax - 2026-10-01

Latest owner correction supersedes the previous two-section/held scene decisions:
remove ALL section exit/entry choreography and place WelcomeHero inside
HeroParallax children, matching the supplied demo composition. Homepage now has
one continuous natural window-scroll region. Deleted outgoing/incoming opacity,
y/scale transforms, visibility/inert toggling, sticky wrappers, separate timeline,
held-mode prop/CSS and scrollTarget integration. No optional hold remains.

HeroParallax tracks its own full root again with original start/start -> end/start
useScroll, spring260/40 and unchanged three-row transformations. Added optional
copyClassName to supply full-width, zero-padding homepage header composition.
Removed the1200px max width and horizontal gutters on the image region. Root is
100% viewport width with internal overflow clipping, not document overflow.
Hero content occupies roughly65svh (minimum460px desktop/580px mobile, grows for
content). This exposes the initial tilted row in the FIRST viewport at lower-left.
Nav, MaskedHeading, subtitle and Lanyard scroll upward together with the rows.
The development-only demo disclaimer sits after the rows. No fake production
listings added. Empty catalog still renders WelcomeHero and an honest empty state.

Wave shader settings and5.5 -> -12 horizon mapping over80vh unchanged. Kept
MaskedHeading, TextType, Lanyard interaction and footer; no auth/backend changes.
Files changed: homepage-scene.tsx, homepage-scene.module.css, hero-parallax.tsx,
and this document.

Validated headless Edge390/1280/1536x900: root width equals viewport, first tilted
row visible at top-of-page (row bounds start ~637/521/497px respectively), initial
18deg/12deg/y60; at450px scroll the plane is flat, Hero opacity remains1 and no
hidden/inert/sticky scene exists. Three rows, no horizontal document overflow or
page errors. Reviewed first-screen mobile/desktop screenshots. TypeScript and
homepage tests passed; scoped lint zero errors with two existing source key
warnings. Production build passed. Physical-device acceptance remains outstanding.

## Hero Foreground / Animata Navigation / Fold Text Pending - 2026-10-01

Owner requested both headline and subtitle use Fold Text, vertically centered
copy, lower Parallax placement and Lanyard above text/cards in stacking order.
No Fold Text source exists in the repository or latest supplied message. Preserve
MaskedHeading/TextType temporarily and request the actual JSX/TSX plus CSS from
the owner; do not invent/download a replacement. This part is NOT complete.

Completed independent work: extended Hero natural-flow height to75svh/min660px
mobile and80svh/min520px desktop; centered left copy lower in the viewport through
desktop composition padding80px/48px/24px. Full-width Parallax stays immediately
below and visible at lower-left in first screen. No fade/hold/sticky reintroduced.
Removed Hero overflow clipping, set text layer0, visual layer2, nav3. The existing
Hero copy wrapper sits above the Parallax plane. Desktop Lanyard canvas extends
180px below Hero so its dragged card can render over the cards rather than being
clipped at Hero bounds. No physics or drag code changed.

Replaced Gooey Nav rendering with owner's supplied Animata Algolia White Button
and Shining Button, under components/animata/button. Converted utility styles to
plain scoped CSS preserving original shadows, pressed movement, violet border,
arrow hover and shining sweep. Added responsive sizes/focus/reduced-motion rules.
Labels are About and Log in. About remains deferred as previously agreed; Log in
is a semantic link to /auth/sign-in. Styles imported from _app for Pages Router.
Added only the requested lucide-react dependency for ArrowRight. No shadcn/Tailwind
installation or upgrade. Unused striped/blinking-red demo theme omitted because
the supplied shining component does not use it.

Validation: headless Edge390/1280/1536x900 passed nonoverlapping nav bounds,
no horizontal overflow/page errors, Lanyard drag, and actual login navigation.
Reviewed desktop foreground layering/centered text/lower card-row screenshot.
TypeScript, scoped lint and homepage tests passed. Production build passed.
Physical-device acceptance remains outstanding.

## Lanyard Centering and Idle Sway - 2026-10-01

Raised the rope anchor from4.4 to5.45 on desktop and4 to4.8 on mobile, preserving
rope length, camera and mesh scale. Desktop resting card center is now around
450px in a900px viewport, aligned with the centered text; mobile retains the
stacked layout with card raised within its visual slot. Foreground layering stays.

Added gentle alternating horizontal impulses to the actual card rigid body:
acceleration amplitude1.4, angular frequency1.1rad/s (~5.7s period), scaled by
mass and capped frame delta. A2s ramp avoids abrupt restart. Idle drive pauses
during drag and hidden-document state; dragging resets its timer. Parent passes
reducedMotion so reduced-motion users receive no idle drive. Rope/card physics,
pointer capture and release remain active; no CSS canvas movement introduced.

TypeScript and supplied-JSX correctness lint passed. Headless Edge390/1280/1536
passed card drag and login/nav/no-overflow checks; desktop screenshot confirmed
centered card and subtle tilt. Production build passed. Fold Text is still
pending the owner's source.

## Mobile/Tablet Tear Ticket and Header About Removal - 2026-10-02

Integrated the owner's supplied TearTicket JSX/CSS (attachment f7f8b6a4) without
rewriting its tear geometry, spring/physics, pointer capture, keyboard support or
reduced-motion behavior. Global stylesheet is imported through _app; dynamic
client-only component avoids server layout-effect warnings. Added TS declaration
and narrow supplied-source lint exclusion; no dependency additions.

Homepage chooses one visual after media-query hydration: Tear Ticket below1200px,
or on coarse-pointer/no-hover screens up to1366px (landscape iPad Pro included).
Other desktop sizes keep Lanyard with idle sway. Media query changes are subscribed
and cleaned up. Lanyard is not mounted on ticket devices, rather than just hidden.
Ticket uses420x220 logical dimensions with original automatic fitting, purple
body/stub and existing marketplace invitation copy. Tearing 'Pull to join us'
opens the existing /auth/sign-in route; keyboard Enter also works. WelcomeHero
now accepts a generic visual slot and a ticket-specific positioning class.

Removed About from Welcome navigation at every size and removed its unused global
button CSS import. Kept Shining Log in and footer's About content unchanged.
Standalone Algolia White Button source remains reusable. Wave/Parallax, backend,
auth implementation and desktop Lanyard physics unchanged. Fold Text remains
pending owner-supplied source.

Validation: headless Edge390x844,768x1024,1024x768,1366x1024 touch contexts show only
Tear Ticket;1280x900/1536x900 desktop show only Lanyard. Header has no About, login
remains. Actual pointer tear on390 and keyboard tear on iPad sizes reached login.
No horizontal overflow or page errors. Reviewed mobile/tablet screenshots.
TypeScript, scoped lint, supplied JSX correctness lint and homepage tests passed.
Production build passed. Physical-device acceptance remains outstanding.

## Expandable Listing + Tutorial Placeholder - 2026-10-02

Detailed current homepage specification: [HOMEPAGE_DESIGN.md](HOMEPAGE_DESIGN.md).
Order: WelcomeHero within HeroParallax's copy slot ->3 Parallax rows -> existing
Parallax caption/empty state -> NEW listing/video section -> TransitionPanel footer.
Previous experiment descriptions above are historical; the design document records
actual active components. No Hero, waves, invitation or Parallax timing redesigned.

Added homepage-listing-demo.tsx/CSS with full-width heading above44:56 desktop
columns, stacked mobile layout, once-only0.5s fade-up with0/.12/.24s stagger and
reduced-motion support. Card collapses to square image + CA$45 only. Adapted the
supplied Velora source into components/velora/expandable-card.tsx/CSS, retaining
shared IDs and320/32 spring. Portal overlay: desktop4:5 left media/right info,
mobile near-fullscreen4:3 top media. Favorite top-right, Close and Contact seller
bottom actions. Inert background, trapped focus, Escape/backdrop/Close dismissal,
body lock through exit, exact scroll and trigger-focus restoration implemented.

Independent illustrative Woven accent chair fixture/photo under lib/fixtures and
public/demo; attribution/license recorded. Demo seller/verification explicitly
labeled illustrative. Favorite is local preview state; Contact seller shows a demo
notice. No backend/API/storage/auth/Favorites/Messages writes or changes. The
ListingMedia images-array boundary permits a future carousel without redesign;
none installed. Video is only a16:9 slot for a future iframe, no player installed.
Canonical /listings/[id] remains; future checkout/transactions stay separate from
the detail overlay. Fold Text still awaits owner source.

390/1280/1536 browser checks passed geometry, placement, allclose paths, scroll
lock/restoration, focus restoration/wrapping, preview actions, once-only entrance,
no overflow/page errors. Reduced-motion and unchanged Parallax unfolding passed.
Browser regression saved in tests/homepage-listing-demo.browser.cjs. TypeScript,
scoped ESLint (zero errors/warnings), existing homepage tests and production build
passed. Production /, /listings and local demo image HTTP checks passed, including
new section presence/order and unchanged production Parallax fixture isolation.

## Trust Panel and Expandable Listing Polish - 2026-10-02

Homepage order remains WelcomeHero/Parallax -> listing/video demonstration -> final
information panel. Reused existing Motion Primitives TransitionPanel; added Trust
as default before About/Community/Safety. Five numbered editorial items use the
requested copy with a future-functionality notice. Height changes animate through
a measured wrapper; mobile tabs scroll internally. About explicitly independent.

Transaction PRODUCT DIRECTION finalized: mutual buyer/seller confirmation, held
payment,72-hour protection before release/payout, meetup or shipping, recommended
public/custom agreed locations, condition photos, listing snapshot, timestamps,
transaction evidence and future dispute workflow. These payment/backend/shipping
features are NOT implemented; this task adds copy/documentation only.

Animation diagnosis verified with browser-frame sampling: the entrance wrapper
never remounted or replayed (same DOM, opacity1, transform:none). Shared card-ID
hid/projected the entire trigger; shared title-ID moved the price; fixed-body lock
reset document coordinates and caused a later return translation. Removed card/
price shared identities, retained media-ID/spring and stable once-only entrance.
Normal trigger/price now stay anchored; info fades locally. Overflow lock retains
scroll coordinates through presence exit, with focus and scroll restoration.

Contact seller and Welcome/Login both use the actual ShiningButton component with
its green variant. Login keeps its existing route/link behavior; the reusable
component's purple default remains available. Red Close uses semantic local
raisedButtonDanger CSS (no Algolia restoration). Exact palette/shadows and API are
in [HOMEPAGE_DESIGN.md](HOMEPAGE_DESIGN.md). No new dependencies/backend changes.
The final panel uses opacity/6px transitions without blur; its mobile tab track
shrinks within the grid and includes focus-outline clearance. Current page order:
Welcome Hero, three-row Hero Parallax, Expandable Listing + Tutorial Video,
final Trust/About/Community/Safety panel. The shared Gradient Waves background is
not a separate section; future sections are not counted as implemented.

390/1280/1536 tests passed three cycles with frame-level stable price/trigger,
no blank returned media, all close paths, locks/focus, responsive button hierarchy,
Trust tab order/default/switching, reduced motion and no overflow/page errors.
TypeScript, scoped ESLint, existing homepage tests, both listing browser
regressions and production build passed. Existing unrelated CRLF/Browserslist
warnings were not changed. Physical-device acceptance remains outstanding.

Continuation verification (2026-10-02): retained the already-present Trust and
media-only shared-layout fixes; aligned Login with Contact seller's green variant,
reduced footer transitions to 6px/no blur, corrected the mobile tab track and
extended the regression with the Login route/style check. Both browser suites
passed at 390/1280/1536px, as did typecheck, scoped lint and homepage/domain/session/
security tests. The standard build still fails inherited CRLF/Prettier checks;
the existing npm run build -- --no-lint workflow passed production compilation
and page generation. Current
verification did not reproduce the historical buggy baseline; its root-cause
record above is retained from the prior pass. No backend/cloud writes were made.

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

- Payment/checkout implementation without a separate implementation task; shopping cart remains out of scope
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

Last updated: 2026-10-02

Current phase: Trust panel and expandable listing polish complete; Fold Text awaiting owner source

Next milestone: Physical-device visual acceptance and live authenticated My Listings recheck

Username/Auth focused polish: the pending username migration now includes reserved
names, rolling 168-hour rename cooldown, private 30-day release history/holds and
legacy immediate first-change behavior. Auth uses a 1000ms ?Hold to create account?
control, centered Log in, desktop yellow-backed Shift Tabs and a shared-action-sized
solid mobile selector. No live SQL or Send code/email investigation in this pass.

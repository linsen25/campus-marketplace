# Homepage design and implementation

Last verified: 2026-10-02. Read alongside [PROJECT_STATUS.md](PROJECT_STATUS.md).
This document describes the actual repository, not superseded chat mockups.

## Page order and boundaries

1. Welcome Hero: branding, headline/subtitle and interactive invitation.
2. Velora Hero Parallax: three image rows directly below the Hero copy.
3. Expandable Listing + Tutorial Video: next distinct section, after Parallax
   and its existing development caption/empty-state text, before the footer.
4. Final informational/footer area: installed Motion Primitives TransitionPanel, with Trust (default),
   About, Community and Safety tabs. Independent marketplace, not an official service.

WelcomeHero is deliberately passed as HeroParallax children, matching the supplied
Velora demo. They form one natural window-scroll region. Do not restore a separate
Section 2 entrance, sticky hold, crossfade, scroll snap or hidden-until-entered gate.
The user explicitly removed those experiments. The new demonstration is outside
HeroParallax; its entrance never drives the Parallax timeline.

## Welcome Hero: current components

- One fixed GradientWaves WebGL background is shared by every homepage section.
  Animation continues flowing. Scroll changes only the horizon height from5.5 to
  -12 over80vh, clamped and reversible; the canvas is never translated with scroll.
- Campus Marketplace brand and Animata Shining Log in link. Header About was removed.
- MaskedHeading headline, currently near-white placeholder fill; TextType subtitle.
  Fold Text for both remains pending the owner's actual source. Do not invent it.
- Lanyard on desktop: foreground above text/rows, centered card, subtle physics
  sway when idle. Drag suspends idle force; reduced motion disables idle sway.
- Supplied TearTicket below1200px, and on coarse-pointer/no-hover displays up to
 1366px (including landscape iPad Pro). Tearing opens /auth/sign-in.
- Historical Gooey Nav, Depth Text and Drift Wall are not mounted. The new-section
  request listed these older components; that list is not the current baseline.

Preserve existing marketplace routes, header/bottom navigation, authentication,
search/filter/sort/pagination and account architecture.

## Hero Parallax

`components/ui/hero-parallax.tsx` retains the supplied Motion foundation:
three rows on desktop and mobile, alternating right/left/right drift, initial
rotateX18 / rotateZ12 / y60 / opacity0.5, spring stiffness260/damping40. Tilt flattens
in the first22% of its own root scroll progress. The target is its full root, with
start/start to end/start offsets and natural window scrolling. The tilted first row
is visible at the lower-left of the first viewport. No section-entry timing remains.

Full viewport width, internal clipping only. Desktop cards288x216, mobile168x126.
Development SSR supplies21 clearly labeled visual samples. Production Parallax
uses real listing photos. Those existing data and animation choices are untouched.

## New listing/video section

`components/listings/homepage-listing-demo.tsx` is the next section after the
Parallax area. Its wrapper is transparent over the shared waves. The heading is
quieter than the Hero, near-white, left aligned and above both columns:

> Take a closer look. Then connect with the seller.
>
> Expand the listing to see more details, or watch how easy it is to create your own.

Desktop grid tracks44:56 with a generous responsive gap; the left trigger is capped
at420px. Mobile below768px stacks heading, support text, listing and then video.
No additional WebGL, background gradient, full-width opaque panel or dependencies.

Each entrance wrapper has a once-only viewport fade-up, y24 to0, opacity0 to1,
duration0.5s/easeOut. Heading/card/video delays0/0.12/0.24s. Mobile enters each item
as it comes into view, in DOM order. Reduced-motion CSS immediately reveals them;
Motion transitions are also disabled. These wrappers do not contain the modal:
the modal portal prevents entrance transforms from constraining the fixed overlay.

## Expandable listing

`components/velora/expandable-card.tsx` adapts the exact supplied Velora source
(attachment21ec35b8). There was no previous ExpandableCard file in the repository.
Only media now has a shared layout ID. Retained AnimatePresence, the320/32 spring,
backdrop fade, Escape handling and keyboard focus cycle. Existing classnames
replaces the unavailable cn helper; styles use a CSS Module. No component fetched
or animation recreated from scratch.

API: title is ordinary price text (not shared geometry), expandedTitle labels the dialog, media is a
replaceable ReactNode, children supply detail content, topAction and primaryAction
supply the prototype controls. The same logical media element/layout ID changes
shape; both instances receive the same ListingMedia component.

Collapsed trigger has only the image (1:1) and formatted CA$45. No visible title,
seller, favorite or metadata. It is a keyboard-accessible button with a descriptive
accessible name, aria-haspopup, aria-expanded and aria-controls.

Desktop expansion is a centered overlay up to1040px, independent of the left
column. Media4:5 left, information right. Mobile uses almost the whole viewport,
media4:3 on top, information underneath and actions at the bottom. The interior
scrolls if content exceeds available height; actions remain visible.

Information hierarchy: large price; prominent product title; bold Seller label,
Alex and smaller Western email verified; bold Description label and description.
The example/verification disclaimer appears in the detail and outside the trigger.
Favorite is top-right; Close is bottom-left; Contact seller is primary bottom-right.

This is a visual demonstration, not a backend listing:
- `lib/fixtures/homepage-listing-demo.ts`: Woven accent chair,4500 cents, Alex,
  illustrative verification and description. photoUrls remains an array.
- `public/demo/reading-chair.jpg`: local photograph by Hutomo Abrianto, from
  https://unsplash.com/photos/gray-padded-chair-l2jk-uxb1BY under the Unsplash License.
  Asset source/license is recorded in public/demo/README.md. The image shows a
  woven chair; the product title is intentionally not an unsupported IKEA claim.
- This one explanatory fixture is explicitly labeled in the homepage and may be
  rendered in production as an illustration. It is separate from the21 dev-only
  Parallax fixtures and is never inserted into actual listings or Supabase.
- Favorite only toggles ephemeral preview state. Contact seller displays an honest
  demo notice; no person is contacted and no Messages/Favorites architecture changes.
- No ratings, reviews, transactions, reputation or fabricated activity.

## Media and future transaction boundaries

`components/listings/listing-media.tsx` receives the full images array and optional
children. Today it renders one image. A future ListingCarousel replaces only its
contents when images.length >1; the shared-layout wrapper keeps the same ID and
responsive aspect ratios. No images are removed and no carousel was installed.

Future flow: Listing Card -> Expandable Listing Detail -> Contact Seller / Buy /
Make Offer -> a separate transaction or checkout flow. ExpandableCard is a detail
surface, never the final transaction container. No payments, orders, offer form or
checkout is implemented here. `/listings/[id]` remains the canonical full-detail
route for direct links, sharing, refresh and future transaction navigation.

## Video boundary

The right-hand `videoSlot` is a responsive16:9 container with rounded corners,
subtle border and dark purple surface. It contains only Create Listing Demo plus
a separate coming-soon caption. No fake controls, iframe, YouTube network calls or
player dependencies. Replace the slot contents with a YouTube iframe later; the
existing wrapper and iframe fill rules preserve layout. Mobile places it below card.

## Modal accessibility and scroll lifecycle

The overlay is portaled to document.body, above mobile navigation, outside the
homepage's transforms/isolation. Dialog has role=dialog, aria-modal and an actual
product-title label. Focus enters the panel, Tab/Shift+Tab wrap, Escape/Close/
backdrop dismiss it and focus returns to its trigger with preventScroll.

Background #__next is inert while the overlay is active. Store exact window X/Y
and touched inline styles, compensate for scrollbar width, and lock body/HTML
overflow without changing body positioning or document scroll coordinates.
Lock/trap remain through exit animation. Fixed-body scroll resets were removed
because they disrupted shared-layout measurement during close.
Cleanup restores only the changed styles, previous inert state, exact scroll
position and trigger focus. Modal content has contained overscroll; scrolling the
Description never scrolls the homepage. Unmount cleanup uses the same restoration.

## Validation and maintenance

Verified390/1280/1536px: placement, collapsed-only price, all three media ratios,
16:9 slot, desktop columns/mobile stack, modal size, actions, Escape/Close/backdrop,
focus restoration, focus wrapping, body lock and exact scroll restoration; no page
errors/document overflow. Entrance stays visible on returning to the section.
Reduced-motion browser check confirms immediate visibility and zero transforms.
Existing Parallax still starts tilted, has3 rows and unfolds on scroll.
TypeScript, scoped lint, homepage tests and production build passed. Production
HTTP checks confirmed section presence/order, image delivery and /listings.

Run TypeScript, scoped ESLint, `node tests/marketplace-home.cjs` and production
build (`npm run build -- --no-lint`, matching the existing build workflow).
Browser regression: `tests/homepage-listing-demo.browser.cjs`, with a running dev
server and external Playwright Core installation. Set PLAYWRIGHT_MODULE to its
module path if not locally available, BROWSER_EXECUTABLE to a compatible Chromium/
Edge executable, BASE_URL (default http://localhost:3100), and optional SCREENSHOT_DIR.
No browser/test dependency was added to the application package for this task.

Design principle: stronger visual Hero/Parallax -> calmer product demonstration.
Do not turn each homepage section into another competing animation showcase.
Outstanding: actual tutorial video, real data/action integration if explicitly
requested, future media carousel/transaction flow, Fold Text source and physical
device acceptance. None is silently implemented by this prototype.


## Trust information and finalized transaction direction (2026-10-02)

The final informational area reuses the existing Motion Primitives
`components/motion-primitives/transition-panel.tsx` without rewriting it.
Order is Trust, About, Community, Safety; activeIndex0 selects Trust on load.
Future sections, if separately authorized, belong before this final area; they are
not currently implemented homepage sections.
There is deliberately no separate Why Trust Us section. Trust is an editorial
01-05 list with small muted indices, headings, readable paragraphs and dividers,
not five cards. Tabs use an internally scrollable flex row on narrow screens.
A ResizeObserver measures the existing panel's content; a Motion height wrapper
smooths size changes. Content transitions use opacity and a restrained 6px vertical
offset without blur, and respect reduced motion. The tab row has min-width:0 and
focus-outline clearance so narrow grid tracks scroll internally without page overflow.
About explicitly states independence/no university endorsement.
Community emphasizes respectful student exchange; Safety gives practical advice.

Five finalized principles: Western community access; protected payments; mutual
buyer/seller confirmation; transaction/evidence records; safer meetup/shipping.
The requested exact Trust copy is shown with a prominent future-capabilities
notice. This is PRODUCT DIRECTION, not already implemented financial protection.
Existing verified-email sign-in is distinct from these planned transaction tools.

Future implementation requirements (not implemented by this task):
- Buyer AND seller confirm the handoff/delivery.
- Payment held during the transaction; release/payout only after both confirmations
  and the72-hour protection period, subject to the future protection/dispute flow.
- Meetup or shipping; recommended public campus locations or a mutually agreed
  custom meetup location.
- Pre-exchange/pre-shipping condition photos, timestamps, transaction updates,
  evidence/records and a listing snapshot attached to each transaction.
- A future dispute workflow. No invented current guarantees, checkout, payout,
  shipping integration or backend functionality is added here.

## Expandable animation invariants and diagnosis (2026-10-02)

Baseline frame sampling showed the entrance wrapper stayed the SAME DOM node,
opacity1 and transform:none throughout open/close. It was not actually remounting
or replaying InView. The observed flash/re-entry appearance came from the shared
card layout ID: Motion set trigger opacity to0 and projected its entire contents
back on close. Restoring a fixed body also changed document coordinates and caused
a subsequent trigger translation. The price separately shared title-ID geometry,
so it flew across the screen into the information column.

Fix: collapsed trigger is a normal button; price is a normal span/p with no layout
ID. Dialog shell has no card layout identity. ONLY media shares the original
media-ID and320/32 spring. ListingInfo enters locally with opacity/y6 over0.18s,
without delay or a cross-page price morph. Shells do not share spatial identity.
Stable entrance wrappers and their once-only InView settings remain mounted and
unchanged; no React key trick, remount, arbitrary delay or opacity override.
AnimatePresence still owns overlay close lifecycle and cleanup. Overflow-based
scroll locking preserves document coordinates, focus and exact close restoration.

Post-fix frame sampling at390/1280/1536 across three open/close cycles confirms
wrapper and trigger opacity1, no wrapper/trigger/price transforms, anchored price,
no missing-media frame after overlay removal and no second entrance. Escape,
Close, backdrop, focus return, keyboard wrapping and scroll locking remain.
Do not reintroduce card/price shared IDs or fixed-body coordinate resets.

## Expanded action buttons (2026-10-02)

Contact seller reuses `components/animata/button/shining-button.tsx` and its CSS.
Welcome/Login and Contact seller both explicitly select the existing green variant
(--shine-color:#166534). The component's purple default remains available to other
consumers; Login's route/link behavior is unchanged. Button/onClick/children/disabled
props on the SAME component support Contact seller. Original radius, typography,
arrow, press feedback, focus and sweep are reused;
no duplicated shining CSS. The demo action still only displays its honest notice.

Close uses semantic local `.raisedButtonDanger` styles in
`components/velora/expandable-card.module.css`; no new reusable button component
was needed for this one consumer. Dark red background#762e3c, text#fff5f5, lower
inset#481823, focus inset#c06b7b and outline#efb0ba. Shadows:
- Rest: rgba(35,10,20,.4) 0 2px 4px; rgba(35,10,20,.3) 0 7px 13px -3px;
  #481823 0 -3px 0 inset.
- Hover: first shadow0 4px 8px, same other shadows; translateY(-2px).
- Focus: #c06b7b 0 0 0 1.5px inset plus resting shadows, outline2px/offset3px.
- Active: #481823 0 3px 7px inset; translateY(2px).
Red Close remains secondary, green Contact seller primary, left/right on all widths.
No Algolia class, component import, installation or search/UI restoration was added.
Legacy packages/files that predate this task were not cleaned up or reintroduced.

Regression: `tests/homepage-trust-polish.browser.cjs` uses the same browser environment
variables as the existing listing test. It samples every animation frame, checks
three cycles and all dismissal paths, unchanged scroll/price coordinates, buttons,
Trust default and Trust -> About -> Community -> Safety -> Trust switching.

Continuation verification on 2026-10-02: the Trust/media-only fixes were already
present in the working tree and retained. Aligned Welcome/Login with the green
Contact seller variant; reduced footer motion and corrected tab-track sizing.
The browser sampler now uses listingFrames instead of the browser's reserved
window.frames property and verifies Login's green class and unchanged auth link.
TypeScript, scoped ESLint (endOfLine:auto for TS/TSX; browser/node environment for
the browser test), homepage/domain/session/security tests and both browser suites
passed. Each browser suite ran at 390/1280/1536px, including three repeated
open/close cycles, Escape, backdrop, focus/scroll restoration and tab switching.
Screenshots were inspected for the mobile overlay and desktop Trust list.
Standard npm run build is blocked by inherited CRLF/Prettier errors in unrelated
files. The existing npm run build -- --no-lint production workflow passed,
including type validation, optimized compilation and static page generation.
Physical-device acceptance remains outstanding; no payment/backend functionality
was implemented. The matching woven-chair fixture/photo remain unchanged.

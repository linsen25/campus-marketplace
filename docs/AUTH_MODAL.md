# Campus Marketplace authentication modal

The user-supplied Velora `AuthSignupCard` source is adapted locally in
`components/velora/auth-signup-card.tsx`, with utility classes translated into
`auth-signup-card.module.css`. No package, Tailwind or shadcn installation was
performed. The header/card/field structure, 448px composition, 16px card radius,
24/32px padding, 40px fields, password reveal, four-segment progress, live checklist
and agreement row are preserved. Social/demo branding, name field and page-level
decorative backgrounds were removed.

`components/auth/auth-modal.tsx` provides one shared card. Welcome Log in,
unauthenticated demo Contact seller and protected listing-management entries
use it. Existing protected
route redirects to `/auth/sign-in?next=...` open the same card through a compatibility
entry. Welcome opens above the existing page. Native `dialog.showModal()` supplies
top-layer modal semantics and background interaction blocking; a local Tab loop
keeps focus inside the card. Escape, backdrop dismissal and focus restoration are
supported. Scroll locks restore previous values, including when an expanded
listing is already locking the page. Community Standards is a nested native
dialog and leaves signup state mounted.

### Modal routing and dismissal

Normal Welcome Log in, Ticket/Lanyard join and listing Contact seller entries
call `openAuth` on the current route. ShiningButton has no implicit legacy auth
URL: without an explicit `href` or handler, it opens the shared Sign in modal.
X, Escape and backdrop dismissal only clear the modal/pending intent and restore
focus and scroll locks; they never navigate or use browser history.

`/auth/sign-in` remains an isolated compatibility entry for direct links and
server redirects from `/listings/new`, `/listings/[id]/edit` and
`/profile/listings`. Its minimal underlying page is visible if that route is
visited directly and its modal is dismissed. Normal Welcome/listing auth triggers
must not navigate there. Password recovery uses code entry inside the shared
modal and does not require this compatibility route.

`tests/auth-dismissal.browser.cjs` records before/open/after URLs and verifies
X/Escape/backdrop dismissal and original context/focus restoration at
390/768/834/1280/1536px, using a logged-out mocked session. It covers Welcome
Login, Ticket taps (Lanyard keyboard activation on desktop) and expanded-demo
Contact seller; it also rejects transient navigation to a legacy route.
All 45 dismissal combinations passed on 2026-10-02, with unchanged URLs,
original contexts and restored trigger focus. Typecheck, scoped lint and the
production build with `--no-lint` passed for the fallback-entry change.

### Shared fade and repeatable Welcome interactions

The shared native dialog uses public Motion `AnimatePresence`, `motion.dialog`,
`useIsPresent` and `useReducedMotion`: opacity-only entrance is 220ms ease-out,
exit is 160ms ease-out. Matching scoped CSS keyframes fade its native backdrop.
The dialog remains mounted and keeps the page locked through dismissal exit;
unmount restores focus/scroll locks. Reduced motion makes these fades immediate.
No scale, y movement or private Motion APIs are used.

`openAuth` accepts an optional presentation-only `onDismiss` callback, called
after the exit finishes. Dismissal clears the pending intent immediately; auth
success retains the established post-auth destination/contact behavior and does
not call `onDismiss` or wait for a Ticket reset before navigating.

Lanyard owns one local 200ms join timeout, scheduled only after its qualifying
pointer release (or keyboard activation). It ignores duplicate pending requests,
clears its timer before opening auth and cancels it on unmount. Its drag/capture
cleanup and physics remain unchanged; no permanent trigger flag needs re-arming.

Ticket keeps its accepted tap/tear trigger timing. Its auth dismissal increments
only the Ticket's `resetToken`; an effect reuses its existing reset routine to
restore the untouched simulation, visibility, tilt and uncontrolled torn state.
The existing Ticket DOM and homepage stay mounted. This also makes a completed
tear repeatable after X, Escape or backdrop dismissal, including reduced motion.
The reset also focuses the restored stub, which was hidden when the original
modal trigger focus was captured.

Interaction validation on 2026-10-02: `tests/auth-interaction.browser.cjs` passed
at 390/768/834/1280/1536px with normal and reduced motion. It covers three completed
Ticket tear/reset cycles per mobile/tablet width, additional pointer tear/tap
checks, three real Lanyard drag/release cycles per desktop width, X/Escape/backdrop
dismissal, opacity-only presentation and preserved URLs. The timer is exactly
200ms; observed release-to-modal DOM timings were approximately 222–240ms,
including rendering. Existing `tests/auth-triggers.browser.cjs` passed at all
five widths with mocked auth transport, preserving success destinations and
contact context. Typecheck, scoped ESLint and `npm run build -- --no-lint` passed.
The legacy JSX components were not broadly reformatted; their runtime behavior
is covered by browser checks and the production compilation.

## Authentication and session

### Username and auth controls (2026-10-03)

Auth controls now adapt the supplied Animata Shift Tabs, React Bits Hold Button
and Velora Stateful Button source locally. Their styles are CSS Modules; no
Tailwind installation/configuration or shadcn initialization was added. Animata's
React `use(context)` is adapted to React 18 `useContext`. Arrows/Home/End move tab
focus; Enter/Space activates. There is no dragging. Mode content retains its
140ms-out/180ms-in fade on the existing mounted surfaces. The modal key boundary
now stops propagation during bubbling so these child keyboard handlers work.
At >=1024px the desktop Shift Tabs retain their face/tilt geometry, with only the
exposed backing/bottom edge changed to warm yellow #c4a35c. At <=1023px the same
mounted controls use the actual ExpandableCard Close two-layer solid structure and
shared action-button-sizing contract (the current reference says Close, not Cancel),
with neutral/inactive and purple/selected surfaces. Width is constrained to half the
available selector row using the shared gap; height/insets/radii/type/padding use
existing tokens. No mobile tilt/drag/swipe; resizing preserves form state. Primary
Log in is centered with flex/justify-content:center; its sizing/colors stay intact.
Hold idle text is exactly ?Hold to create account?, holdTime is 1000ms, and the
signup-only boundary is a restrained 1px #a99bb7 border. Existing focus ring remains.


Visible returning-user copy is **Log in**. Its primary action reuses Welcome's
green ShiningButton and the existing listing action sizing tokens on mobile.
Signup uses a one-second pointer or Enter/Space hold to invoke the existing form
submit handler once. Early release/cancellation submits nothing; completion is
not an account-success claim. Validation and server verification remain required.

Send code uses real Promise-driven idle/loading/success/error states. Its request
now rejects on failure rather than swallowing errors, with inline feedback next
to Verification code and a usable retry. Success/cooldown starts only after an
actual successful response. Signup diagnostics capture the original failing
`/auth/v1/signup` response via a clone before SDK/API mapping, preserving provider
status/code/message even when the SDK discards a 500 response's code. Only sanitized
server-side diagnostics are logged: request email/password are redacted, and known
passwords, OTPs, email addresses, keys and JWTs are removed from the message.
The original reported live HTTP 400 has **not yet been reproduced**: a failing
request/provider response or an owner-supplied test mailbox is still needed.
Mock transport results do not establish its cause or prove email delivery.

Username is signup-only: `^[A-Za-z0-9_]{3,20}$`, displayed with its chosen case.
Help remains contextual: 3–20 characters; letters, numbers and underscores only.
Availability checks are debounced 400ms, ignore stale responses and expose only
a boolean. Final validation never trusts this advisory result. The username is
locked after successful Send code so the verification stays bound to that name.
Action-button focus keeps the current help region still during a hold; another
primary input switches/collapses help. Password copy remains exactly `8+
characters`, `1 uppercase letter`, `1 number`, `1 symbol`, using the shared tests.
Agreement reads “I agree to the Marketplace rules”; its information action still
opens the unchanged Community Standards dialog.

The still-pending `supabase/migrations/202610030001_marketplace_usernames.sql` is
revised in place. It extends existing profiles with username, generated
lower(username) username_normalized and username_changed_at; the partial unique
index protects current names case-insensitively. Format remains 3?20 ASCII letters,
digits or underscores. Reserved names (case-insensitive): admin, administrator,
moderator, support, system, staff, official, western, uwo, campusmarketplace,
campus_marketplace. Client/server checks distinguish reserved names; availability
returns only boolean and includes current owners and active 30-day old-name holds.

Only valid, unique, non-reserved legacy display names are backfilled, preserving
capitalization and leaving username_changed_at NULL. Invalid, duplicate and reserved
legacy values stay NULL. Backfill is not an intentional change: the first deliberate
legacy rename/claim is immediate. The existing profiles_updated trigger refreshes
updated_at on eligible backfilled rows. No existing display_name is rewritten.

New Auth/profile creation is atomic and requires a valid available username;
the profile trigger starts cooldown at transaction now(). The authenticated verified
Western-only marketplace_change_username RPC operates on auth.uid(), with a profile
row lock and shared transaction advisory lock for name claims/releases. Renames
require 168 elapsed hours, update display_name and username_changed_at atomically,
and record old lowercase names in private username_history(profile_id,
previous_username_normalized,released_at), with an internal identity key. A case-only
rename counts and resets cooldown. Exact same spelling/case is a no-op, with no
history or timestamp change. Case-only changes to one's current normalized name
remain possible after cooldown even if prior case-only history exists.

Old names are unavailable for 30 days after release; afterward they may be claimed
if not current/reserved. History survives profile deletion for auditing and is not
readable by anon/authenticated. The RPC returns only the caller's current username
and next_change_allowed_at. The existing UPDATE(display_name) grant/RLS remain;
clients receive no username/normalized/timestamp write grants. The trigger also
prevents forged cooldown writes and keeps display_name aligned. Signup confirmation
confirms the owned name without performing a case-only rename or resetting cooldown;
a legacy NULL profile's deliberate first claim starts cooldown. Errors distinguish
invalid, reserved, taken and cooldown (with next allowed timestamp).

Username is the public marketplace identity through the existing `display_name`
mapping. Profile updates cannot replace it with an email. Auth email stays private;
availability RPCs return no emails or matching user identities. Legacy/new-cookie,
session, routing and Supabase OTP architecture are unchanged.

**Deployment pending:** the live availability probe returned `PGRST202` (RPC not
in the schema cache), confirming this migration still needs to be applied. No
service-role key or remote database administration was added. Existing Confirm
signup/Reset Password token templates and SMTP requirements below still apply.

Local PostgreSQL tests run both migrations and cover format, case collisions,
race enforcement, failed-insert rollback, verified ownership and public identity.
Browser tests intercept auth transport; they do not send email or deploy SQL.

Validation: typecheck and scoped lint pass. Component interactions, password rules,
contextual helpers, route-preserving dismissal and accepted interaction regressions
were checked at 390/768/834/1280/1536px. Login sizing matches the existing Close
contract on mobile/tablet and Welcome ShiningButton on desktop. The normal production
build is blocked by inherited CRLF lint errors in unrelated files; the production
build with `--no-lint` passes. No broad formatting changes were made.

All actions use `marketplaceRequest` and the existing same-origin Next auth API,
`createMarketplaceClient`, HTTP-only SameSite cookies and `requireMarketplaceUser`.
Western email validation comes from `lib/marketplace-auth.ts`; server API validation
and the existing database Auth email guard remain authoritative. The username
migration above extends profiles; existing RLS, browser token handling and password/
code storage remain unchanged.

- Sign in: `signInWithPassword`, then verified Western user check.
- Send signup code: `signUp({email,password})`, with email confirmation required.
  A returned authenticated session is signed out and reported as misconfiguration.
- Resend: `auth.resend({type:'signup',email})`; UI uses a 60-second cooldown while
  Supabase enforces real rate limits.
- Create account: `verifyOtp({type:'email',email,token})`, verified Western user
  check and username/profile confirmation. Signup keeps the real session and
  returns success without a second password write: `signUp` already assigned the
  password supplied when sending the signup code. Existing session refresh gates
  modal closure and join navigation to `/listings`.
- Recovery: `resetPasswordForEmail`, then `verifyOtp({type:'recovery'})` and
  `updateUser({password})` in the same card. Returning-user login has no code field.
- `lib/auth-password.ts` shares exactly the supplied rules between client/API:
  8 characters, one uppercase, one number, one symbol. Lowercase is not required.
- Signup agreement is unchecked initially and checked by both form and API. No
  durable consent audit/moderation system is claimed or added.

The session provider has an explicit refresh after auth. The shared entry API
takes an initial `mode` and explicit `login`, `join`, `contact-seller` or `navigate`
intent, with an optional destination. Explicit entries always open in place;
there is no seller-snapshot shortcut to navigation. Dismissal cancels the pending
intent; stale requests cannot consume a newer one. Welcome Log in opens Sign in;
Ticket tap/completion and Lanyard card release/keyboard activation open Sign up.
Login/join navigate to `/listings` only after auth and session refresh succeed.
Demo and real listing Contact seller open Sign in, then close auth and retain the
listing context without a notice, navigation or simulated messaging. Messaging
is not implemented. Sold real listings retain their disabled contact action.
Existing route loaders remain unchanged.

The modal is one scroll viewport containing three aligned surfaces: a compact
dark header, the preserved form card, and a secondary dark privacy/access footer.
The header/footer use the same border and radius language with 12px gaps. Only
the backdrop blurs; text stays crisp. The entire stack scrolls at short heights,
so header, form actions and privacy copy remain accessible while the page is locked.

## Required dashboard configuration / live acceptance

1. Enable Email provider, signup and **Confirm email**. Preserve the existing
   Western Before User Created hook and Auth email guard.
2. Set minimum password length to 8. Required-character configuration must match
   uppercase + digits + symbols; do not impose a new lowercase rule. The API
   enforces the supplied policy; direct Supabase calls obey dashboard policy.
3. **Confirm signup** and **Reset Password** email templates must display
   `{{ .Token }}` (not only a confirmation/recovery link). For example:
   `<p>Enter this code in Campus Marketplace: {{ .Token }}</p>`.
   Keep the legacy Magic Link template configured if its API is retained.
4. Keep custom SMTP, rate limits, suitable token expiry and the exact Site URL
   configured as described in `supabase-setup.md`. Code entry needs no new callback
   route. The password update follows a freshly verified Supabase session.
5. Existing OTP-only accounts can use Forgot password to establish a password.
6. Verify send/resend, a real signup token, real password login, expired/wrong codes
   and real recovery with a Western mailbox. Automated tests use mock transport
   and do not prove email delivery or dashboard configuration.

## Validation

`node tests/auth-modal-api.cjs` tests the real Supabase SDK with mock transport,
covering password/domain/consent validation, OTP and recovery requests, safe errors,
HTTP-only cookies and cross-origin rejection. Existing domain/session tests remain
applicable. `tests/auth-modal.browser.cjs` uses intercepted auth responses for UI,
focus, intent, short-height access and responsive checks at 390/768/834/1280/1536px.
Set `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE` and optionally `BASE_URL` to run it.
`tests/auth-triggers.browser.cjs` covers in-place triggers, initial mode,
post-auth destinations, contact with no fallback, three-surface alignment and
short-height access at all five widths. Its auth responses are intercepted.

Live mailbox/password verification remains manual; tests do not send email.

Validation completed 2026-10-02: typecheck and scoped ESLint passed. The auth API
mock-transport test and existing marketplace domain, session and PostgreSQL/RLS
tests passed (PGlite resolved from the existing external validation directory).
Browser UI/intent checks passed at all five widths, including a 420px-height
viewport and nested listing/standards dialogs. Production checks passed for
account settings Sign In/Sell/My Listings gates, the compatibility auth route,
backdrop dismissal/blur and actual API rejection of a non-Western address.
`npm run build` encountered inherited CRLF/Prettier lint errors in unrelated files;
`npm run build -- --no-lint` passed. No unrelated formatting changes were made.

The subsequent auth-trigger and surface pass also passed typecheck, scoped ESLint,
the mocked auth API test and `npm run build -- --no-lint`. Both browser suites
passed at 390/768/834/1280/1536px, including short-height scrolling, in-place
triggers and post-auth intents. Ticket pointer taps were tested at mobile/tablet
widths; Lanyard keyboard activation at desktop widths and a real mesh drag/release
at 1280px were verified. One desktop run reported an intermittent canvas
`addEventListener` error during navigation; the full repeated matrix passed
without that error. No Lanyard physics changes were made.

## Auth session reset and success reveal

Each explicit modal opening receives a new session key. All card state (including
password, OTP, agreement, cooldown and StatefulButton state) is local to that
instance and is discarded when dismissed or successfully authenticated. Email
can remain during mode switches within the same open instance. No form state is
stored across modal sessions.

Signup Hold readiness requires a valid Western email, a valid non-reserved
username whose availability has passed (or whose signup-code request succeeded),
all four password rules, a code sent for the current email and 6–10 entered digits,
and the rules agreement. The server remains authoritative for OTP verification
and username claims. Incomplete actions are disabled, with a visible helper;
pointer/keyboard interaction with the requirements group exposes local field
feedback. The Hold duration and border remain unchanged.

Send code starts its actual request immediately. StatefulButton uses parallel
settled promises for the request and a 200ms minimum loading interval, so slow
requests receive no additional delay and failed requests have the same minimum.

After login/signup API success and authenticated session refresh, the shared
`AuthSuccessReveal` native top-layer dialog remains mounted in AuthModalProvider
across navigation. Both graphite panels cover in 400ms, overlap by 2px at the
center, display Welcome back for at least 350ms while navigating, then reveal in
500ms. The auth modal is removed only behind the full cover. Navigation completion,
the Listings sort control mounting, and two animation frames gate the reveal.
Reduced motion uses 120ms opacity cover/reveal and a 150ms covered hold. A bounded
navigation/render failure restores a fresh modal with an error and releases the
overlay. Contact-seller continuation and password recovery retain their existing
behavior; normal dismissal and failed authentication do not use the reveal.

`tests/auth-success.browser.cjs` covers reset, readiness, fast/slow/failed send
loading and both authenticated success paths, with mocked auth responses. These
tests are not evidence of live Supabase signup acceptance. The actual remaining
signup-code root cause still requires the real server's sanitized
`Marketplace signup provider failure` status/code/message; username metadata is
already present and the redundant post-OTP password write remains removed.

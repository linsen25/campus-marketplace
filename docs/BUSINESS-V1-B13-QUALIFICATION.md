# B13 — Local Shop Settings qualification

2026-10-19. **B13 LOCAL IMPLEMENTATION COMPLETE.**
**B13 STAGING RUNTIME ACCEPTANCE NOT PERFORMED. B14 NOT STARTED.**

## Implementation and authority

The existing Settings owner editor now reads GET `/api/shop` and saves only the
edited name/category/description field through its existing PATCH. One
`useOwnShopProfile` instance above Home's desktop/mobile branches owns confirmed
data; the Settings instances are keyed by authenticated owner. Ordinary Profile
presentation and explicitly injected demo fixtures remain separate.

`OwnerShop.name` maps to `shopName`; the Shop URL still uses the existing account
Profile username. No duplicate username, entitlement fields, owner API, editor,
Auth system, provisioning call or membership gate was introduced. Suspended owners
retain private editing under existing RLS. No category enum was widened; discovery
taxonomy remains later-task scope.

GET/PATCH return a SHA256 ETag derived from the fixed owner DTO, including its exact
PostgreSQL timestamp string. The client does not convert it through JavaScript
Date. PATCH optionally accepts one strong If-Match token. Missing condition keeps
legacy behavior; malformed/unsupported conditions return 400, stale conditions
return 409, and an absent owner Shop remains 404. Conditional UPDATE atomically
filters by owner, Shop ID, exact updated_at and editable preimage. A read alone is
never used as concurrency protection. Legacy unconditional writers remain supported;
they have not acquired conditional protection automatically.

The editor freezes its base version. Synchronous guards prevent duplicate writes.
Old GETs and previous-account/unmounted responses cannot replace current data.
Conflicts preserve input, refresh confirmed data and require close/reopen to review
before a new save. An uncertain PATCH response triggers GET reconciliation before
another write; matching authoritative values confirm convergence without claiming
which request produced it. Failed reconciliation remains uncertain and is retried
before any subsequent PATCH. Background GET failure retains confirmed data/input;
401 clears private Shop data/editor. Focus/reopening can retry without a new control.

## Approved UI exceptions only

- Live caption: `Changes are saved to your Shop profile.` Explicit fixture editors
  retain the fixture-only caption.
- Replace Pro-only availability copy with truthful loading, no-Shop, anonymous or
  fetch-error feedback in the existing location.
- Surface safe save/conflict errors in the existing editor error area.
- Remove only Settings' fixed PRO badge; shared badge implementation and other
  surfaces remain unchanged.

No CSS, layout, dimensions, field limits, button text, colors, transitions, shared
dialog/scroll-lock or navigation redesign. Existing three Change dialogs and Save
pending/error interaction are reused.

## Local evidence

| Check | Result / boundary |
|---|---|
| `node tests/shop-profile.cjs` | PASS actual API/repository, original B11 POST/GET/PATCH, validation/auth/ownership/origin, optional condition, exact precision, stale 409, atomic preimage race, malformed tokens and legacy compatibility |
| `node tests/shop-settings-b13.cjs` | PASS actual typed transport/mapping, partial payloads, statuses, exact timestamp preservation, both responsive bindings and no POST |
| `node tests/shop-settings-b13-db.cjs` | PASS real disposable loopback PostgreSQL, current migration prerequisites, existing RLS, Suspended owner, anonymous/cross-owner/authority-field/invalid-value denial, microseconds and two observed lock-contending conditional UPDATEs: one winner, stale contender zero rows |
| `node tests/shop-provisioning-b11-db.cjs` | PASS existing native provisioning/permissions/migration and concurrency regressions |
| `node tests/shop-membership-b12.cjs` | PASS existing membership API/repository regression; B12 implementation untouched |
| `tests/shop-settings-b13.browser.cjs` | PASS 10/10: real hook/ProfileOverview/ShopSettings/editor with controlled local API fixtures; five widths and both motion modes. This is not a hosted/Staging E2E test |
| `tests/shop-surfaces.browser.cjs` | BLOCKED before browser assertions: existing Webpack cannot parse static initialization blocks in `@radix-ui/react-collection/dist/index.mjs`, reached through the unrelated Analysis import. No loader/dependency/Analysis workaround applied; not reported PASS |
| Application-source TypeScript | PASS `tsc --noEmit --incremental false` using current tsconfig (existing generated artifacts excluded) |
| Focused ESLint / Prettier | PASS seven B13 application sources; Prettier also passes five touched/new JavaScript test files |
| Diff/new files | PASS `git diff --check` and explicit new-file/document encoding/trailing-whitespace/final-newline checks |

Browser checks cover 390/430/820/1280/1536: partial saves and reopen persistence,
required input, no fixed Settings badge/shared badge retained, error versus absent,
conflict without replay, response loss and failed reconciliation retry, synchronous
duplicate guard, pending Escape behavior, current username URL, shared data across
responsive branch remount, stale GET/PATCH after account switches, expired session,
logout/focus cleanup, dialog bounds and document overflow. Additional checks verify
background GET failure preserves input and a delayed GET cannot overwrite PATCH.
Screenshots are local ignored artifacts under
`tests/artifacts/message-payload-qualification/b13-{editor,loaded,settings}-*.png`.

The old Webpack fixture builder needs `NODE_OPTIONS=--openssl-legacy-provider` on
Node 24; no application dependency or global loader was changed. Browser actions
wait for existing dialog entrance animations before manipulating/snapshotting it.
The native server could not start inside the Windows sandbox (restricted-token
error); the same local-only test passed with tool-approved process escalation.
An initial native output assertion incorrectly included post-commit output; parsing
was corrected without changing the database/app behavior or row-count requirement.
An added screenshot/input sequence timed out once before waiting for entrance
animation completion; the focused desktop repeat and final full 10-case run passed
after the test awaited the existing animation. No shared dialog change was made.

## Changed files for this task

Application:

- `lib/shop-profile-api.ts` (new)
- `hooks/use-own-shop-profile.ts` (new)
- `lib/server/shop-profile-repository.ts`
- `pages/api/shop.ts`
- `components/home/animated-sidebar-demo.tsx`
- `components/home/profile-overview.tsx`
- `components/shops/shop-settings.tsx`

Tests:

- `tests/shop-settings-b13.cjs` (new)
- `tests/shop-settings-b13.browser.cjs` (new)
- `tests/shop-settings-b13-db.cjs` (new)
- `tests/shop-settings-b13-db.sql` (new; isolated test fixture, not a migration)
- `tests/shop-profile.cjs`
- `tests/shop-surfaces.browser.cjs` (only obsolete Settings no-Shop text assertion)

Documentation: this qualification, B13 plan status and task progress. Existing
unrelated working-tree modifications were preserved, not attributed to B13.

## Safety and deferred acceptance

No remote request or Supabase CLI command, Staging write, environment/secret
modification, migration creation/deployment, email, payment, existing business-data
deletion or Git mutation. Test data writes were confined to newly initialized
temporary loopback databases and in-memory browser fixtures; native servers stopped.
No access to Production.

Real session/HTTP/PostgREST timestamp round-trip and cross-device persistence on
Staging still need separate explicit runtime acceptance authorization and an agreed
temporary-resource retention/cleanup boundary. This is application/API deployment
scope, not a new database migration. No Shop provisioning/Trial/publication or later
Shop feature is activated by B13.
The legacy combined Shop-surfaces browser build limitation also remains explicitly
unresolved. B13-specific real-component coverage passes; it does not substitute for
that entire legacy Profile/Analysis fixture suite or claim hosted acceptance.

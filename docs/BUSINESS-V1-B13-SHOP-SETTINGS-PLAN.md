# B13 — Shop Settings persistence integration plan

2026-10-19. **Historical approved plan; local implementation subsequently authorized.**
Implementation and validation results: [B13 qualification](BUSINESS-V1-B13-QUALIFICATION.md).
The proposals below record the planning baseline; they do not authorize remote work.
The official B13 task row matches this scope: connect the existing owner editor to
GET/PATCH `/api/shop`, preserving validation, ownership and the frozen UI.
B11/B12 migrations have been deployed and read-only verified; their managed
runtime write acceptance is still deferred. No remote operations in this task.

## A. Existing reusable implementation and exact gap

- `components/shops/shop-settings.tsx`: existing three field rows, Change buttons,
  `ShopEditor`, FadingDialog, Sort-language category select, pending/error handling
  and StatefulButton. Name40/description200 and the four `shopCategories` match
  `shopIdentityError` and the current owner API. Do not import discovery taxonomy
  or silently widen the database enum; that separate mismatch remains for B15.
- `ProfileOverview` already fetches `/api/profile/account` and passes its username
  to Shop Settings; successful username edits already update that account state.
  It forwards optional `shopPreview/onShopSave` fixture props.
- Both real Settings branches in `animated-sidebar-demo.tsx` omit those props, so
  real users see placeholders, no Change controls and `Available with Shop Pro`.
  Existing browser tests inject in-memory fixtures; no live Shop save is wired.
- `pages/api/shop.ts`, `shop-profile-repository.ts`, `lib/shop-profile.ts` and
  `types/shop.ts` already implement session-bound GET/PATCH (and B11 POST), strict
  whitelist, owner RLS, same-origin writes, fixed DTO and safe errors. Reuse them.
- `useMarketplaceSession`, `marketplaceRequest`, and the owner/generation pattern
  in `useFinancialCapabilities` provide existing session/request conventions.
  StatefulButton already guards its pending click; preserve its animation.

No new Shop table, Settings API, Auth system, editor, page or navigation is needed.

## B. Mapping and authorization

Keep the returned `OwnerShop` as the confirmed source, separate from editor draft:

| Owner/account source | Existing presentation | Saved payload |
|---|---|---|
| `OwnerShop.name` | `shopName` | `{name: trimmedValue}` |
| `OwnerShop.category` | `category` | `{category: value}` |
| `OwnerShop.description` | `description` | `{description: trimmedValue}` |
| `OwnerShop.ownerId` | `sellerProfileId` | Never submitted as authority |
| Authenticated Profile `username` | existing `/shop/<username>` URL | Never written to Shop |

Validate that live response ownership matches the current session before display.
Keep Shop `id`/timestamps for identity and request reconciliation; do not add them
to editable bodies. `ShopPreview` here is a typed display adapter only, not proof
of membership or public eligibility. No fabricated images/stats/tier fields.

Live flow: existing session -> owner GET -> confirmed DTO -> existing editor ->
single-field PATCH -> confirmed server response. Only a confirmed/reconciled save
closes the existing editor. Refresh/reopening performs GET again.

Ownership authorizes private management, including Suspended and both Plus/Pro.
Do not consult B12 as an editor gate, call provisioning POST, activate Trial,
change membership, or enable public visibility. A missing username affects only
the URL display; it must not prevent an authenticated Shop owner editing fields.

## C. Smallest proposed file changes (all require later approval)

| File | Exact change |
|---|---|
| New `lib/shop-profile-api.ts` | Typed GET/partial PATCH transport and display mapping using existing credentials/no-store/custom-header conventions. Preserve HTTP status and ETag for truthful session/conflict handling; no duplicate authorization. The generic `marketplaceRequest` currently discards HTTP status and cannot send a conditional header, so leave that shared helper unchanged. |
| New `hooks/use-own-shop-profile.ts` | Enabled only for live Settings; use existing session context, distinguish loading/absent/ready/error, owner+generation scopes, confirmed record, synchronous save guard and stale-response invalidation. No localStorage or entitlement cache. |
| `components/home/profile-overview.tsx` | Use the hook only for live Settings; retain explicit fixture injection separately. Pass confirmed mapping, load/error state and save adapter; continue using the existing Profile username. Do not change the ordinary Profile branch. |
| `components/home/animated-sidebar-demo.tsx` | Key only the two existing Settings `ProfileOverview` instances by current session owner so account switches cannot reuse the previous account/username/editor state. No navigation/layout changes. |
| `components/shops/shop-settings.tsx` | Consume explicit states, separate editable owner readiness from username/public membership, capture editor base snapshot, wire existing save/error/pending flow, and apply only the specifically approved text/badge exceptions in section E. No new editor or CSS. |
| `pages/api/shop.ts` | Add owner GET/PATCH ETag response and optional If-Match handling to the existing route. Preserve JSON DTO, error envelope, methods, origin/auth checks and B11 POST behavior. |
| `lib/server/shop-profile-repository.ts` | Conditional owner PATCH support described below; retain current field validator and RLS. No new RPC/table/schema or broad privileged client. |
| New focused tests | `tests/shop-settings-b13.cjs`, `tests/shop-settings-b13.browser.cjs`; extend `tests/shop-profile.cjs` for the conditional path while retaining existing unconditional/POST assertions. Extend the existing native Shop test infrastructure for real two-session conditional updates if needed. |
| Documentation | B13 qualification/progress only after implementation; do not rewrite B10/B11/B12. |

`lib/shop-profile.ts`, `lib/shop-presentation.ts`, `types/shop.ts`, the shared
badge, FadingDialog, StatefulButton, CSS and existing database migrations need no
change under this plan. No new public route; the existing owner API is retained.

## D. Stale writes, duplicate saves and failure recovery

Current PATCH is partial but has no version precondition: client response tokens
alone cannot reject an old editor's write at the database. Propose a small
backward-compatible conditional path on the existing API, not a new save system:

1. GET returns an opaque ETag derived from the authoritative owner DTO (including
   ID, editable values and exact updatedAt). No timestamp precision conversion.
2. Opening an editor freezes its base snapshot/ETag. A background GET must not
   silently replace that base while leaving an old input value in the editor.
3. B13 PATCH always sends that If-Match and exactly one editable field. The server
   first resolves the authenticated owner, compares the token, then atomically
   filters UPDATE by actual owner/Shop ID and the observed timestamp and editable
   preimage. This prevents intervening changes between read and update, including
   a timestamp collision with changed field values. Zero updated rows => safe409.
4. Keep existing callers without If-Match backward-compatible. The new B13 flow
   has conditional protection; do not claim legacy unconditional clients become
   globally conflict-free. No new revision column/migration is proposed.
5. A synchronous per-owner in-flight guard prevents rapid duplicate submissions;
   no automatic queued stale PATCH. Different fields still send partial bodies.
   On successful PATCH use the actual returned DTO/ETag, never a shallow optimistic
   full-form overwrite or a response belonging to a previous user/generation.
6. Ignore/invalidate GETs started before a save and responses after unmount/logout
   or account switch. Do not start a focus refresh during an active write.
7. On409 keep the edit open and its draft, refresh the confirmed record separately,
   and ask the user through the existing error area to close/reopen and review it.
   Do not silently retry an old draft with a fresh token.
8. A lost PATCH response is uncertain, not proof of failure. Reconcile via owner
   GET before another write. If the canonical target field already equals the
   requested value, confirm the resulting state; otherwise keep the confirmed
   data/error and require review. Never promise which request caused convergence.

The optional conditional API extension is part of the requested next approval;
it is not already implemented. Ownership/whitelist authorization remains mandatory
with or without an ETag, which is a concurrency token, not an authorization token.

## E. Exact required UI V1 exception proposal

Only the existing Settings Shop surface/editor and its data lifecycle change.
Preserve geometry, limits, controls, typography, colors, animation, focus handling,
responsive layout and all shared components. No CSS, new Retry/Create button,
dialog, page, navigation, Pricing Card or Shop Plans change is proposed.

Required visible copy, for separate explicit approval:

- Live editor caption: replace `UI fixture editor · Changes are not saved to a
  real Shop.` with `Changes are saved to your Shop profile.` Keep fixture wording
  only in explicitly injected demo mode; never use demo data after a live error.
- Replace the inaccurate inactive `Available with Shop Pro` with truthful states
  in that existing status slot: `Loading Shop settings…`, `Log in to manage your
  Shop.`, `Your account does not have a Shop yet.`, or `Unable to load Shop
  settings. Reopen Settings to retry.` No upsell or implied activation.
- Use the existing editor error area for backend/expired-session/conflict feedback.
  For a version conflict: `Your Shop changed elsewhere. Close and reopen this
  editor to review the latest information.` No new controls or toast system.
- **Separate badge decision:** this Settings header unconditionally renders
  `<ShopProBadge />`, whose default text is PRO. It is not actual tier data.
  Recommend removing only this fixed Settings header badge, leaving the Shop
  heading, shared badge component and every other surface untouched. Do not
  implement that removal without explicit approval; do not fetch membership merely
  to enable the editor or substitute PLUS+ for another unverified entitlement.

Loading/errors reuse current caption/error styling. Normal loaded rows stay the
same; truthful status/error text can appear only in the existing feedback locations.
These copy/conditional-rendering changes are UI exceptions, not silently authorized
bug fixes. No application/UI change has been made during planning.

## F. State behavior

| State | Proposed behavior |
|---|---|
| Session unknown / GET pending | Preserve row shell/placeholders and status slot; editing unavailable until confirmed owner data; no fake Shop |
| Anonymous | Login guidance in existing slot; no owner request/write or new navigation |
| GET200 null | No-Shop guidance; no editor, POST, Trial or automatic provisioning |
| Owned Shop, including Suspended | Show persisted fields and existing Change controls; membership does not gate private management |
| Missing username | Existing URL placeholder only; keep owner fields editable |
| GET failure | Distinguish error from absent Shop, no fixture fallback; reopen/focus can retry GET, no new button |
| PATCH failure | Keep editor/draft and last confirmed data, existing error area, allow deliberate retry after reconciliation |
| Session expires during edit | Safe auth feedback, invalidate previous user data and editor scope; never report save success or silently resubmit after login |
| Rapid saves / old responses | Synchronous write guard, conditional base token, owner/generation checks; no duplicate writes or stale replacement |
| Username changes | Existing account response updates URL; no Shop PATCH, new Shop, membership change or username storage in Shop |

## G. Focused local qualification plan

No tests run during this planning task. After approval:

- Real component/API-client flow with controlled local GET/PATCH transport: persisted
  fields, each single-field body, server normalization, reload/reopen persistence,
  unchanged limits/categories, and authoritative username URL updates.
- Actual API/repository tests: owner/current Auth, anonymous/unverified/cross-account
  denial, whitelist, bad fields, no Shop, Suspended access without membership calls,
  conditional token conflict/atomic preimage, and existing B11 GET/PATCH/POST.
- Delayed GET versus PATCH, duplicate clicks, overlapping editors/tabs, lost response,
  409 refresh without auto-resubmit, expired session, logout/account-switch/unmount
  late events. Same-field stale write must not overwrite newer confirmed data;
  different-field changes must never send a stale full profile.
- Use existing isolated native PostgreSQL conventions for conditional-update races,
  ownership/RLS and persisted values; no remote fixtures. No grant/Trial/paid call,
  no Resale write and no change to existing publication denial/public Shop source.
- Extend the fixture seam tests separately; demo mode never calls live owner API.
  Update only assertions made obsolete by explicitly approved copy/badge changes.
- Browser widths 390/430/820/1280/1536, normal and reduced motion: existing dialog,
  dropdown portal, keyboard/focus/Escape/pending close rules, no overflow or normal
  layout drift. Compare the original row/dialog geometry; no shared CSS changes.
- TypeScript, focused ESLint/Prettier, focused regressions and diff/new-file checks.

## H. Safety and smallest next approval

This task changes only this document and task progress. No application/UI/CSS,
migration, database, remote, environment, payment, existing data or Git mutation.
No credentials inspected. No B14, Shop creation, Trial or membership activation.

Next approval must explicitly cover: local-only wiring in section C; existing
editor pending/error lifecycle; the precise copy and Settings-only badge exception
in section E; optional conditional PATCH/ETag extension; and offline/native/browser
tests. No schema/migration is currently required. Staging runtime write acceptance
requires another separate authorization and an agreed test-resource retention plan.

**Stop after planning. Do not implement until the UI/API integration scope is approved.**

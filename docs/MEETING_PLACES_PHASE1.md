# Meeting and Google Places — Phase 1

The fulfillment display name is **Meeting**. Internal `on_campus` / `ON_CAMPUS`
values are unchanged. Create/Edit now presents only Meeting/Delivery fulfillment;
the old Place selector is removed there. Historical pickup values and unrelated
filters/category taxonomy are preserved. Delivery economics and lifecycles are unchanged.

## Authority and retention

The authoritative label is the final text submitted by the user. Selecting a Google
suggestion fills the editable input with its user-facing primary text and associates
its Place ID. The user can continue editing or submit free text without selecting
anything. Any manual edit clears the reference conservatively. A Google association
is input assistance, not verified transaction wording or location authenticity.

- Listing DTO: optional `meetingLocation: { label, provider?, placeId? }`.
- Listing columns: nullable `meeting_location`, `meeting_location_provider`,
  `meeting_place_id`; legacy rows require no backfill.
- V2 Meeting terms: required `meetup_location`, optional paired
  `meetup_location_provider` / `meetup_place_id`.
- Provider is `google` when present; free text remains valid without a reference.
- Accept freezes the existing complete Offer terms in `orders.terms_snapshot.terms`.
  Historical display uses frozen wording, never live Listing or Google content.
- Only the final submitted label and optional reference are persisted, not a separate
  Google name/address cache, coordinates, candidate lists, raw responses or tokens.
  Historical text never requires a Google lookup.

Offer location initialization: existing Offer → structured Listing default → empty.
Legacy pickup-area values are never used to seed new transaction locations.
Changed terms compares normalized human wording; metadata alone is not a new
technical changed-field label, and a shared Place ID never hides changed wording.

## Transport and UI

Authenticated, same-origin POST routes `/api/places/autocomplete` and
`/api/places/details` use Google Places API (New) server-side. The exact staging
environment and project URL are required. `scripts/dev-staging.cjs` forwards only
the staging file's server-only `GOOGLE_PLACES_API_KEY`; it is never public config.
Responses are `private, no-store`, inputs and body size are bounded, upstream calls
time out after five seconds, and errors are sanitized.

Autocomplete is restricted to Canada and biased toward Western/London. A random
session token is reused through autocomplete and selected Details, then discarded.
The shared controlled input debounces 275 ms, aborts/ignores stale work, supports
keyboard and pointer selection, and leaves manual text usable on provider failure.
Results show the Google Maps attribution. Google content is not analytics/log data.

The rate safeguard is bounded **per-process**, not a durable distributed limiter.
Before any separately authorized production rollout, review distributed quotas,
server-key API/IP restrictions, current Google attribution/policy requirements and
public Terms/Privacy disclosures. No production rollout is authorized here.

## Staging migration and qualification

Applied only to `pcaqxezdfxofysghssyo`:

`202610150001_meeting_location_references.sql`

SHA-256: `fb981cbb60471e2332679d3884f0828ab66226e4858664dd8eb89eddda23fd8e`

The additive migration adds Listing defaults, validates paired references and
extends the existing V2 validator/changed-field helper. It preserves existing
schedule, amount, Delivery and unknown-key guards. Existing RLS remains in force.
The stateless reference CHECK helper is executable by authenticated Listing writers;
it exposes no table data. No historical migration was edited.

Useful checks (browser fixture builds must run serially):

```text
node tests/places-api.cjs
node tests/meeting-location.cjs
node tests/meeting-location-db.cjs
node --openssl-legacy-provider tests/meeting-location.browser.cjs
node --openssl-legacy-provider tests/meeting-offer.browser.cjs
node tests/meeting-places-staging.cjs verify
node tests/meeting-places-staging.cjs qualify
node tests/meeting-places-live.cjs
```

The staging runner checks the exact target, migration ledger bytes, deployed
function bodies, grants, and fingerprints. `qualify` uses isolated synthetic rows
inside a rollback-only transaction for real Offer Accept/snapshot/Listing-edit
checks. It does not upload media: its private media receipt is SQL-only and rolled
back. The live browser check uses ignored existing Demo credentials, opens Create
Listing, searches/selects actual Google results and never submits the form.

Verified responsive widths: 390, 430, 820, 1280, 1536. Existing Offer compact media,
carousel and stateful action regression tests remain separate.

## Deferred scope

Post-acceptance `order_meetup_revisions` remains its existing separate system; its
formal editing UI is not mounted. Phase 2 should extend revision references together
with that UI rather than infer a new reference from edited text. No embedded map,
geocoding, route/distance calculation, QR implementation or new provider is added.

Official reference: [Autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete),
[Details](https://developers.google.com/maps/documentation/places/web-service/place-details),
[sessions](https://developers.google.com/maps/documentation/places/web-service/place-session-tokens),
[policies](https://developers.google.com/maps/documentation/places/web-service/policies).

## Focused Listing fulfillment completion

Create/Edit requires a free-text Meeting location for **both** fulfillment choices.
Legacy Listings still load; saving requires the Seller to supply their own location.
Google remains optional. The existing fulfillment field contains the selector,
existing helper, Meeting location, then (Delivery only) Estimated delivery fee.
No form layout CSS, Photos/Description placement, preview geometry or buttons change.
Only the visible `Choose 1-6 photos.` validation hint is suppressed; photo limits
and upload validation remain intact.

Listing DTO `estimatedDeliveryFeeCents` defaults to zero for legacy reads. The form
reuses `parseOfferAmount` for decimal-to-integer cents: blank/0/0.00 → 0,
10.50 → 1050; negative, fractional cents and unsafe integers are rejected.
New Delivery Offers seed from the Listing estimate (or 0); Revise/Counter preserves
the existing Offer's own fee. That fee remains negotiable. Order terms/economics
continue freezing the **accepted Offer** fee, never the live Listing estimate.

New staging migration: `202610150002_listing_fulfillment_defaults.sql`.
SHA-256: `49384294cc5539f541f7edaa6892e20ea6b2abc0406b60db6e850dc83fa10e8c`.
It adds `estimated_delivery_fee_cents bigint NOT NULL DEFAULT 0`, constrained to
0..9007199254740991, with existing authenticated Listing column write permissions
and a non-available Listing edit guard. It makes the legacy `pickup_area` nullable
without deleting/backfilling its historical values. The existing generated search
expression uses `coalesce(pickup_area,'')` so new null values do not erase search
text; existing non-null rows produce identical results.

Qualification: local validation/actual repository round trips, real form component
tests at 390/430/820/1280/1536, OfferEditor defaults/Revise/Counter tests, actual DDL
in local PostgreSQL, and staging rollback-only synthetic acceptance/economics tests.
Staging tests verify that a Listing estimate of 1000 and negotiated Offer fee of
800 produce an Order frozen at 800; changing the Listing estimate to 2000 later
does not alter historical Offer/Order terms or economics. Existing row fingerprints
remain unchanged and no synthetic fixtures persist. No canonical/manual data is
used for transition testing. Live localhost:3000 Google checks submit no forms.

```text
node tests/listing-fulfillment.cjs
node tests/listing-fulfillment-repository.cjs
node tests/listing-fulfillment-db.cjs
node --openssl-legacy-provider tests/listing-fulfillment.browser.cjs
node tests/listing-fulfillment-staging.cjs verify
node tests/listing-fulfillment-staging.cjs qualify
```

Files for this completion (in addition to earlier Phase 1 work):

```text
components/listings/listing-form.tsx
components/listings/published-listing-card.tsx
components/home/offer-ui.tsx
types/listing.ts
lib/listing-builder.ts
lib/listing-validation.ts
lib/supabase/listing-mapper.ts
lib/server/supabase-listings-repository.ts
supabase/migrations/202610150002_listing_fulfillment_defaults.sql
tests/listings-v1.cjs
tests/meeting-location.cjs
tests/meeting-offer.browser.cjs
tests/meeting-places-live.cjs
tests/listing-fulfillment.cjs
tests/listing-fulfillment-repository.cjs
tests/listing-fulfillment-db.cjs
tests/listing-fulfillment.browser.cjs
tests/listing-fulfillment-staging.cjs
docs/MEETING_PLACES_PHASE1.md
```

## Phase 1 file inventory

```text
components/home/agreement-card.tsx
components/home/formal-orders.tsx
components/home/offer-ui.tsx
components/home/order-stage-details.tsx
components/listings/listing-form.tsx
components/listings/published-listing-card.tsx
components/listings/meeting-location-input.tsx
components/listings/meeting-location-input.module.css
lib/listing-builder.ts
lib/listing-validation.ts
lib/meeting-location.ts
lib/offer-changes.ts
lib/offers-api.ts
lib/server/offers-service.ts
lib/server/places-service.ts
lib/server/supabase-listings-repository.ts
lib/supabase/listing-mapper.ts
pages/api/places/[action].ts
scripts/dev-staging.cjs
types/listing.ts
types/offer.ts
types/meeting-location.ts
supabase/migrations/202610150001_meeting_location_references.sql
tests/places-api.cjs
tests/meeting-location.cjs
tests/meeting-location-db.cjs
tests/meeting-location.browser.cjs
tests/meeting-offer.browser.cjs
tests/meeting-places-staging.cjs
tests/meeting-places-live.cjs
docs/MEETING_PLACES_PHASE1.md
```

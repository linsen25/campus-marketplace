// Local source and DTO contract checks only. No provider, database, or hosted project access.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const mod = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
  )(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    mod,
    mod.exports
  )
  cache.set(full, mod.exports)
  return mod.exports
}

const { validateListingInput } = load('lib/listing-validation.ts')
const base = {
  title: 'Shop location contract',
  description: 'A local contract fixture.',
  price: 1200,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  expectedImageCount: 1,
  photoUrls: [],
  preferredFulfillment: 'ON_CAMPUS',
  meetingArea: 'OTHER',
  meetingLocation: {
    label: 'Fixture Place',
    provider: 'google',
    placeId: 'fixture_1',
  },
  meetingLocationDetail: 'North entrance',
  estimatedDeliveryFeeCents: 0,
}
for (const preferredPaymentMode of [
  'uu_pay',
  'external',
  'in_person',
  'interac_etransfer',
]) {
  assert.equal(
    validateListingInput({ ...base, preferredPaymentMode })
      .preferredPaymentMode,
    preferredPaymentMode
  )
}
assert.throws(
  () =>
    validateListingInput({
      ...base,
      meetingLocationDetail: 'x'.repeat(101),
    }),
  /Location detail/
)

const migration = fs.readFileSync(
  'supabase/migrations/20261116010000_shop_listing_location_public_projection.sql',
  'utf8'
)
for (const required of [
  "'meeting_area'",
  "'meeting_location_detail'",
  'char_length(v.meeting_location_detail) not between 1 and 100',
  'meeting_area,meeting_location,meeting_location_provider,meeting_place_id,meeting_location_detail',
  "'meetingArea',p_listing.meeting_area",
  "'meetingLocationDetail',p_listing.meeting_location_detail",
  "'shop',jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username)",
  'join public.shops s on s.owner_id=p.id',
])
  assert.match(
    migration,
    new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )
assert.match(
  fs.readFileSync(
    'supabase/migrations/202610190005_public_shop_projection.sql',
    'utf8'
  ),
  /marketplace_private\.public_shop_eligibility/
)

const details = fs.readFileSync(
  'components/listings/published-listing-details.tsx',
  'utf8'
)
for (const required of [
  'Cash / In-Person',
  'Interac e-Transfer',
  'Pay outside UU',
  'Meeting area',
  'Meeting place',
  'Location detail',
  'Delivery estimate',
  'listing.shop?.shopName',
])
  assert.match(
    details,
    new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )

const preview = fs.readFileSync('components/listings/home-listings.tsx', 'utf8')
const review = fs.readFileSync('components/listings/listing-form.tsx', 'utf8')
const publishedCard = fs.readFileSync(
  'components/listings/published-listing-card.tsx',
  'utf8'
)
assert.match(
  preview,
  /<PublishedListingDetails listing=\{listing\} showPrice \/>/
)
assert.match(review, /<PublishedListingDetails listing=\{preview\} \/>/)
assert.match(
  publishedCard,
  /const shopReadOnly = listing\.listingChannel === 'shop'/
)
assert.match(publishedCard, /const canInteract = !own && !shopReadOnly/)

console.log(
  'PASS Shop/Resale location, payment labels, trusted Shop projection, owner preview, and review contracts; zero network.'
)

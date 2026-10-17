const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
function load(file) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText
  )(
    (name) =>
      name === '@/lib/listings-api'
        ? {
            marketplaceRequest() {
              throw Error('No network')
            },
          }
        : load(name.replace('@/', '') + '.ts'),
    module,
    module.exports
  )
  return module.exports
}
const { offerEconomics } = load('lib/offer-economics.ts'),
  { offerPayload } = load('lib/offers-api.ts'),
  { offerChangedFields } = load('lib/offer-changes.ts')
const terms = {
  fulfillment: 'on_campus',
  itemAmountCents: 10000,
  currency: 'CAD',
  note: '',
  meetupLocation: 'Weldon',
  scheduledAt: '2026-10-20T18:00:00Z',
}
assert.equal(offerEconomics(terms).fee, 100)
assert.deepEqual(offerEconomics({ ...terms, paymentMode: 'external' }), {
  item: 10000,
  delivery: 0,
  fee: 0,
  total: 10000,
  sellerFee: 0,
  sellerGross: 10000,
})
assert.equal(offerPayload(terms).payment_mode, 'uu_pay')
assert.equal(
  offerPayload({ ...terms, paymentMode: 'external' }).payment_mode,
  'external'
)
assert.equal(
  offerPayload({ ...terms, paymentMode: 'external' }).payment_mode_version,
  1
)
assert.equal(
  offerPayload({
    ...terms,
    fulfillment: 'delivery',
    paymentMode: 'external',
    deliveryFeeCents: 1000,
    deliveryMethod: 'courier',
  }).payment_mode,
  'uu_pay'
)
assert(
  !offerChangedFields({ ...terms, paymentMode: 'uu_pay' }, terms).includes(
    'Payment method'
  )
)
assert(
  offerChangedFields({ ...terms, paymentMode: 'external' }, terms).includes(
    'Payment method'
  )
)
assert.equal(offerEconomics({ ...terms, itemAmountCents: 500000 }).fee, 500)
console.log(
  'PASS explicit payment version, UU legacy default, external zero fee, negotiated change comparison, Delivery UU-only payload, UU cap unchanged'
)

const { validateListingInput } = load('lib/listing-validation.ts')
const listing = {
  title: 'Synthetic listing',
  description: '',
  price: 10000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Computers & Tablets',
  photoUrls: [],
  expectedImageCount: 1,
  preferredFulfillment: 'ON_CAMPUS',
  meetingLocation: { label: 'Weldon' },
  preferredPaymentMode: 'external',
}
assert.equal(validateListingInput(listing).preferredPaymentMode, 'external')
assert.equal(
  validateListingInput({ ...listing, preferredPaymentMode: undefined })
    .preferredPaymentMode,
  'uu_pay'
)
assert.equal(
  validateListingInput({ ...listing, preferredFulfillment: 'DELIVERY' })
    .preferredPaymentMode,
  'uu_pay'
)
assert.throws(() =>
  validateListingInput({ ...listing, preferredPaymentMode: 'unknown' })
)
console.log(
  'PASS Meeting Listing preference/default and Delivery fixed UU validation'
)

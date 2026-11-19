/* Task B contract guard: shared Listing wizard / local migration only. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const form = read('components/listings/listing-form.tsx')
const builder = read('lib/listing-builder.ts')
const validation = read('lib/listing-validation.ts')
const migration = read(
  'supabase/migrations/20261116020000_optional_listing_subcategory.sql'
)
const deliveryMigration = read(
  'supabase/migrations/20261116030000_delivery_interac_listing_preference.sql'
)
const toolbar = read('components/listings/home-listings.tsx')
const wizardCss = read('components/multi-step-form.module.css')
const glide = read('components/ui/GlideSelect.jsx')

assert.match(
  builder,
  /price: listing \? \(listing\.price \/ 100\)\.toFixed\(2\) : '0'/
)
assert.match(builder, /channel === 'shop' \? 'new' : 'good'/)
assert.match(form, /!value \|\|\s*isMarketPair/)
assert.match(form, /No subcategory/)
assert.match(
  validation,
  /subcategory === undefined \|\| subcategory === null \|\| subcategory === ''/
)
assert.match(migration, /alter column subcategory drop not null/)
assert.match(migration, /subcategory is null or/)
assert.match(form, /value: 'in_person'/)
assert.match(form, /value: 'interac_etransfer'/)
assert.match(form, /value: 'uu_pay'/)
assert.match(form, /Delivery destination/)
assert.match(
  form,
  /Delivery address is confirmed when arranging the transaction\./
)
assert.match(form, /value === 'uu_pay' \|\|\s*value === 'interac_etransfer'/)
assert.match(form, /Confirm & Publish/)
assert.match(form, /loading=\{busy\}/)
assert.match(form, /Location detail/)
assert.doesNotMatch(
  form,
  /delivery-origin search needs its own persisted seller-origin contract/i
)
assert.match(migration, /'uu_pay','external','in_person','interac_etransfer'/)
assert.match(deliveryMigration, /'uu_pay','interac_etransfer'/)
assert.match(wizardCss, /border-color: var\(--color-primary-purple, #7c3aed\)/)
assert.match(
  wizardCss,
  /\[data-wizard-step='2'\] > \.fulfillmentDescriptionStep/
)
assert.match(glide, /menuRadius = radius/)
assert.match(glide, /--gs-menu-radius/)
assert.match(form, /menuRadius=\{20\}/)
assert.equal(
  (toolbar.match(/<ProductSearch value=\{search\}/g) || []).length,
  1
)
assert.match(toolbar, /label="Category"/)
assert.match(toolbar, /setShopPage\(1\)/)
assert.match(toolbar, /filtered\.slice/)

console.log('listing-wizard-task-b: PASS')

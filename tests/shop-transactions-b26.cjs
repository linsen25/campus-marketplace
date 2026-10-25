const fs = require('node:fs')
const assert = require('node:assert/strict')

const migration = fs.readFileSync(
  'supabase/migrations/20261023015435_shop_transaction_admission.sql',
  'utf8'
)
const card = fs.readFileSync(
  'components/listings/published-listing-card.tsx',
  'utf8'
)

assert.match(migration, /enabled boolean not null default false/)
assert.match(
  migration,
  /create or replace function marketplace_private\.guard_new_shop_transaction/
)
assert.match(
  migration,
  /from public\.listings where id=new\.listing_id for share/
)
assert.match(
  migration,
  /from public\.shops where owner_id=source\.seller_id for key share/
)
assert.match(
  migration,
  /from marketplace_private\.shop_memberships[\s\S]*for update/
)
assert.match(
  migration,
  /shop_entitlements\(source\.seller_id,clock_timestamp\(\)\)/
)
assert.match(
  migration,
  /source\.published_at is null or source\.status<>'available'/
)
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_transaction_admission/
)
assert.doesNotMatch(migration, /drop trigger|disable trigger/i)
assert.doesNotMatch(
  migration,
  /create table public\.(?:conversations|order_requests|orders)/i
)

assert.match(card, /NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED === 'true'/)
assert.match(card, /const canTransact = !own && shopTransactionsEnabled/)
assert.match(card, /const canFavorite = !own && !shopReadOnly/)
assert.match(card, /useListingOfferContext\([\s\S]*shopTransactionsEnabled/)

console.log(
  'PASS B26-A default-closed database admission, retained B14 guards, shared UI transaction controls and unchanged Shop product Favorite boundary'
)

/* C4 static contract: Shop-only archive preserves C2 retention and visibility. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read(
  'supabase/migrations/20261116213724_shop_listing_archive_lifecycle.sql'
)
const repository = read('lib/server/supabase-listings-repository.ts')
const management = read('components/listings/home-listings.tsx')

assert.match(migration, /add column archived_at timestamptz/)
assert.match(
  migration,
  /check \(archived_at is null or listing_channel = 'shop'\)/
)
assert.match(migration, /marketplace_archive_shop_listing\(p_listing_id uuid\)/)
assert.match(migration, /is_verified_user\(\)/)
assert.match(migration, /is_shop_operator\(actor\)/)
assert.match(migration, /for update/)
assert.match(migration, /idempotent',true/)
assert.match(migration, /archived_at is null/)
assert.match(migration, /order_requests_reject_archived_shop_listing/)
assert.match(migration, /orders_reject_archived_shop_listing/)
assert.match(migration, /source\.archived_at is not null/)
assert.match(
  migration,
  /revoke update\(archived_at\) on public\.listings from authenticated/
)
assert.match(repository, /marketplace_archive_shop_listing/)
assert.match(repository, /request = request\.is\('archived_at', null\)/)
assert.match(repository, /listing_channel\.neq\.shop,archived_at\.is\.null/)
assert.match(management, /Product archived/)
assert.doesNotMatch(migration, /on delete cascade/)
console.log('PASS C4 static archive lifecycle contract')

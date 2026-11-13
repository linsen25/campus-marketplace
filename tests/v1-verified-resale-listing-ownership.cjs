const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261112063858_v1_verified_resale_listing_ownership.sql'),
  'utf8',
);

assert.match(migration, /^begin;/m);
assert.match(migration, /commit;\s*$/m);
assert.match(migration, /Listing policy baseline drifted/);
assert.match(migration, /Listing finalization metadata changed unexpectedly/);
assert.match(migration, /marketplace_finalize_listing\(uuid\)/);
assert.match(migration, /target\.listing_channel<>''resale''/);
assert.match(migration, /marketplace_private\.is_verified_user\(\)/);

for (const policy of [
  'listings_owner_insert',
  'listings_owner_update',
  'listings_owner_delete',
  'images_owner_insert',
  'images_owner_update',
  'images_owner_delete',
]) {
  assert.match(migration, new RegExp(`(?:drop|create) policy ${policy}\\b`));
}

assert.match(migration, /listing_channel='resale'/);
assert.match(migration, /listing_channel<>'resale'/);
assert.match(migration, /marketplace_private\.is_western_user\(\)/);
assert.match(migration, /listing-images-private/);
assert.match(migration, /listing_private_insert_guard/);
assert.match(migration, /owner_id=\(select auth\.uid\(\)\)/);
assert.doesNotMatch(migration, /grant\s+(?:all|select|insert|update|delete)\s+on\s+public\.(?:listings|listing_images)/i);

console.log('v1 verified Resale listing ownership static checks passed');

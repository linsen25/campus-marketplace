/* C3 static contract: creation initialization, public boundary, and owner API. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read(
  'supabase/migrations/20261116114008_shop_inventory_integration.sql'
)
const ownerApi = read('pages/api/shop/inventory.ts')
const ownerRepo = read('lib/server/shop-inventory-repository.ts')
const ownerList = read('lib/server/supabase-listings-repository.ts')
const publicParser = read('lib/server/public-shop.ts')
const inventoryDialog = read('components/shops/shop-inventory-dialog.tsx')
const inventoryTable = read('components/shops/shop-product-table.tsx')

assert.match(
  migration,
  /perform marketplace_private\.initialize_shop_inventory\(prior\.id\)/
)
assert.match(migration, /on conflict\(id\) do nothing/)
assert.match(migration, /left join marketplace_private\.shop_inventory i/)
assert.match(migration, /'inventoryStatus'/)
assert.doesNotMatch(migration, /'availableQuantity'/)
assert.doesNotMatch(migration, /'reservedQuantity'/)
assert.doesNotMatch(migration, /'revision'/)
assert.match(ownerApi, /requireSameOriginWrite/)
assert.match(ownerRepo, /marketplace_shop_inventory/)
assert.match(ownerRepo, /expectedRevision/)
assert.match(ownerRepo, /actionId/)
assert.match(ownerRepo, /requireMarketplaceUser/)
assert.match(ownerRepo, /You do not have permission to manage this inventory/)
assert.match(ownerList, /projectShopInventory/)
assert.match(publicParser, /inventoryStatus/)
assert.match(inventoryDialog, /crypto\.randomUUID\(\)/)
assert.match(inventoryDialog, /expectedRevision: inventory\.revision/)
assert.match(inventoryDialog, /Reload inventory/)
assert.match(inventoryTable, /Adjust Inventory/)
assert.match(inventoryTable, /Low stock/)
console.log('PASS C3 static inventory integration contract')

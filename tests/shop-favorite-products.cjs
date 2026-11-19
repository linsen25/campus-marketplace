// Focused no-network contract test for the authenticated Shop-product
// favorites projection. Database execution remains a separate migration test.
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const actor = '11111111-1111-4111-8111-111111111111'
const shopId = '22222222-2222-4222-8222-222222222222'
const listingId = '33333333-3333-4333-8333-333333333333'
const imageId = '44444444-4444-4444-8444-444444444444'
const calls = []
const payload = {
  items: [
    {
      listing: {
        id: listingId,
        listingChannel: 'shop',
        title: 'Public camera',
        description: 'Public product',
        price: 4500,
        currency: 'CAD',
        category: 'Electronics',
        subcategory: 'Cameras',
        condition: 'good',
        preferredPaymentMode: 'uu_pay',
        preferredFulfillment: 'ON_CAMPUS',
        meetingLocation: null,
        estimatedDeliveryFeeCents: 0,
        status: 'available',
        seller: { id: shopId, displayName: 'shop_owner', privateEmail: 'nope' },
        photoUrls: [`/api/listing-media/${imageId}`],
        createdAt: '2026-11-14T00:00:00.000Z',
        updatedAt: '2026-11-14T00:00:00.000Z',
        publishedAt: '2026-11-14T00:00:00.000Z',
        storageBucket: 'private',
      },
      shop: {
        id: shopId,
        shopName: 'Public Shop',
        username: 'public_shop',
        billingPlan: 'private',
      },
    },
  ],
  shops: [{ id: shopId, shopName: 'Public Shop', username: 'public_shop' }],
  page: 1,
  hasNextPage: false,
  refreshAfterMs: 30000,
}

class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const client = {
  rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: payload, error: null }
  },
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }
  cache.set(full, module)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, jsx: 4, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@supabase/supabase-js')
        return { createClient: () => client }
      if (name === '@/lib/auth-username')
        return { validUsername: (value) => /^[A-Za-z0-9_]{3,20}$/.test(value) }
      if (name === '@/lib/listing-validation')
        return {
          ListingApiError,
          listingInputRecord: () => ({}),
          validateListingInput: () => ({}),
          validateListingPatch: () => ({}),
        }
      if (name === '@/lib/listing-fulfillment')
        return { listingFulfillmentEnabled: () => false }
      if (name === '@/lib/listing-metadata')
        return { listingConditions: [], listingSorts: [] }
      if (name === '@/lib/market-taxonomy')
        return { isMarketFilterPair: () => true }
      if (name === '@/lib/server/listing-image-storage')
        return { removeListingImageObjects: async () => null }
      if (name === '@/lib/server/marketplace-auth')
        return { requireMarketplaceUser: async () => ({ id: actor }) }
      if (name === '@/lib/server/places-service')
        return { assertMeetingPlaceSelection: async () => {} }
      if (name === '@/lib/server/public-shop')
        return {
          getPublicShopListing: async () => ({ state: 'not_found' }),
          getPublicShopProducts: async () => ({ listings: [] }),
          publicShopListingProjection: (value) => {
            const projected = { ...value, seller: { ...value.seller } }
            delete projected.storageBucket
            delete projected.seller.privateEmail
            return projected
          },
          shopListingIdentityProjection: ({ id, shopName, username }) => ({
            id,
            shopName,
            username,
          }),
        }
      if (name === '@/lib/server/shop-inventory-repository')
        return { projectShopInventory: () => null }
      if (name === '@/lib/supabase/listing-mapper')
        return { mapListing: (value) => value }
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name.startsWith('@/'))
        return load(path.resolve(name.slice(2)) + '.ts')
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const { createSupabaseListingsRepository } = load(
    'lib/server/supabase-listings-repository.ts'
  )
  const repository = createSupabaseListingsRepository({})
  const result = await repository.getFavoriteShopProducts({
    page: 1,
    pageSize: 20,
    shopId,
  })
  assert.deepEqual(calls, [
    {
      name: 'marketplace_favorite_shop_products',
      args: { p_query: { page: 1, pageSize: 20, shopId } },
    },
  ])
  assert.equal(result.items[0].shop.id, shopId)
  assert.equal(result.items[0].listing.id, listingId)
  assert(!JSON.stringify(result).includes('privateEmail'))
  assert(!JSON.stringify(result).includes('billingPlan'))
  assert(!JSON.stringify(result).includes('storageBucket'))
  await assert.rejects(
    () => repository.getFavoriteShopProducts({ shopId: 'not-a-uuid' }),
    (error) => error instanceof ListingApiError && error.status === 400
  )
  assert.equal(calls.length, 1, 'invalid Shop IDs must not reach the RPC')

  const migration = fs.readFileSync(
    'supabase/migrations/20261115000000_favorite_shop_products.sql',
    'utf8'
  )
  assert.match(migration, /f\.user_id = actor/)
  assert.match(migration, /marketplace_private\.public_shop_eligibility/)
  assert.match(
    migration,
    /and \(selected_shop is null or s\.id = selected_shop\)/
  )
  assert(
    migration.indexOf('selected_shop is null') < migration.indexOf('offset')
  )
  assert.match(migration, /grant execute .* to authenticated/i)
  assert.match(
    migration,
    /revoke all .* from public, anon, authenticated, service_role/is
  )
  console.log(
    'PASS Shop favorite products: authenticated RPC contract, whitelist projection, Shop filter and migration security guards'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

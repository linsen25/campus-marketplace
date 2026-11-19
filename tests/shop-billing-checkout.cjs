const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const root = path.resolve(__dirname, '..')
const commands = new Map()
const customers = new Map()
const sessions = new Map()
let revision = 7
let failure = null
let customerCalls = 0
let sessionCalls = 0
const actionId = '10000000-0000-4000-8000-000000000001'

function rpc(_name, params) {
  if (failure === 'database') return { data: null, error: { code: 'XX000' } }
  if (failure === 'owner') return { data: null, error: { code: '42501' } }
  if (failure === 'existing') return { data: null, error: { code: '23505' } }
  const key = `${params.p_owner}:${params.p_action_id}`
  const current = commands.get(key)
  if (params.p_action === 'prepare') {
    if (params.p_value.membershipRevision !== revision)
      return { data: null, error: { code: '40001' } }
    if (current) return { data: current, error: null }
    const next = {
      state: 'prepared',
      providerCustomerId: null,
      checkoutSessionId: null,
    }
    commands.set(key, next)
    return { data: next, error: null }
  }
  if (!current) return { data: null, error: { code: '23514' } }
  if (params.p_action === 'bind_customer')
    current.providerCustomerId = params.p_value.customerId
  if (params.p_action === 'record_checkout') {
    current.state = 'checkout_created'
    current.checkoutSessionId = params.p_value.sessionId
  }
  return { data: current, error: null }
}

const stripe = {
  customers: {
    create: async (data, options) => {
      if (failure === 'stripe') throw Error('Stripe unavailable')
      if (!customers.has(options.idempotencyKey)) {
        customerCalls += 1
        customers.set(options.idempotencyKey, {
          id: 'cus_TestOwner',
          livemode: false,
          metadata: data.metadata,
        })
      }
      return customers.get(options.idempotencyKey)
    },
  },
  checkout: {
    sessions: {
      create: async (data, options) => {
        if (failure === 'stripe') throw Error('Stripe unavailable')
        assert.equal(data.mode, 'subscription')
        assert.equal(data.line_items[0].price, 'price_PlusTest')
        if (!sessions.has(options.idempotencyKey)) {
          sessionCalls += 1
          sessions.set(options.idempotencyKey, {
            id: 'cs_test_Synthetic',
            url: 'https://checkout.stripe.test/synthetic',
            livemode: false,
            metadata: data.metadata,
          })
        }
        return sessions.get(options.idempotencyKey)
      },
      retrieve: async (id) =>
        [...sessions.values()].find((session) => session.id === id),
    },
  },
}

const source = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-checkout.ts'),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation') return { ListingApiError }
    if (name === '@/lib/server/financial-capabilities-service')
      return {
        createTrustedFinancialClient: () => ({
          rpc: async (...args) => rpc(...args),
        }),
      }
    if (name === '@/lib/server/shop-billing-environment')
      return {
        shopBillingCheckoutConfiguration: () => ({
          platform: 'acct_Test',
          origin: 'http://localhost:3000',
          prices: { plus: 'price_PlusTest', pro: 'price_ProTest' },
        }),
      }
    if (name === '@/lib/server/shop-membership-repository')
      return {
        createShopMembershipRepository: () => ({
          getOwnMembership: async () => ({ revision }),
        }),
      }
    if (name === '@/lib/server/stripe-runtime')
      return { stripeRuntime: async () => ({ stripe }) }
    if (name === '@/lib/server/marketplace-auth')
      return { requireMarketplaceUser: async () => ({ id: 'owner' }) }
    if (name === '@/lib/supabase/server')
      return { createMarketplaceClient: () => ({}) }
    return require(name)
  },
  loaded,
  loaded.exports
)

async function main() {
  const input = { tier: 'plus', membershipRevision: 7, actionId }
  const first = await loaded.exports.startShopBillingCheckout({}, input)
  const second = await loaded.exports.startShopBillingCheckout({}, input)
  assert.deepEqual(second, first)
  assert.equal(customerCalls, 1)
  assert.equal(sessionCalls, 1)

  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        {
          ...input,
          actionId: '20000000-0000-4000-8000-000000000002',
          membershipRevision: 6,
        }
      ),
    (error) => error instanceof ListingApiError && error.status === 409
  )
  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        {
          ...input,
          actionId: '30000000-0000-4000-8000-000000000003',
          customerId: 'cus_Forged',
        }
      ),
    (error) => error instanceof ListingApiError && error.status === 400
  )
  failure = 'owner'
  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        { ...input, actionId: '40000000-0000-4000-8000-000000000004' }
      ),
    (error) => error instanceof ListingApiError && error.status === 403
  )
  failure = 'database'
  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        { ...input, actionId: '50000000-0000-4000-8000-000000000005' }
      ),
    (error) => error instanceof ListingApiError && error.status === 503
  )
  failure = 'existing'
  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        { ...input, actionId: '60000000-0000-4000-8000-000000000006' }
      ),
    (error) => error instanceof ListingApiError && error.status === 409
  )
  failure = 'stripe'
  await assert.rejects(
    () =>
      loaded.exports.startShopBillingCheckout(
        {},
        {
          tier: 'plus',
          membershipRevision: revision,
          actionId: '70000000-0000-4000-8000-000000000007',
        }
      ),
    (error) => error instanceof Error
  )
  console.log(
    'PASS Shop Billing Checkout fixtures: server prices, forged fields, revision/owner/database failures, Stripe failure, and idempotent session creation.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

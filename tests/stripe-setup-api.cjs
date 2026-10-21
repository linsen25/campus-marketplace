// API/security qualification only. No network, sessions, provider objects or data writes.
const fs = require('node:fs'),
  ts = require('typescript'),
  assert = require('node:assert/strict'),
  { Readable } = require('node:stream'),
  Stripe = require('stripe')
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
let authenticated = true,
  leak = false,
  webhookPersistenceFailure = false,
  calls = []
const dependencies = {
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/server/stripe-environment': {
    stripeConfiguration: () => ({}),
    stripeRequested: () => process.env.STRIPE_PROVIDER_ENABLED === 'true',
  },
  '@/lib/server/stripe-order-payment': {
    assertStripeOrderPaymentsEnabled: () => {
      throw new ListingApiError('Order payments remain disabled.', 503)
    },
    prepareOrderPaymentConfirmation: async () => {
      throw new ListingApiError('Order payments remain disabled.', 503)
    },
  },
  '@/lib/server/stripe-order-reconciliation': {
    drainStripeOrderPayments: async () => ({
      processed: 0,
      recovered: 0,
      pending: 0,
      exceptions: 0,
    }),
  },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => {
      if (!authenticated) throw new ListingApiError('Log in.', 401)
      return { id: 'session-owner' }
    },
    requireSameOriginWrite: (req) => {
      if (
        req.headers['x-marketplace-request'] !== '1' ||
        (req.headers.origin && req.headers.origin !== 'http://localhost:3000')
      )
        throw new ListingApiError('Invalid origin.', 403)
    },
  },
  '@/lib/supabase/server': { createMarketplaceClient: () => ({}) },
  '@/lib/server/stripe-setup': {
    startCardSetup: async (user) => {
      calls.push(['card', user])
      if (leak) throw Error('sk_test_SyntheticDoNotExpose')
      return {
        clientSecret: 'synthetic_owned_secret',
        publishableKey: 'pk_test_Synthetic',
        returnUrl: 'http://localhost:3000/home',
      }
    },
    startPayoutSetup: async (...args) => {
      calls.push(['payout', ...args])
      return { url: 'https://connect.stripe.com/setup/synthetic' }
    },
    reconcileStripe: async (...args) => {
      calls.push(['reconcile', ...args])
      return {
        setupStatus: 'succeeded',
        capabilities: { paymentMethod: { status: 'set' } },
      }
    },
    drainStripeEvents: async () => ({ processed: 0 }),
    receiveStripeEvent: async (raw, signature, channel) => {
      if (webhookPersistenceFailure)
        throw new Error('synthetic database failure')
      new Stripe('sk_test_Synthetic').webhooks.constructEvent(
        raw,
        signature,
        'whsec_Synthetic'
      )
      calls.push(['raw', raw.toString(), channel])
    },
  },
}
function load(file) {
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: 1, target: 7, esModuleInterop: true },
    }).outputText
  )((name) => dependencies[name] || require(name), m, m.exports)
  return m.exports
}
const route = load('pages/api/stripe/[action].ts').default,
  refresh = load('pages/api/stripe/connect-refresh.ts').default,
  worker = load('pages/api/stripe/worker.ts').default
const rawHandler = load(
  'lib/server/stripe-webhook-handler.ts'
).stripeWebhookHandler('platform')
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(v) {
      this.code = v
      return this
    },
    json(v) {
      this.value = v
      return this
    },
    send(v) {
      this.value = v
      return this
    },
    end() {
      return this
    },
    redirect(status, url) {
      this.code = status
      this.value = url
      return this
    },
  }
}
const request = (action, body = {}) => ({
  method: 'POST',
  query: { action },
  body,
  headers: {
    'x-marketplace-request': '1',
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
  },
})
async function main() {
  for (const action of ['card-setup', 'payout-setup', 'reconcile']) {
    let res = response()
    await route(request(action), res)
    assert.equal(res.code, 200)
    assert.equal(calls.at(-1)[1], 'session-owner')
    assert.match(res.headers['Cache-Control'], /no-store/)
    for (const key of [
      'userId',
      'customer',
      'account',
      'paymentMethod',
      'clientSecret',
      'status',
      'amount',
    ]) {
      res = response()
      await route(request(action, { [key]: 'injected' }), res)
      assert.equal(res.code, 400)
    }
    res = response()
    const cross = request(action)
    cross.headers.origin = 'https://foreign.example'
    await route(cross, res)
    assert.equal(res.code, 403)
    authenticated = false
    res = response()
    await route(request(action), res)
    assert.equal(res.code, 401)
    authenticated = true
  }
  leak = true
  let res = response()
  await route(request('card-setup'), res)
  assert.equal(res.code, 503)
  assert(!JSON.stringify(res.value).includes('SyntheticDoNotExpose'))
  leak = false
  res = response()
  await refresh(
    { method: 'GET', query: { state: 'injected' }, headers: {} },
    res
  )
  assert.equal(res.code, 403)
  const payload =
    ' {"id":"evt_synthetic","data":{"object":{}},"type":"setup_intent.succeeded"}\n'
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_Synthetic',
  })
  res = response()
  const raw = Readable.from([
    Buffer.from(payload.slice(0, 20)),
    Buffer.from(payload.slice(20)),
  ])
  Object.assign(raw, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: { not: 'the raw body' },
  })
  await rawHandler(raw, res)
  assert.equal(res.code, 200)
  assert.equal(calls.at(-1)[1], payload)
  webhookPersistenceFailure = true
  res = response()
  const failedPersistence = Readable.from([payload])
  Object.assign(failedPersistence, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
  })
  await rawHandler(failedPersistence, res)
  assert.equal(res.code, 503)
  assert.equal(res.value.error, 'Unable to record Stripe event.')
  webhookPersistenceFailure = false
  res = response()
  const large = Readable.from([Buffer.alloc(262145)])
  Object.assign(large, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
  })
  await rawHandler(large, res)
  assert.equal(res.code, 413)
  for (const file of ['webhook', 'connect-webhook', 'account-webhook'])
    assert.match(
      fs.readFileSync('pages/api/stripe/' + file + '.ts', 'utf8'),
      /bodyParser: false/
    )
  const old = process.env.STRIPE_WORKER_SECRET
  process.env.STRIPE_WORKER_SECRET = 'x'.repeat(32)
  res = response()
  await worker(
    { method: 'POST', headers: { authorization: 'Bearer ' + 'é'.repeat(32) } },
    res
  )
  assert.equal(res.code, 403)
  res = response()
  await worker(
    { method: 'POST', headers: { authorization: 'Bearer ' + 'x'.repeat(32) } },
    res
  )
  assert.equal(res.code, 200)
  if (old === undefined) delete process.env.STRIPE_WORKER_SECRET
  else process.env.STRIPE_WORKER_SECRET = old
  // Enabling account setup cannot accidentally route an Order through the simulator.
  let rpcCalls = 0
  const blockedClient = {
    rpc: async () => {
      rpcCalls++
      throw Error('Unexpected simulator RPC')
    },
  }
  dependencies['@/lib/server/financial-capabilities-service'] = {
    requireFinancialEnvironment: () => {},
    createTrustedFinancialClient: () => blockedClient,
  }
  dependencies['@/lib/supabase/server'] = {
    createMarketplaceClient: () => blockedClient,
  }
  dependencies['@/lib/server/messages-environment'] = {
    messageUuid: (value) => value,
  }
  dependencies['@/lib/server/handoff-error'] = {
    HandoffApiError: ListingApiError,
    handoffRpcError: () => {},
  }
  dependencies['@/lib/order-payout-error'] = {
    SellerPayoutNotReadyError: ListingApiError,
    sellerPayoutNotReady: () => false,
  }
  dependencies['@/lib/order-financial-error'] = {
    OrderFinancialError: ListingApiError,
  }
  dependencies['@/lib/server/offers-service'] = { mapTerms: (value) => value }
  dependencies['@/lib/server/order-request-service'] = {
    mapRequest: (value) => value,
    requireOrderRequestEnvironment: () => {},
  }
  dependencies['@/lib/server/order-snapshot-media'] = {
    signOrderSnapshotMedia: async () => [],
  }
  const previousFlag = process.env.STRIPE_PROVIDER_ENABLED
  process.env.STRIPE_PROVIDER_ENABLED = 'true'
  try {
    const domain = load(
      'lib/server/order-domain-service.ts'
    ).createOrderDomainService({})
    await assert.rejects(
      () => domain.write('order', 'payment', { clientActionId: 'action' }),
      (e) => e.status === 503
    )
    const legacy = load('lib/server/orders-service.ts').createOrdersService({})
    await assert.rejects(
      () =>
        legacy.campusAction('order', 'payment', { clientActionId: 'action' }),
      (e) => e.status === 503
    )
    dependencies['@/lib/server/orders-service'] = { mapOrder: (value) => value }
    const simulate = load(
      'lib/server/order-financial-service.ts'
    ).simulateOrderPaymentSuccess
    await assert.rejects(
      () => simulate({}, 'order', {}),
      (e) => e.status === 503
    )
    const testState = load(
      'pages/api/financial-capabilities/test-state.ts'
    ).default
    const blockedResponse = response()
    await testState(
      request('test-state', { capability: 'payment_method', status: 'set' }),
      blockedResponse
    )
    assert.equal(blockedResponse.code, 503)
    assert.equal(rpcCalls, 0)
  } finally {
    if (previousFlag === undefined) delete process.env.STRIPE_PROVIDER_ENABLED
    else process.env.STRIPE_PROVIDER_ENABLED = previousFlag
  }
  console.log(
    'PASS Setup/Connect/reconcile APIs: session-derived owner, field injection, auth/CSRF, no-store, sanitized errors; raw signed body/size cap; worker authorization; all simulator paths blocked before RPC'
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

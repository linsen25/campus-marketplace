// Offline provider qualification. Official SDK signature verification; all HTTPS/DB calls replaced.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  ts = require('typescript')
const Stripe = require('stripe')
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const bindings = new Map(),
  operations = new Map(),
  events = [],
  orderEvents = [],
  refundEvents = []
const customers = new Map(),
  setups = new Map(),
  methods = new Map(),
  accounts = new Map(),
  banks = new Map(),
  idem = new Map()
let serial = 0,
  unknownOwner = false,
  ownerCreates = 0,
  setupCreates = 0,
  connectCreates = 0,
  verifiedSellerEmail = true,
  redactProfiles = false,
  profileUpdates = 0
const fresh = (prefix) => prefix + ++serial
const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)))
const platform = 'acct_SyntheticPlatform'
async function dbRpc(name, p) {
  try {
    if (name === 'marketplace_stripe_binding') {
      const key = p.p_user + ':' + p.p_kind
      let b = bindings.get(key)
      if (!b && p.p_action === 'claim') {
        b = {
          id: crypto.randomUUID(),
          user_id: p.p_user,
          kind: p.p_kind,
          platform,
          status: 'unset',
          owner_ref: null,
          instrument_ref: null,
          setup_ref: null,
          setup_operation: null,
        }
        bindings.set(key, b)
        operations.set(b.id, {
          id: b.id,
          created_at: new Date().toISOString(),
          provider_ref: null,
        })
      }
      if (!b) return { data: null }
      if (p.p_action === 'read') return { data: copy(b) }
      if (p.p_action === 'claim') {
        if (b.lease) return { data: null }
        b.lease = crypto.randomUUID()
        return { data: copy(b) }
      }
      assert.equal(p.p_token, b.lease)
      if (p.p_action === 'release') {
        b.lease = null
        return { data: null }
      }
      if (p.p_action === 'operation')
        return {
          data: copy(
            operations.get(
              p.p_value.kind === 'owner' ? b.id : b.setup_operation
            )
          ),
        }
      if (p.p_action === 'prepare_setup') {
        if (!b.setup_operation || p.p_value.rotate) {
          b.setup_operation = crypto.randomUUID()
          b.setup_ref = null
          operations.set(b.setup_operation, {
            id: b.setup_operation,
            created_at: new Date().toISOString(),
            provider_ref: null,
          })
        }
      }
      if (p.p_action === 'patch') {
        const patch = { ...p.p_value }
        delete patch.project
        Object.assign(b, patch)
        if (b.owner_ref) operations.get(b.id).provider_ref = b.owner_ref
        if (b.setup_ref)
          operations.get(b.setup_operation).provider_ref = b.setup_ref
      }
      return { data: copy(b) }
    }
    if (name === 'marketplace_stripe_capabilities') {
      const buyer = bindings.get(p.p_user + ':payment_method'),
        seller = bindings.get(p.p_user + ':payout_account')
      return {
        data: {
          paymentMethod: {
            status: buyer?.status || 'unset',
            brand: buyer?.label || null,
            last4: buyer?.last4 || null,
          },
          payoutAccount: {
            status: seller?.status || 'unset',
            institution: seller?.label || null,
            last4: seller?.last4 || null,
          },
        },
      }
    }
    if (name === 'marketplace_stripe_events') {
      if (
        p.p_action === 'enqueue' &&
        !events.some(
          (e) => e.id === p.p_value.id && e.scope === p.p_value.scope
        )
      )
        events.push({ ...p.p_value, status: 'pending' })
      if (p.p_action === 'claim') {
        const e = events.find((e) => e.status === 'pending' && !e.retry)
        if (!e) return { data: null }
        e.status = 'processing'
        e.lease = crypto.randomUUID()
        const b = [...bindings.values()].find(
          (b) => b.owner_ref === e.owner || b.instrument_ref === e.owner
        )
        return {
          data: {
            event_id: e.id,
            account_scope: e.scope,
            lease: e.lease,
            binding: b ? { user_id: b.user_id, kind: b.kind } : null,
          },
        }
      }
      if (['done', 'retry'].includes(p.p_action)) {
        const e = events.find((e) => e.id === p.p_value.id)
        e.status = p.p_action === 'done' ? 'done' : 'pending'
        e.retry = p.p_action === 'retry'
      }
      return { data: {} }
    }
    if (name === 'marketplace_order_payment_reconciliation') {
      assert.equal(p.p_action, 'enqueue')
      if (!orderEvents.some((event) => event.id === p.p_value.id))
        orderEvents.push({ ...p.p_value })
      return { data: {} }
    }
    if (name === 'marketplace_order_refund_events') {
      assert.equal(p.p_action, 'enqueue')
      if (!refundEvents.some((event) => event.id === p.p_value.id))
        refundEvents.push({ ...p.p_value })
      return { data: {} }
    }
    throw Error('Unexpected RPC')
  } catch (error) {
    return { error: { message: error.message } }
  }
}
class FakeStripe extends Stripe {
  constructor(key, opts) {
    super(key, opts)
    this.accounts = {
      retrieve: async (id) => copy(id ? banks.get(id) : { id: platform }),
    }
    this.customers = {
      create: async (data, options) => {
        if (idem.has(options.idempotencyKey))
          return copy(idem.get(options.idempotencyKey))
        const c = {
          id: fresh('cus_'),
          livemode: false,
          metadata: data.metadata,
          invoice_settings: { default_payment_method: null },
        }
        customers.set(c.id, c)
        idem.set(options.idempotencyKey, c)
        ownerCreates++
        if (unknownOwner) {
          unknownOwner = false
          throw Error('Transport result unknown')
        }
        return copy(c)
      },
      retrieve: async (id) => copy(customers.get(id)),
      update: async (id, data) => {
        Object.assign(customers.get(id).invoice_settings, data.invoice_settings)
        return copy(customers.get(id))
      },
    }
    this.setupIntents = {
      create: async (data, options) => {
        assert.deepEqual(data.allowed_payment_method_types, ['card'])
        assert.equal(data.usage, 'on_session')
        if (idem.has(options.idempotencyKey))
          return copy(idem.get(options.idempotencyKey))
        const s = {
          id: fresh('seti_'),
          livemode: false,
          customer: data.customer,
          metadata: data.metadata,
          payment_method_types: ['card'],
          status: 'requires_payment_method',
          client_secret: 'seti_fixture_secret_NotARealSecret',
        }
        setups.set(s.id, s)
        idem.set(options.idempotencyKey, s)
        setupCreates++
        return copy(s)
      },
      retrieve: async (id) => copy(setups.get(id)),
    }
    this.paymentMethods = { retrieve: async (id) => copy(methods.get(id)) }
    this.v2 = {
      core: {
        accounts: {
          create: async (data, options) => {
            assert.equal(data.contact_email, 'synthetic@example.test')
            assert.equal(data.dashboard, 'express')
            assert.deepEqual(data.configuration, {
              recipient: {
                capabilities: {
                  stripe_balance: { stripe_transfers: { requested: true } },
                },
              },
            })
            if (idem.has(options.idempotencyKey))
              return copy(idem.get(options.idempotencyKey))
            const a = {
              id: fresh('acct_'),
              livemode: false,
              metadata: data.metadata,
              defaults: data.defaults,
              configuration: {
                recipient: {
                  capabilities: {
                    stripe_balance: {
                      stripe_transfers: { status: 'pending' },
                      payouts: { status: 'pending' },
                    },
                  },
                },
              },
              requirements: {
                summary: { minimum_deadline: { status: 'currently_due' } },
              },
            }
            accounts.set(a.id, a)
            banks.set(a.id, {
              id: a.id,
              payouts_enabled: false,
              external_accounts: { data: [] },
            })
            idem.set(options.idempotencyKey, a)
            connectCreates++
            return copy(a)
          },
          retrieve: async (id) => {
            const a = copy(accounts.get(id))
            if (redactProfiles)
              a.defaults.profile = {
                product_description: null,
                business_url: null,
              }
            return a
          },
          update: async (id, params) => {
            profileUpdates++
            const a = accounts.get(id)
            a.defaults = {
              ...a.defaults,
              profile: { ...a.defaults?.profile, ...params.defaults.profile },
            }
            return copy(a)
          },
        },
        accountLinks: {
          create: async (data) => ({
            account: data.account,
            livemode: false,
            url: 'https://connect.stripe.com/setup/synthetic',
          }),
        },
      },
    }
  }
}
const cache = new Map()
const stubs = {
  stripe: FakeStripe,
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/server/messages-environment': {
    requireMessagesEnvironment: () =>
      process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
        ? 'pcaqxezdfxofysghssyo'
        : 'wrong',
  },
  '@/lib/server/financial-capabilities-service': {
    createTrustedFinancialClient: () => ({
      rpc: dbRpc,
      auth: {
        admin: {
          getUserById: async () => ({
            data: {
              user: {
                email: 'synthetic@example.test',
                email_confirmed_at: verifiedSellerEmail
                  ? new Date().toISOString()
                  : null,
              },
            },
          }),
        },
      },
    }),
    projectFinancialCapabilities: (x) => x,
  },
}
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (stubs[name]) return stubs[name]
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
      if (name.startsWith('./') || name.startsWith('../')) {
        const relative = path.resolve(path.dirname(full), name)
        const resolved = [
          relative,
          relative + '.ts',
          path.join(relative, 'index.ts'),
        ].find(
          (candidate) =>
            fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        )
        if (resolved?.endsWith('.ts')) return load(resolved)
        return require(require.resolve(relative))
      }
      return require(name)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const original = { ...process.env }
Object.assign(process.env, {
  APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://pcaqxezdfxofysghssyo.supabase.co',
  STRIPE_PROVIDER_ENABLED: 'true',
  STRIPE_WORKER_SECRET: 'SyntheticWorkerCredentialNotARealSecret',
  STRIPE_SECRET_KEY: 'sk_test_SyntheticOnly',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_SyntheticOnly',
  STRIPE_API_VERSION: '2026-09-30.endive',
  STRIPE_PLATFORM_ACCOUNT_ID: platform,
  STRIPE_APPLICATION_ORIGIN: 'http://localhost:3000',
  STRIPE_WEBHOOK_SECRET: 'whsec_SyntheticOnly',
  STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_SyntheticConnected',
  STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_SyntheticAccount',
})
const config = load('lib/server/stripe-environment.ts'),
  service = load('lib/server/stripe-setup.ts')
async function event(type, object, channel = 'platform', extra = {}) {
  const payload = JSON.stringify({
    id: 'evt_' + fresh('event'),
    type,
    livemode: false,
    data: { object },
    ...extra,
  })
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret:
      channel === 'platform'
        ? process.env.STRIPE_WEBHOOK_SECRET
        : process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  })
  await service.receiveStripeEvent(Buffer.from(payload), header, channel)
  return { payload, header }
}
async function main() {
  for (const [key, value] of [
    ['STRIPE_SECRET_KEY', 'sk_live_Synthetic'],
    ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_Synthetic'],
    ['STRIPE_API_VERSION', 'wrong'],
    ['APP_ENV', 'production'],
    ['STRIPE_APPLICATION_ORIGIN', 'https://example.com/unsafe/path'],
    ['STRIPE_WEBHOOK_SECRET', ''],
  ]) {
    const old = process.env[key]
    process.env[key] = value
    assert.throws(() => config.stripeConfiguration())
    process.env[key] = old
  }
  // A timeout after owner creation reuses the durable operation, not another Customer.
  unknownOwner = true
  await assert.rejects(() => service.startCardSetup('buyer'))
  assert.equal(ownerCreates, 1)
  const prepared = await service.startCardSetup('buyer')
  assert(prepared.clientSecret)
  assert.equal(ownerCreates, 1)
  assert.equal(setupCreates, 1)
  await service.startCardSetup('buyer')
  assert.equal(setupCreates, 1)
  const b = bindings.get('buyer:payment_method'),
    si = setups.get(b.setup_ref)
  methods.set('pm_First', {
    id: 'pm_First',
    livemode: false,
    type: 'card',
    customer: b.owner_ref,
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2099 },
  })
  si.status = 'succeeded'
  si.payment_method = 'pm_First'
  await service.reconcileStripe('buyer')
  assert.equal(b.instrument_ref, 'pm_First')
  assert.equal(b.status, 'set')
  assert.equal(
    (await service.stripeCapabilities('buyer')).payoutAccount.status,
    'unset'
  )
  await service.startCardSetup('buyer')
  const replacement = setups.get(b.setup_ref)
  replacement.status = 'requires_action'
  await service.reconcileStripe('buyer')
  assert.equal(b.instrument_ref, 'pm_First')
  assert.equal(b.status, 'set')
  replacement.status = 'requires_payment_method'
  await service.reconcileStripe('buyer')
  assert.equal(b.instrument_ref, 'pm_First')
  methods.set('pm_Second', {
    ...methods.get('pm_First'),
    id: 'pm_Second',
    card: { brand: 'mastercard', last4: '4444', exp_month: 12, exp_year: 2099 },
  })
  replacement.status = 'succeeded'
  replacement.payment_method = 'pm_Second'
  await service.reconcileStripe('buyer')
  assert.equal(b.instrument_ref, 'pm_Second')
  // Older success/failure events always reconcile the latest binding, never their stale snapshot.
  const e = await event('setup_intent.setup_failed', {
    id: si.id,
    customer: b.owner_ref,
  })
  await service.receiveStripeEvent(Buffer.from(e.payload), e.header, 'platform')
  assert.equal(events.length, 1)
  await service.drainStripeEvents()
  assert.equal(b.instrument_ref, 'pm_Second')
  assert.equal(events[0].status, 'done')
  assert.equal((await service.drainStripeEvents()).processed, 0)
  methods.get('pm_Second').customer = null
  await event('payment_method.detached', { id: 'pm_Second', customer: null })
  await service.drainStripeEvents()
  assert.equal(b.status, 'needs_attention')
  methods.get('pm_Second').customer = b.owner_ref
  replacement.customer = 'cus_Foreign'
  await assert.rejects(() => service.reconcileStripe('buyer'))
  replacement.customer = b.owner_ref
  await assert.rejects(() =>
    service.receiveStripeEvent(
      Buffer.from(e.payload + ' '),
      e.header,
      'platform'
    )
  )
  const payment = await event('payment_intent.succeeded', {
    id: 'pi_OrderSynthetic',
    object: 'payment_intent',
    metadata: { uu_kind: 'marketplace_order' },
  })
  await service.receiveStripeEvent(
    Buffer.from(payment.payload),
    payment.header,
    'platform'
  )
  assert.equal(orderEvents.length, 1)
  for (const type of ['refund.created', 'refund.updated', 'refund.failed']) {
    await event(type, {
      id: `re_${type.replace(/[^a-z]/g, '')}`,
      object: 'refund',
      metadata: { uu_kind: 'marketplace_order_refund' },
    })
  }
  assert.equal(refundEvents.length, 3)
  assert(refundEvents.every((item) => item.scope === platform))
  assert(refundEvents.every((item) => item.providerReference.startsWith('re_')))
  await event('refund.updated', {
    id: 're_Membership',
    object: 'refund',
    metadata: { uu_kind: 'shop_membership_refund' },
  })
  assert.equal(refundEvents.length, 3)
  await assert.rejects(() =>
    event(
      'refund.updated',
      {
        id: 're_Connected',
        object: 'refund',
        metadata: { uu_kind: 'marketplace_order_refund' },
      },
      'platform',
      { account: 'acct_Connected' }
    )
  )
  assert.equal(orderEvents[0].providerReference, 'pi_OrderSynthetic')
  assert.equal(orderEvents[0].scope, platform)
  await event('payment_intent.succeeded', {
    id: 'pi_MembershipSynthetic',
    object: 'payment_intent',
    metadata: { uu_kind: 'shop_membership' },
  })
  assert.equal(orderEvents.length, 1)
  await assert.rejects(() =>
    event(
      'payment_intent.succeeded',
      {
        id: 'pi_Connected',
        object: 'payment_intent',
        metadata: { uu_kind: 'marketplace_order' },
      },
      'platform',
      { account: 'acct_Connected' }
    )
  )
  const live = JSON.stringify({
    id: 'evt_live',
    type: 'setup_intent.succeeded',
    livemode: true,
    data: { object: { customer: b.owner_ref } },
  })
  await assert.rejects(() =>
    service.receiveStripeEvent(
      Buffer.from(live),
      Stripe.webhooks.generateTestHeaderString({
        payload: live,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      }),
      'platform'
    )
  )
  verifiedSellerEmail = false
  await assert.rejects(
    () => service.startPayoutSetup('seller'),
    /verified account email/
  )
  assert.equal(connectCreates, 0)
  verifiedSellerEmail = true
  await service.startPayoutSetup('seller')
  await service.startPayoutSetup('seller')
  assert.equal(connectCreates, 1)
  const seller = bindings.get('seller:payout_account')
  await service.reconcileStripe('seller')
  assert.equal(seller.status, 'needs_attention')
  const account = accounts.get(seller.owner_ref),
    bank = banks.get(seller.owner_ref)
  const description =
    'I sell new and pre-owned personal items through the Usual & Unusual marketplace.'
  assert.equal(account.defaults.profile.product_description, description)
  assert(
    !account.defaults.profile.business_url,
    'No invented localhost business URL'
  )
  account.defaults.profile = {}
  seller.refresh_hash = null // An existing account whose hosted flow never started.
  await service.startPayoutSetup('seller')
  assert.equal(
    account.defaults.profile.product_description,
    description,
    'Existing accounts receive missing description'
  )
  account.defaults.profile = {
    product_description: 'Seller-provided description',
    business_url: 'https://seller-owned.example.org',
  }
  redactProfiles = true
  const previousUpdates = profileUpdates
  await service.startPayoutSetup('seller')
  assert.equal(
    profileUpdates,
    previousUpdates,
    'Stripe-redacted fields must not be treated as missing'
  )
  assert.equal(
    account.defaults.profile.product_description,
    'Seller-provided description'
  )
  assert.equal(
    account.defaults.profile.business_url,
    'https://seller-owned.example.org'
  )
  assert.equal(connectCreates, 1)
  account.configuration.recipient.capabilities.stripe_balance = {
    stripe_transfers: { status: 'active' },
    payouts: { status: 'active' },
  }
  account.requirements.summary.minimum_deadline.status = 'eventually_due'
  bank.payouts_enabled = true
  bank.external_accounts.data = [
    {
      id: 'ba_Test',
      object: 'bank_account',
      currency: 'cad',
      default_for_currency: true,
      status: 'new',
      last4: '1234',
    },
  ]
  await service.reconcileStripe('seller')
  assert.equal(seller.status, 'ready')
  assert(
    !service.sellerReadiness(account, { ...bank, payouts_enabled: false }).ready
  )
  bank.external_accounts.data[0].status = 'errored'
  await service.reconcileStripe('seller')
  assert.equal(seller.status, 'needs_attention')
  assert.throws(() =>
    service.trustedConnectUrl('https://connect.stripe.com.evil.example/')
  )
  await assert.rejects(() => service.startPayoutSetup('seller', '0'.repeat(64)))
  const thin = JSON.stringify({
    id: 'evt_ThinSynthetic',
    object: 'v2.core.event',
    type: 'v2.core.account[requirements].updated',
    created: new Date().toISOString(),
    livemode: false,
    related_object: {
      id: seller.owner_ref,
      type: 'v2.core.account',
      url: '/v2/core/accounts/' + seller.owner_ref,
    },
  })
  const thinSignature = Stripe.webhooks.generateTestHeaderString({
    payload: thin,
    secret: process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET,
  })
  await service.receiveStripeEvent(Buffer.from(thin), thinSignature, 'account')
  await service.drainStripeEvents()
  assert.equal(events.find((e) => e.id === 'evt_ThinSynthetic').status, 'done')
  // Parallel identical setup attempts cannot create duplicate provider owners.
  const concurrent = await Promise.allSettled([
    service.startCardSetup('race'),
    service.startCardSetup('race'),
  ])
  assert.equal(concurrent.filter((x) => x.status === 'fulfilled').length, 1)
  for (const value of Object.values(await service.stripeCapabilities('seller')))
    assert(!JSON.stringify(value).match(/acct_|cus_|pm_|seti_|ba_/))
  console.log(
    'PASS Stripe test-mode/config guards, Customer/SI idempotency and unknown result, one-card replacement, ownership, signed duplicate/out-of-order/detach events, Connect reuse/readiness, concurrency, safe DTO'
  )
}
main()
  .catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
  .finally(() => {
    for (const k of Object.keys(process.env))
      if (!(k in original)) delete process.env[k]
    Object.assign(process.env, original)
  })

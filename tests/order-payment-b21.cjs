const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const baseRow = {
  id: '21111111-1111-4111-8111-111111111111',
  order_id: '21222222-2222-4222-8222-222222222222',
  buyer_id: '21333333-3333-4333-8333-333333333333',
  provider_platform: 'acct_TestPlatform',
  provider_operation_id: '21444444-4444-4444-8444-444444444444',
  provider_idempotency_key:
    'uu:test:acct_TestPlatform:order:21444444-4444-4444-8444-444444444444',
  provider_customer_ref: 'cus_Buyer',
  provider_instrument_ref: 'pm_Card',
  provider_seller_account_ref: 'acct_Seller',
  provider_amount_cents: 10825,
  provider_currency: 'CAD',
  provider_transfer_group: 'uu_order_21222222-2222-4222-8222-222222222222',
  provider_reference: null,
  provider_lease: '21555555-5555-4555-8555-555555555555',
  claimState: 'create',
  confirmable: true,
}

function intent(overrides = {}) {
  return {
    id: 'pi_Order',
    livemode: false,
    amount: 10825,
    currency: 'cad',
    customer: 'cus_Buyer',
    payment_method: 'pm_Card',
    on_behalf_of: 'acct_Seller',
    transfer_group: baseRow.provider_transfer_group,
    metadata: {
      uu_order: baseRow.order_id,
      uu_attempt: baseRow.id,
      uu_kind: 'marketplace_order',
      uu_environment: 'staging',
    },
    status: 'requires_confirmation',
    client_secret: 'pi_Order_secret_synthetic',
    ...overrides,
  }
}

function loadAdapter(state) {
  const file = path.resolve('lib/server/stripe-order-payment.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const stripe = {
    accounts: {
      retrieve: async (id) =>
        id
          ? {
              id,
              charges_enabled: state.sellerReady !== false,
              country: state.sellerCountry || 'CA',
              capabilities: {
                card_payments:
                  state.sellerReady === false ? 'inactive' : 'active',
              },
            }
          : { id: 'acct_TestPlatform', country: 'CA' },
    },
    paymentIntents: {
      create: async (params, options) => {
        state.creates.push({ params, options })
        if (state.createError) throw state.createError
        return state.intent || intent()
      },
      retrieve: async (id) => {
        state.retrieves.push(id)
        return state.intent || intent({ id })
      },
    },
    paymentMethods: {
      retrieve: async (id) => ({
        id,
        livemode: false,
        type: 'card',
        customer: state.paymentCustomer || 'cus_Buyer',
        card: { exp_year: 2099, exp_month: 12 },
      }),
    },
  }
  const financial = {
    createTrustedFinancialClient: () => ({
      rpc: async (_name, args) => {
        state.rpc.push(args)
        const action = args.p_action
        if (state.rpcError?.action === action)
          return { data: null, error: state.rpcError.error }
        if (action === 'claim')
          return { data: state.claim || baseRow, error: null }
        if (action === 'bind')
          return {
            data: {
              ...baseRow,
              provider_reference: args.p_value.providerReference,
              confirmable: state.bindConfirmable !== false,
            },
            error: null,
          }
        if (action === 'read')
          return {
            data: {
              ...baseRow,
              provider_reference:
                state.readReference === undefined
                  ? (state.intent || intent()).id
                  : state.readReference,
              confirmable: state.readConfirmable !== false,
            },
            error: null,
          }
        return { data: null, error: null }
      },
    }),
  }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/listing-validation')
        return { ListingApiError: ApiError }
      if (name === '@/lib/server/financial-capabilities-service')
        return financial
      if (name === '@/lib/server/stripe-runtime')
        return {
          stripeRuntime: async () => ({
            config: { platform: 'acct_TestPlatform' },
            stripe,
          }),
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

function state(overrides = {}) {
  return { creates: [], retrieves: [], rpc: [], ...overrides }
}

async function main() {
  const original = process.env.STRIPE_ORDER_PAYMENTS_ENABLED
  try {
    delete process.env.STRIPE_ORDER_PAYMENTS_ENABLED
    assert.throws(
      () => loadAdapter(state()).assertStripeOrderPaymentsEnabled(),
      (error) => error.status === 503
    )
    process.env.STRIPE_ORDER_PAYMENTS_ENABLED = 'true'

    const source = fs.readFileSync('lib/server/stripe-order-payment.ts', 'utf8')
    const migration = fs.readFileSync(
      'supabase/migrations/202610200002_order_payment_intent_start.sql',
      'utf8'
    )
    const ui = fs.readFileSync(
      'components/home/order-campus-payment.tsx',
      'utf8'
    )
    const api = fs.readFileSync('pages/api/orders/[[...segments]].ts', 'utf8')

    const adapter = loadAdapter(state())
    const params = adapter.buildOrderPaymentIntentParams(baseRow)
    assert.equal(params.amount, 10825)
    assert.equal(params.currency, 'cad')
    assert.equal(params.customer, 'cus_Buyer')
    assert.equal(params.payment_method, 'pm_Card')
    assert.deepEqual(params.allowed_payment_method_types, ['card'])
    assert.equal(params.capture_method, 'automatic')
    assert.equal(params.confirmation_method, 'automatic')
    assert.equal(params.confirm, false)
    assert.equal(params.on_behalf_of, 'acct_Seller')
    assert.equal(params.transfer_group, baseRow.provider_transfer_group)
    assert(!('transfer_data' in params))
    assert(!('application_fee_amount' in params))
    assert.deepEqual(Object.keys(params.metadata).sort(), [
      'uu_attempt',
      'uu_environment',
      'uu_kind',
      'uu_order',
    ])
    assert.throws(() =>
      adapter.buildOrderPaymentIntentParams({
        ...baseRow,
        provider_currency: 'USD',
      })
    )
    assert.throws(() =>
      adapter.buildOrderPaymentIntentParams({
        ...baseRow,
        provider_amount_cents: 1.5,
      })
    )

    const happy = state()
    const result = await loadAdapter(happy).prepareOrderPaymentConfirmation(
      baseRow.id,
      baseRow.buyer_id
    )
    assert.equal(happy.creates.length, 1)
    assert.equal(
      happy.creates[0].options.idempotencyKey,
      baseRow.provider_idempotency_key
    )
    assert.deepEqual(
      happy.rpc.map((entry) => entry.p_action),
      ['claim', 'bind', 'read']
    )
    assert.equal(result.nextAction, 'confirm')
    assert.equal(result.paymentIntentId, 'pi_Order')

    const bound = state({
      claim: {
        ...baseRow,
        provider_reference: 'pi_Existing',
        claimState: 'bound',
      },
      intent: intent({ id: 'pi_Existing' }),
    })
    await loadAdapter(bound).prepareOrderPaymentConfirmation(
      baseRow.id,
      baseRow.buyer_id
    )
    assert.equal(bound.creates.length, 0)
    assert.deepEqual(bound.retrieves, ['pi_Existing'])

    for (const [claimState, status] of [
      ['in_progress', 409],
      ['reconcile', 503],
    ]) {
      const blocked = state({ claim: { ...baseRow, claimState } })
      await assert.rejects(
        () =>
          loadAdapter(blocked).prepareOrderPaymentConfirmation(
            baseRow.id,
            baseRow.buyer_id
          ),
        (error) => error.status === status
      )
      assert.equal(blocked.creates.length, 0)
    }

    const timeout = state({ createError: new Error('synthetic timeout') })
    await assert.rejects(() =>
      loadAdapter(timeout).prepareOrderPaymentConfirmation(
        baseRow.id,
        baseRow.buyer_id
      )
    )
    assert.equal(timeout.creates.length, 1)
    assert.equal(
      timeout.rpc.some((entry) => entry.p_action === 'bind'),
      false
    )

    const bindFailure = state({
      rpcError: { action: 'bind', error: { code: '40001' } },
    })
    await assert.rejects(() =>
      loadAdapter(bindFailure).prepareOrderPaymentConfirmation(
        baseRow.id,
        baseRow.buyer_id
      )
    )
    assert.equal(
      bindFailure.creates[0].options.idempotencyKey,
      baseRow.provider_idempotency_key
    )

    for (const overrides of [
      { amount: 10826 },
      { customer: 'cus_Other' },
      { payment_method: 'pm_Other' },
      { on_behalf_of: 'acct_Other' },
      { transfer_group: 'wrong' },
      { livemode: true },
    ]) {
      const mismatch = state({ intent: intent(overrides) })
      await assert.rejects(() =>
        loadAdapter(mismatch).prepareOrderPaymentConfirmation(
          baseRow.id,
          baseRow.buyer_id
        )
      )
      assert.equal(
        mismatch.rpc.some((entry) => entry.p_action === 'bind'),
        false
      )
    }

    const notReady = state({ sellerReady: false })
    await assert.rejects(
      () =>
        loadAdapter(notReady).prepareOrderPaymentConfirmation(
          baseRow.id,
          baseRow.buyer_id
        ),
      (error) => error.status === 409
    )
    assert.equal(notReady.creates.length, 0)

    const wrongCustomer = state({ paymentCustomer: 'cus_Other' })
    await assert.rejects(
      () =>
        loadAdapter(wrongCustomer).prepareOrderPaymentConfirmation(
          baseRow.id,
          baseRow.buyer_id
        ),
      (error) => error.status === 409
    )
    assert.equal(wrongCustomer.creates.length, 0)

    const succeeded = state({ intent: intent({ status: 'succeeded' }) })
    const reconcile = await loadAdapter(
      succeeded
    ).prepareOrderPaymentConfirmation(baseRow.id, baseRow.buyer_id)
    assert.equal(reconcile.nextAction, 'reconcile')
    assert.equal('clientSecret' in reconcile, false)

    assert(source.includes('STRIPE_ORDER_PAYMENTS_ENABLED'))
    assert(!source.includes('.transfers.create('))
    assert(!source.includes('.refunds.create('))
    assert(!source.includes('.payouts.create('))
    assert(
      migration.includes(
        "marketplace_private.payment_mode(o.terms_snapshot->'terms')='uu_pay'"
      )
    )
    assert(migration.includes("provider_amount_cents=(m->>'total')::bigint"))
    assert(migration.includes('provider_reference_unique'))
    assert(migration.includes("source','order_payment_attempt'"))
    assert(
      migration.includes(
        'grant execute on function public.marketplace_order_payment_provider'
      )
    )
    assert(migration.includes('to service_role'))
    assert(
      !migration.includes(
        'grant execute on function public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb) to authenticated'
      )
    )
    assert(ui.includes('stripe.confirmCardPayment('))
    assert(ui.includes('Stripe.js is not Order payment evidence'))
    assert(!ui.includes("paymentStatus: 'paid'"))
    assert(api.includes('requireSameOriginWrite(req)'))
    console.log(
      'PASS B21 default-off gate, server-derived PaymentIntent contract, idempotent create/reuse/recovery, mismatch rejection, no money movement, and Buyer confirmation authority boundary'
    )
  } finally {
    if (original === undefined) delete process.env.STRIPE_ORDER_PAYMENTS_ENABLED
    else process.env.STRIPE_ORDER_PAYMENTS_ENABLED = original
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

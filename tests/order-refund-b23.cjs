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

const claim = {
  id: '23111111-1111-4111-8111-111111111111',
  order_id: '23222222-2222-4222-8222-222222222222',
  payment_attempt_id: '23333333-3333-4333-8333-333333333333',
  provider: 'stripe',
  provider_mode: 'test',
  provider_platform: 'acct_TestPlatform',
  payment_intent_ref: 'pi_OriginalPayment',
  amount_cents: 8825,
  currency: 'CAD',
  operation_id: '23444444-4444-4444-8444-444444444444',
  idempotency_key:
    'uu:test:acct_TestPlatform:refund:23444444-4444-4444-8444-444444444444',
  refund_ref: null,
  state: 'in_flight',
  request_started_at: '2026-10-21T12:00:00Z',
  lease: '23555555-5555-4555-8555-555555555555',
  lease_until: '2026-10-21T12:03:00Z',
  attempts: 1,
  claim_kind: 'execute',
  provider_customer_ref: 'cus_Buyer',
  provider_instrument_ref: 'pm_Card',
  provider_seller_account_ref: 'acct_Seller',
  provider_transfer_group: 'uu_order_23222222-2222-4222-8222-222222222222',
  provider_amount_cents: 10825,
  provider_currency: 'CAD',
}

function intent(overrides = {}) {
  return {
    id: claim.payment_intent_ref,
    livemode: false,
    status: 'succeeded',
    amount: claim.provider_amount_cents,
    amount_received: claim.provider_amount_cents,
    currency: 'cad',
    customer: claim.provider_customer_ref,
    payment_method: claim.provider_instrument_ref,
    on_behalf_of: claim.provider_seller_account_ref,
    transfer_group: claim.provider_transfer_group,
    metadata: {
      uu_kind: 'marketplace_order',
      uu_order: claim.order_id,
      uu_attempt: claim.payment_attempt_id,
      uu_environment: 'staging',
    },
    ...overrides,
  }
}

function refund(overrides = {}) {
  return {
    id: 're_Refund',
    livemode: false,
    payment_intent: claim.payment_intent_ref,
    amount: claim.amount_cents,
    currency: 'cad',
    status: 'succeeded',
    metadata: {
      uu_kind: 'marketplace_order_refund',
      uu_order: claim.order_id,
      uu_attempt: claim.payment_attempt_id,
      uu_operation: claim.operation_id,
      uu_environment: 'staging',
    },
    ...overrides,
  }
}

function state(overrides = {}) {
  return {
    runtimeCalls: 0,
    rpc: [],
    lists: [],
    creates: [],
    retrieves: [],
    pages: [{ data: [], has_more: false }],
    intent: intent(),
    createdRefund: refund(),
    eventClaims: [],
    candidates: [],
    preparedOrders: [],
    preparedOperation: null,
    ...overrides,
  }
}

function loadAdapter(stateValue) {
  const file = path.resolve('lib/server/stripe-order-refund.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const stripe = {
    paymentIntents: {
      retrieve: async () => {
        if (stateValue.intentError) throw stateValue.intentError
        return stateValue.intent
      },
    },
    refunds: {
      list: async (params) => {
        stateValue.lists.push(params)
        if (stateValue.listError) throw stateValue.listError
        return (
          stateValue.pages[stateValue.lists.length - 1] || {
            data: [],
            has_more: false,
          }
        )
      },
      create: async (params, options) => {
        stateValue.creates.push({ params, options })
        if (stateValue.createError) throw stateValue.createError
        return stateValue.createdRefund
      },
      retrieve: async (id) => {
        stateValue.retrieves.push(id)
        if (stateValue.retrieveError) throw stateValue.retrieveError
        return stateValue.retrievedRefund || refund({ id })
      },
    },
  }
  const financial = {
    createTrustedFinancialClient: () => ({
      rpc: async (name, args) => {
        stateValue.rpc.push({ name, args })
        if (stateValue.rpcError)
          return { data: null, error: stateValue.rpcError }
        if (name === 'marketplace_order_refund_operation') {
          if (args.p_action === 'claim_due')
            return { data: stateValue.claim || null, error: null }
          if (args.p_action === 'read')
            return { data: stateValue.preparedOperation, error: null }
          if (args.p_action === 'prepare') {
            stateValue.preparedOrders.push(args.p_order)
            return { data: { ...claim, required: true }, error: null }
          }
        }
        if (name === 'marketplace_order_refund_candidates')
          return { data: stateValue.candidates, error: null }
        if (name === 'marketplace_order_refund_events') {
          if (args.p_action === 'claim')
            return { data: stateValue.eventClaims.shift() || null, error: null }
          return { data: {}, error: null }
        }
        const status = args.p_value.providerStatus || null
        return {
          data: {
            ...claim,
            result:
              args.p_action === 'defer'
                ? 'deferred'
                : status === 'requires_action'
                ? 'exception'
                : status === 'pending'
                ? 'pending'
                : 'applied',
            provider_status: status,
            last_error_code: args.p_value.errorCode || null,
          },
          error: null,
        }
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
          stripeRuntime: async () => {
            stateValue.runtimeCalls++
            return {
              config: { platform: 'acct_TestPlatform' },
              stripe,
            }
          },
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const original = process.env.STRIPE_ORDER_REFUNDS_ENABLED
  try {
    delete process.env.STRIPE_ORDER_REFUNDS_ENABLED
    const disabled = state({ claim })
    await assert.rejects(
      () => loadAdapter(disabled).drainStripeOrderRefunds(),
      (error) => error.status === 503
    )
    assert.equal(disabled.runtimeCalls, 0)
    assert.equal(disabled.rpc.length, 0)
    const disabledWork = await loadAdapter(
      disabled
    ).drainStripeOrderRefundWork()
    assert.equal(disabledWork.enabled, false)
    assert.equal(disabled.runtimeCalls, 0)
    assert.equal(disabled.rpc.length, 0)

    process.env.STRIPE_ORDER_REFUNDS_ENABLED = 'true'
    const happy = state()
    const happyResult = await loadAdapter(happy).processClaimedOrderRefund(
      claim
    )
    assert.equal(happyResult.result, 'applied')
    assert.equal(happy.creates.length, 1)
    assert.equal(happy.creates[0].options.idempotencyKey, claim.idempotency_key)
    assert.deepEqual(happy.creates[0].params, {
      payment_intent: claim.payment_intent_ref,
      amount: claim.amount_cents,
      reason: 'requested_by_customer',
      metadata: {
        uu_kind: 'marketplace_order_refund',
        uu_order: claim.order_id,
        uu_attempt: claim.payment_attempt_id,
        uu_operation: claim.operation_id,
        uu_environment: 'staging',
      },
    })
    assert(!('stripeAccount' in happy.creates[0].options))
    assert(!('reverse_transfer' in happy.creates[0].params))
    assert(!('refund_application_fee' in happy.creates[0].params))

    const partial = state({
      createdRefund: refund({ amount: 8825 }),
    })
    await loadAdapter(partial).processClaimedOrderRefund(claim)
    assert.equal(partial.creates[0].params.amount, 8825)
    const fullClaim = { ...claim, amount_cents: 10825 }
    const full = state({ createdRefund: refund({ amount: 10825 }) })
    await loadAdapter(full).processClaimedOrderRefund(fullClaim)
    assert.equal(full.creates[0].params.amount, 10825)

    const existing = state({
      pages: [{ data: [refund()], has_more: false }],
    })
    await loadAdapter(existing).processClaimedOrderRefund(claim)
    assert.equal(existing.creates.length, 0)
    assert.equal(existing.rpc.at(-1).args.p_action, 'apply')

    const conflict = state({
      pages: [
        {
          data: [
            refund({
              id: 're_Manual',
              metadata: { uu_operation: 'someone_else' },
            }),
          ],
          has_more: false,
        },
      ],
    })
    await loadAdapter(conflict).processClaimedOrderRefund(claim)
    assert.equal(conflict.creates.length, 0)
    assert.equal(conflict.rpc.at(-1).args.p_action, 'defer')
    assert.equal(
      conflict.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const paginatedConflict = state({
      pages: [
        { data: [refund()], has_more: true },
        {
          data: [
            refund({
              id: 're_LaterManual',
              metadata: { uu_operation: 'later_manual_refund' },
            }),
          ],
          has_more: false,
        },
      ],
    })
    await loadAdapter(paginatedConflict).processClaimedOrderRefund(claim)
    assert.equal(paginatedConflict.lists.length, 2)
    assert.equal(paginatedConflict.creates.length, 0)
    assert.equal(
      paginatedConflict.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const unknown = state({ createError: new Error('timeout') })
    await loadAdapter(unknown).processClaimedOrderRefund(claim)
    assert.equal(unknown.creates.length, 1)
    assert.equal(unknown.rpc.at(-1).args.p_value.errorCode, 'unknown_outcome')
    const reconcile = state()
    await loadAdapter(reconcile).processClaimedOrderRefund({
      ...claim,
      claim_kind: 'reconcile',
      state: 'reconciling',
      attempts: 2,
    })
    assert.equal(reconcile.creates.length, 0)
    assert.equal(reconcile.rpc.at(-1).args.p_value.errorCode, 'unknown_outcome')

    const byReference = state({
      retrievedRefund: refund({ id: 're_Existing' }),
    })
    await loadAdapter(byReference).processClaimedOrderRefund({
      ...claim,
      refund_ref: 're_Existing',
      claim_kind: 'reconcile',
      state: 'reconciling',
    })
    assert.deepEqual(byReference.retrieves, ['re_Existing'])
    assert.equal(byReference.creates.length, 0)

    for (const [label, overrides] of [
      ['amount', { amount: 1 }],
      ['currency', { currency: 'usd' }],
      ['payment', { payment_intent: 'pi_Other' }],
      ['metadata', { metadata: { uu_operation: 'other' } }],
    ]) {
      const invalid = state({
        pages: [{ data: [refund(overrides)], has_more: false }],
      })
      await loadAdapter(invalid).processClaimedOrderRefund(claim)
      assert.equal(invalid.creates.length, 0, label)
      assert.equal(
        invalid.rpc.at(-1).args.p_value.errorCode,
        'provider_mismatch',
        label
      )
    }

    for (const status of [
      'pending',
      'succeeded',
      'failed',
      'canceled',
      'requires_action',
    ]) {
      const mapped = state({ createdRefund: refund({ status }) })
      await loadAdapter(mapped).processClaimedOrderRefund(claim)
      assert.equal(mapped.rpc.at(-1).args.p_value.providerStatus, status)
    }

    const badIntent = state({ intent: intent({ amount: 1 }) })
    await loadAdapter(badIntent).processClaimedOrderRefund(claim)
    assert.equal(badIntent.creates.length, 0)
    assert.equal(
      badIntent.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const drained = state({ claim })
    const drainResult = await loadAdapter(drained).drainStripeOrderRefunds(1)
    assert.equal(drainResult.processed, 1)
    assert.equal(drained.rpc[0].name, 'marketplace_order_refund_operation')

    const eventClaim = {
      eventId: 'evt_Refund',
      eventType: 'refund.updated',
      providerReference: 're_Refund',
      lease: '23666666-6666-4666-8666-666666666666',
    }
    const eventState = state({
      eventClaims: [eventClaim],
      preparedOperation: claim,
      retrievedRefund: refund(),
    })
    const eventResult = await loadAdapter(
      eventState
    ).drainStripeOrderRefundEvents(1)
    assert.deepEqual(eventResult, { processed: 1, retried: 0, mismatches: 0 })
    assert.deepEqual(eventState.retrieves, ['re_Refund'])
    const eventDone = eventState.rpc.find(
      (call) =>
        call.name === 'marketplace_order_refund_events' &&
        call.args.p_action === 'done'
    )
    assert(eventDone)
    assert.equal(eventDone.args.p_value.metadataOperation, claim.operation_id)
    assert.equal(eventDone.args.p_value.amount, String(claim.amount_cents))

    const unavailableEvent = state({
      eventClaims: [eventClaim],
      retrieveError: new Error('timeout'),
    })
    await loadAdapter(unavailableEvent).drainStripeOrderRefundEvents(1)
    assert.equal(
      unavailableEvent.rpc.at(-1).args.p_value.reason,
      'provider_unavailable'
    )

    const unboundEvent = state({
      eventClaims: [eventClaim],
      retrievedRefund: refund(),
    })
    await loadAdapter(unboundEvent).drainStripeOrderRefundEvents(1)
    assert.equal(
      unboundEvent.rpc.at(-1).args.p_value.reason,
      'operation_unavailable'
    )

    const mismatchEvent = state({
      eventClaims: [eventClaim],
      retrievedRefund: refund({
        metadata: {
          uu_kind: 'shop_membership_refund',
          uu_order: claim.order_id,
          uu_operation: claim.operation_id,
          uu_environment: 'staging',
        },
      }),
    })
    await loadAdapter(mismatchEvent).drainStripeOrderRefundEvents(1)
    assert.equal(mismatchEvent.rpc.at(-1).args.p_action, 'done_mismatch')

    const discovery = state({
      candidates: [{ order_id: claim.order_id }, { order_id: 'order-stale' }],
    })
    const discoveryResult = await loadAdapter(
      discovery
    ).prepareAuthorizedOrderRefunds(2)
    assert.deepEqual(discoveryResult, { prepared: 2, skipped: 0 })
    assert.deepEqual(discovery.preparedOrders, [claim.order_id, 'order-stale'])

    const workerSource = fs.readFileSync('pages/api/stripe/worker.ts', 'utf8')
    assert(workerSource.includes('drainStripeOrderRefundWork'))
    assert(
      workerSource.indexOf('drainStripeOrderPayments()') <
        workerSource.indexOf('drainStripeOrderRefundWork()')
    )

    const source = fs.readFileSync('lib/server/stripe-order-refund.ts', 'utf8')
    assert(
      !/transfers\.create|payouts\.create|reverse_transfer\s*:|refund_application_fee\s*:/.test(
        source
      )
    )
    console.log(
      'PASS B23-B/C default-off gate, frozen bindings, execute-once idempotency, authoritative Refund retrieval, event retry/isolation, bounded discovery and no transfer/payout'
    )
  } finally {
    if (original === undefined) delete process.env.STRIPE_ORDER_REFUNDS_ENABLED
    else process.env.STRIPE_ORDER_REFUNDS_ENABLED = original
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

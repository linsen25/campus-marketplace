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
  id: '24111111-1111-4111-8111-111111111111',
  order_id: '24222222-2222-4222-8222-222222222222',
  payment_attempt_id: '24333333-3333-4333-8333-333333333333',
  seller_id: '24444444-4444-4444-8444-444444444444',
  transfer_kind: 'sale_proceeds',
  provider: 'stripe',
  provider_mode: 'test',
  provider_platform: 'acct_TestPlatform',
  payment_intent_ref: 'pi_OriginalPayment',
  destination_account_ref: 'acct_Seller',
  amount_cents: 10000,
  currency: 'CAD',
  transfer_group: 'uu_order_24222222-2222-4222-8222-222222222222',
  operation_id: '24555555-5555-4555-8555-555555555555',
  idempotency_key:
    'uu:test:acct_TestPlatform:transfer:24555555-5555-4555-8555-555555555555',
  transfer_ref: null,
  source_charge_ref: null,
  state: 'in_flight',
  lease: '24666666-6666-4666-8666-666666666666',
  claim_kind: 'execute',
}

function intent(overrides = {}) {
  return {
    id: claim.payment_intent_ref,
    livemode: false,
    status: 'succeeded',
    amount: 10825,
    amount_received: 10825,
    currency: 'cad',
    on_behalf_of: claim.destination_account_ref,
    latest_charge: 'ch_Source',
    transfer_group: claim.transfer_group,
    metadata: {
      uu_kind: 'marketplace_order',
      uu_order: claim.order_id,
      uu_attempt: claim.payment_attempt_id,
      uu_environment: 'staging',
    },
    ...overrides,
  }
}

function charge(overrides = {}) {
  return {
    id: 'ch_Source',
    livemode: false,
    paid: true,
    captured: true,
    status: 'succeeded',
    disputed: false,
    amount: 10825,
    amount_refunded: 0,
    currency: 'cad',
    payment_intent: claim.payment_intent_ref,
    on_behalf_of: claim.destination_account_ref,
    transfer_group: claim.transfer_group,
    metadata: {
      uu_order: claim.order_id,
      uu_attempt: claim.payment_attempt_id,
    },
    ...overrides,
  }
}

function transfer(overrides = {}) {
  return {
    id: 'tr_Transfer',
    amount: claim.amount_cents,
    amount_reversed: 0,
    currency: 'cad',
    destination: claim.destination_account_ref,
    livemode: false,
    reversed: false,
    source_transaction: 'ch_Source',
    transfer_group: claim.transfer_group,
    metadata: {
      uu_kind: 'marketplace_order_transfer',
      uu_order: claim.order_id,
      uu_attempt: claim.payment_attempt_id,
      uu_operation: claim.operation_id,
      uu_transfer_kind: claim.transfer_kind,
      uu_environment: 'staging',
    },
    ...overrides,
  }
}

function state(overrides = {}) {
  return {
    runtimeCalls: 0,
    rpc: [],
    creates: [],
    retrieves: [],
    pages: [{ data: [], has_more: false }],
    intent: intent(),
    charge: charge(),
    account: {
      id: claim.destination_account_ref,
      details_submitted: true,
      capabilities: { transfers: 'active' },
    },
    createdTransfer: transfer(),
    eventClaims: [],
    candidates: [],
    preparedOperation: claim,
    ...overrides,
  }
}

function loadAdapter(value) {
  const code = ts.transpileModule(
    fs.readFileSync(
      path.resolve('lib/server/stripe-order-transfer.ts'),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText
  const module = { exports: {} }
  const stripe = {
    accounts: { retrieve: async () => value.account },
    paymentIntents: { retrieve: async () => value.intent },
    charges: { retrieve: async () => value.charge },
    transfers: {
      list: async () => value.pages.shift() || { data: [], has_more: false },
      create: async (params, options) => {
        value.creates.push({ params, options })
        if (value.createError) throw value.createError
        return value.createdTransfer
      },
      retrieve: async (id) => {
        value.retrieves.push(id)
        if (value.retrieveError) throw value.retrieveError
        return value.retrievedTransfer || transfer({ id })
      },
    },
  }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/listing-validation')
        return { ListingApiError: ApiError }
      if (name === '@/lib/server/stripe-runtime')
        return {
          stripeRuntime: async () => {
            value.runtimeCalls++
            return { config: { platform: claim.provider_platform }, stripe }
          },
        }
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          createTrustedFinancialClient: () => ({
            rpc: async (rpcName, args) => {
              value.rpc.push({ name: rpcName, args })
              if (rpcName === 'marketplace_order_transfer_operation') {
                if (args.p_action === 'claim_due')
                  return { data: value.claim || null, error: null }
                if (args.p_action === 'prepare')
                  return { data: claim, error: null }
                return { data: value.preparedOperation, error: null }
              }
              if (rpcName === 'marketplace_order_transfer_candidates')
                return { data: value.candidates, error: null }
              if (rpcName === 'marketplace_order_transfer_events') {
                if (args.p_action === 'claim')
                  return {
                    data: value.eventClaims.shift() || null,
                    error: null,
                  }
                return { data: {}, error: null }
              }
              return {
                data: {
                  ...claim,
                  result:
                    args.p_action === 'defer'
                      ? args.p_value.errorCode === 'provider_mismatch'
                        ? 'exception'
                        : 'deferred'
                      : 'applied',
                },
                error: null,
              }
            },
          }),
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const enabled = process.env.STRIPE_ORDER_TRANSFERS_ENABLED
  const approved = process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED
  try {
    delete process.env.STRIPE_ORDER_TRANSFERS_ENABLED
    delete process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED
    const disabled = state({ claim })
    const disabledResult = await loadAdapter(
      disabled
    ).drainStripeOrderTransferWork()
    assert.equal(disabledResult.enabled, false)
    assert.equal(disabled.runtimeCalls, 0)
    assert.equal(disabled.rpc.length, 0)

    process.env.STRIPE_ORDER_TRANSFERS_ENABLED = 'true'
    const oneGate = state({ claim })
    assert.equal(
      (await loadAdapter(oneGate).drainStripeOrderTransferWork()).enabled,
      false
    )
    assert.equal(oneGate.runtimeCalls, 0)

    process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED = 'true'
    const happy = state()
    const result = await loadAdapter(happy).processClaimedOrderTransfer(claim)
    assert.equal(result.result, 'applied')
    assert.equal(happy.creates.length, 1)
    assert.equal(happy.creates[0].options.idempotencyKey, claim.idempotency_key)
    assert.equal(happy.creates[0].params.source_transaction, 'ch_Source')
    assert.equal(
      happy.creates[0].params.destination,
      claim.destination_account_ref
    )
    assert.equal(happy.creates[0].params.amount, claim.amount_cents)
    assert.equal(happy.creates[0].params.transfer_group, claim.transfer_group)
    assert(!('stripeAccount' in happy.creates[0].options))

    const existing = state({
      pages: [{ data: [transfer()], has_more: false }],
    })
    await loadAdapter(existing).processClaimedOrderTransfer(claim)
    assert.equal(existing.creates.length, 0)

    const reconcile = state()
    await loadAdapter(reconcile).processClaimedOrderTransfer({
      ...claim,
      claim_kind: 'reconcile',
      state: 'reconciling',
    })
    assert.equal(reconcile.creates.length, 0)
    assert.equal(reconcile.rpc.at(-1).args.p_value.errorCode, 'unknown_outcome')

    const unknown = state({ createError: new Error('timeout') })
    await loadAdapter(unknown).processClaimedOrderTransfer(claim)
    assert.equal(unknown.creates.length, 1)
    assert.equal(unknown.rpc.at(-1).args.p_value.errorCode, 'unknown_outcome')
    const insufficientError = new Error('balance unavailable')
    insufficientError.code = 'balance_insufficient'
    const insufficient = state({ createError: insufficientError })
    await loadAdapter(insufficient).processClaimedOrderTransfer(claim)
    assert.equal(
      insufficient.rpc.at(-1).args.p_value.errorCode,
      'insufficient_funds'
    )

    const recipient = state({
      account: {
        id: claim.destination_account_ref,
        details_submitted: true,
        capabilities: { transfers: 'inactive' },
      },
    })
    await loadAdapter(recipient).processClaimedOrderTransfer(claim)
    assert.equal(recipient.creates.length, 0)
    assert.equal(
      recipient.rpc.at(-1).args.p_value.errorCode,
      'recipient_not_ready'
    )

    const mismatch = state({ charge: charge({ disputed: true }) })
    await loadAdapter(mismatch).processClaimedOrderTransfer(claim)
    assert.equal(mismatch.creates.length, 0)
    assert.equal(
      mismatch.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const compensationClaim = {
      ...claim,
      transfer_kind: 'delivery_compensation',
      amount_cents: 2000,
    }
    const compensation = state({ charge: charge({ amount_refunded: 8825 }) })
    await loadAdapter(compensation).processClaimedOrderTransfer(
      compensationClaim
    )
    assert.equal(compensation.creates[0].params.amount, 2000)
    const overspent = state({ charge: charge({ amount_refunded: 8000 }) })
    await loadAdapter(overspent).processClaimedOrderTransfer(compensationClaim)
    assert.equal(overspent.creates.length, 0)
    assert.equal(
      overspent.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const conflicting = state({
      pages: [
        {
          data: [
            transfer({
              id: 'tr_Other',
              metadata: { uu_operation: 'other' },
            }),
          ],
          has_more: false,
        },
      ],
    })
    await loadAdapter(conflicting).processClaimedOrderTransfer(claim)
    assert.equal(conflicting.creates.length, 0)
    assert.equal(
      conflicting.rpc.at(-1).args.p_value.errorCode,
      'provider_mismatch'
    )

    const reversed = state({
      pages: [
        {
          data: [
            transfer({ amount_reversed: claim.amount_cents, reversed: true }),
          ],
          has_more: false,
        },
      ],
    })
    await loadAdapter(reversed).processClaimedOrderTransfer(claim)
    assert.equal(reversed.rpc.at(-1).args.p_value.reversed, true)
    assert.equal(
      reversed.rpc.at(-1).args.p_value.amountReversed,
      String(claim.amount_cents)
    )

    const event = {
      eventId: 'evt_Transfer',
      eventType: 'transfer.updated',
      providerReference: 'tr_Transfer',
      lease: '24777777-7777-4777-8777-777777777777',
    }
    const eventState = state({
      eventClaims: [event],
      retrievedTransfer: transfer(),
    })
    const work = await loadAdapter(eventState).drainStripeOrderTransferWork(1)
    assert.equal(work.enabled, true)
    assert.equal(work.events.processed, 1)
    assert(eventState.rpc.some((call) => call.args.p_action === 'done'))

    const worker = fs.readFileSync('pages/api/stripe/worker.ts', 'utf8')
    const recovery = fs.readFileSync(
      'lib/server/stripe-operational-recovery.ts',
      'utf8'
    )
    assert(worker.includes('drainStripeOperationalRecovery'))
    assert(recovery.includes('drainStripeOrderTransferWork'))
    assert(
      recovery.indexOf("runStep('orderRefunds'") <
        recovery.indexOf("runStep('orderTransfers'")
    )
    const source = fs.readFileSync(
      'lib/server/stripe-order-transfer.ts',
      'utf8'
    )
    assert(!/payouts\.create|createReversal/.test(source))
    console.log(
      'PASS B24-B default-off gates, frozen source Charge and destination, Transfer idempotency, unknown recovery, conservation, event isolation and no bank Payout'
    )
  } finally {
    if (enabled === undefined) delete process.env.STRIPE_ORDER_TRANSFERS_ENABLED
    else process.env.STRIPE_ORDER_TRANSFERS_ENABLED = enabled
    if (approved === undefined)
      delete process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED
    else process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED = approved
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

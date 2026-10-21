const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(file) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    require,
    module,
    module.exports
  )
  return module.exports
}

const {
  decideOrderPaymentEvidence,
  decidePaymentRetry,
  paymentModeUsesProvider,
} = load('lib/server/payment-provider-boundary.ts')

const attempt = {
  provider: 'stripe',
  mode: 'test',
  platformAccountId: 'acct_platform',
  purpose: 'marketplace_order',
  operationId: 'op_order_1',
  idempotencyKey: 'order-attempt-1',
  attemptId: 'attempt-1',
  providerReference: 'pi_1',
}
const economics = {
  orderId: 'order-1',
  currency: 'CAD',
  itemCents: 8000,
  deliveryCents: 0,
  buyerServiceFeeCents: 400,
  buyerTotalCents: 8400,
  sellerGrossCents: 8000,
  sellerPlatformFeeCents: 0,
}
const expected = {
  attempt,
  economics,
  providerCustomerId: 'cus_buyer',
}
const empty = { evidenceIds: [], terminalOutcome: null }
function evidence(overrides = {}) {
  return {
    trust: 'server_verified',
    source: 'stripe_server_retrieval',
    evidenceId: 'evt_1',
    observedAt: '2026-10-20T12:00:00.000Z',
    binding: {
      provider: 'stripe',
      mode: 'test',
      platformAccountId: 'acct_platform',
      purpose: 'marketplace_order',
      operationId: 'op_order_1',
      providerReference: 'pi_1',
      orderId: 'order-1',
      attemptId: 'attempt-1',
      providerCustomerId: 'cus_buyer',
      amountCents: 8400,
      currency: 'CAD',
    },
    outcome: 'SUCCESS',
    terminal: true,
    ...overrides,
  }
}

assert.equal(
  decideOrderPaymentEvidence(
    expected,
    evidence({
      source: 'stripe_signed_webhook',
      outcome: 'RECONCILIATION_REQUIRED',
      terminal: false,
    }),
    'payment_open',
    empty
  ).action,
  'reconcile_existing'
)

const paid = decideOrderPaymentEvidence(
  expected,
  evidence(),
  'payment_open',
  empty
)
assert.deepEqual(paid, { action: 'apply_paid', evidenceId: 'evt_1' })

for (const source of ['client', 'simulator', 'offer_accept']) {
  assert.equal(
    decideOrderPaymentEvidence(
      expected,
      { trust: 'unverified', source, claimedOutcome: 'SUCCESS' },
      'payment_open',
      empty
    ).action,
    'reject'
  )
}

for (const bindingChange of [
  { purpose: 'shop_membership' },
  { orderId: 'another-order' },
  { attemptId: 'another-attempt' },
  { providerCustomerId: 'another-customer' },
  { amountCents: 8399 },
  { currency: 'USD' },
  { platformAccountId: 'acct_other' },
  { mode: 'live' },
]) {
  const mismatched = evidence({
    binding: { ...evidence().binding, ...bindingChange },
  })
  assert.equal(
    decideOrderPaymentEvidence(expected, mismatched, 'payment_open', empty)
      .action,
    'reject'
  )
}

for (const outcome of ['UNKNOWN', 'RECONCILIATION_REQUIRED']) {
  const decision = decideOrderPaymentEvidence(
    expected,
    evidence({ outcome, terminal: false }),
    'payment_open',
    empty
  )
  assert.equal(decision.action, 'reconcile_existing')
}

const afterTimeout = decideOrderPaymentEvidence(
  expected,
  evidence({
    evidenceId: 'evt_late_success',
  }),
  'payment_open',
  empty
)
assert.deepEqual(afterTimeout, {
  action: 'apply_paid',
  evidenceId: 'evt_late_success',
})

assert.equal(
  decideOrderPaymentEvidence(
    expected,
    evidence({ outcome: 'FAILURE' }),
    'payment_open',
    empty
  ).action,
  'apply_failed'
)
assert.equal(
  decideOrderPaymentEvidence(
    expected,
    evidence(),
    'cancellation_pending',
    empty
  ).action,
  'retain_for_cancellation_resolution'
)
assert.equal(
  decideOrderPaymentEvidence(expected, evidence(), 'cancelled', empty).action,
  'retain_for_cancellation_resolution'
)
assert.equal(
  decideOrderPaymentEvidence(expected, evidence(), 'terminal', empty).action,
  'conflict_review'
)
assert.equal(
  decideOrderPaymentEvidence(expected, evidence(), 'payment_open', {
    evidenceIds: ['evt_1'],
    terminalOutcome: 'SUCCESS',
  }).action,
  'duplicate'
)
assert.equal(
  decideOrderPaymentEvidence(
    expected,
    evidence({ evidenceId: 'evt_late_failure', outcome: 'FAILURE' }),
    'payment_open',
    { evidenceIds: ['evt_1'], terminalOutcome: 'SUCCESS' }
  ).action,
  'conflict_review'
)
assert.equal(
  decideOrderPaymentEvidence(
    expected,
    evidence({ evidenceId: 'evt_same_failure', outcome: 'FAILURE' }),
    'payment_open',
    { evidenceIds: ['evt_first_failure'], terminalOutcome: 'FAILURE' }
  ).action,
  'duplicate'
)

assert.equal(decidePaymentRetry(attempt, null).action, 'reuse_attempt')
for (const outcome of ['UNKNOWN', 'RECONCILIATION_REQUIRED']) {
  const retry = decidePaymentRetry(attempt, {
    identity: attempt,
    providerReference: 'pi_1',
    outcome,
  })
  assert.equal(retry.action, 'reconcile_attempt')
  assert.equal(retry.attempt.attemptId, attempt.attemptId)
  assert.equal(retry.attempt.idempotencyKey, attempt.idempotencyKey)
  assert.equal(retry.attempt.providerReference, attempt.providerReference)
}
assert.equal(
  decidePaymentRetry(attempt, {
    identity: { ...attempt, idempotencyKey: 'fresh-charge-key' },
    providerReference: 'pi_2',
    outcome: 'SUCCESS',
  }).action,
  'reject'
)
assert.equal(
  decidePaymentRetry(attempt, {
    identity: attempt,
    providerReference: 'pi_1',
    outcome: 'SUCCESS',
  }).action,
  'reconcile_attempt'
)
assert.equal(
  decidePaymentRetry(attempt, {
    identity: attempt,
    providerReference: 'pi_1',
    outcome: 'FAILURE',
  }).action,
  'reuse_attempt'
)

assert.equal(paymentModeUsesProvider('external'), false)
assert.equal(paymentModeUsesProvider('uu_pay'), true)

const simulator = fs.readFileSync(
  'lib/server/order-financial-service.ts',
  'utf8'
)
assert(simulator.includes('Server-only trusted simulator'))
assert(simulator.includes("process.env.STRIPE_PROVIDER_ENABLED === 'true'"))

const shopMigration = fs.readFileSync(
  'supabase/migrations/202610190004_shop_product_publication.sql',
  'utf8'
)
assert.equal(
  (
    shopMigration.match(
      /execute function marketplace_private\.guard_new_shop_transaction\(\)/g
    ) || []
  ).length,
  3
)

console.log(
  'PASS B20 provider contract: trusted evidence, purpose/binding isolation, unknown recovery, stable retry identity, duplicate/conflict handling, cancellation race, external exclusion, simulator isolation, B14 guards'
)

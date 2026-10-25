// B28-A static runtime-contract regression. No env files, network or provider calls.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const read = (file) => fs.readFileSync(file, 'utf8')
const worker = read('pages/api/stripe/worker.ts')
const webhook = read('lib/server/stripe-webhook-handler.ts')
const recovery = read('lib/server/stripe-operational-recovery.ts')
const setup = read('lib/server/stripe-setup.ts')
const payment = read('lib/server/stripe-order-reconciliation.ts')
const scheduler = read(
  'supabase/migrations/20261023190043_worker_runtime_reliability.sql'
)
const email = read('supabase/functions/notification-email-worker/worker.js')
const emailEntry = read('supabase/functions/notification-email-worker/index.ts')
const observability = read('lib/server/worker-observability.ts')
const observabilitySql = read(
  'supabase/migrations/20261023224905_worker_observability.sql'
)

assert.match(worker, /req\.method !== 'POST'.*status\(405\)/s)
assert.match(worker, /timingSafeEqual\(actualBytes, expectedBytes\)/)
assert.match(worker, /expected\.length >= 32/)
assert.match(worker, /status\(401\)/)
assert.match(worker, /Cache-Control', 'no-store'/)
assert.match(worker, /const scheduledBatchLimit = 2/)
assert.match(worker, /Promise\.allSettled/)
assert.match(worker, /status\(degraded \? 503 : 200\)/)
assert.match(worker, /runtimeStatus/)
assert.match(worker, /startStripeWorkerRun/)
assert.match(worker, /finishStripeWorkerRun/)
assert.match(worker, /financial_coordinator_failed/)
assert.match(worker, /shop_lifecycle_failed/)
assert.match(worker, /processedCount: financialProcessed \+ shopProcessed/)

for (const route of [
  'pages/api/stripe/webhook.ts',
  'pages/api/stripe/connect-webhook.ts',
  'pages/api/stripe/account-webhook.ts',
]) {
  assert.match(read(route), /bodyParser: false/)
}
assert.match(webhook, /signature\.length > 2048/)
assert.match(webhook, /size > 262144/)
assert.match(webhook, /await receiveStripeEvent/)
assert.match(webhook, /Unable to record Stripe event/)

assert.match(
  setup,
  /if \(!stripeRequested\(\)\) return \{ enabled: false, processed: 0 \}/
)
assert.match(payment, /STRIPE_ORDER_PAYMENTS_ENABLED !== 'true'/)
assert.match(recovery, /'configuration_missing' \| 'retryable_failure'/)
assert.match(
  recovery,
  /'completed' \| 'disabled' \| 'idle' \| 'needs_attention'/
)
assert.match(recovery, /Math\.max\(1, Math\.min\(limit, 20\)\)/)

assert.equal(
  scheduler.match(/limit batch_limit/g)?.length,
  3,
  'Offer, Order and Reminder scans each have an independent bound'
)
assert.match(scheduler, /pg_try_advisory_xact_lock/)
assert.match(scheduler, /batch_limit constant integer:=50/)

assert.match(emailEntry, /request\.method !== 'POST'/)
assert.match(emailEntry, /raw\.length > 128/)
assert.match(emailEntry, /No client-selected email content allowed/)
assert.match(emailEntry, /AbortSignal.*timeout/s)
assert.match(email, /p_limit: 3/)
assert.match(emailEntry, /Idempotency-Key/)
assert.match(email, /response\.status === 429 \|\| response\.status >= 500/)
assert.match(email, /frozen payload and key/i)
assert.match(emailEntry, /marketplace_worker_observability/)
assert.match(emailEntry, /email_configuration_missing/)
assert.match(emailEntry, /result\.failed > 0[\s\S]*'degraded'/)

assert.match(observability, /createTrustedFinancialClient/)
assert.match(observability, /STRIPE_PLATFORM_ACCOUNT_ID/)
assert.doesNotMatch(observability, /stripeRuntime|stripeClient/)
assert.match(observabilitySql, /worker_runtime_runs/)
assert.match(observabilitySql, /worker_queue_snapshot/)
assert.match(observabilitySql, /limit 10001/g)
assert.match(observabilitySql, /status='interrupted'/)
assert.match(observabilitySql, /scheduler_missing:/)
assert.match(
  observabilitySql,
  /Notification email worker returned a non-success status/
)
assert.match(observabilitySql, /grant execute.*service_role/s)
assert(
  (observabilitySql.match(/^grant execute.*$/gm) || []).every((line) =>
    line.includes('service_role')
  )
)

assert.equal(
  fs.existsSync('vercel.json'),
  false,
  'No local file may be mistaken for an installed hosted Worker schedule'
)

console.log(
  'PASS B28 runtime contracts: Worker auth/status/bounds, webhook durability, feature gates, scheduler bounds and email idempotency'
)

// B32 offline qualification. No Supabase or Stripe network calls.
const { spawnSync } = require('node:child_process')

const tests = [
  'tests/stripe-setup.cjs',
  'tests/stripe-setup-api.cjs',
  'tests/order-payment-b21.cjs',
  'tests/order-refund-b23.cjs',
  'tests/order-transfer-b24.cjs',
  'tests/stripe-dispute-b25.cjs',
  'tests/operational-recovery-b25.cjs',
  'tests/worker-runtime-b28.cjs',
  'tests/resale-verified-transaction-access.cjs',
]

let failed = false
for (const test of tests) {
  const result = spawnSync(process.execPath, [test], {
    stdio: 'inherit',
    env: { ...process.env, B32_OFFLINE_ONLY: 'true' },
  })
  if (result.status !== 0) failed = true
}

if (failed) process.exitCode = 1
else console.log(`PASS B32 offline qualification (${tests.length} suites)`)

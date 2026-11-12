// Stable, offline Release Candidate regression entry point.
// It never signs in, creates fixtures, or calls Supabase/Stripe.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const assert = require('node:assert/strict')

const browserE2e = fs.readFileSync(
  'tests/b32-browser-transaction-e2e.cjs',
  'utf8'
)
assert.match(browserE2e, /B32_E2E_CREATE_FIXTURES === '1'/)
assert.match(browserE2e, /Fixture creation is disabled by default/)
assert.match(browserE2e, /\['localhost', '127\.0\.0\.1'\]/)

const suites = [
  'tests/interac-email-verification.cjs',
  'tests/interac-payment-state.cjs',
  'tests/interac-settings.cjs',
  'tests/interac-completion-history-static.cjs',
  'tests/resale-verified-transaction-access.cjs',
  'tests/resale-order-projection-guards.cjs',
  'tests/listing-contact-reuse.cjs',
  'tests/meeting-location.cjs',
  'tests/order-domain-api.cjs',
  'tests/order-payment-ui.cjs',
  'tests/stripe-setup.cjs',
  'tests/stripe-binding-reconciliation.cjs',
]

let failed = false
for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], {
    stdio: 'inherit',
    env: { ...process.env, B32_OFFLINE_ONLY: 'true' },
  })
  if (result.status !== 0) failed = true
}

if (failed) process.exitCode = 1
else console.log(`PASS B32 Resale V3 RC offline regression (${suites.length} suites)`)

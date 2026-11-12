const assert = require('node:assert/strict')
const fs = require('node:fs')

const setup = fs.readFileSync('lib/server/stripe-setup.ts', 'utf8')
const onboarding = fs.readFileSync(
  'components/payments/stripe-account-onboarding.tsx',
  'utf8'
)
const settings = fs.readFileSync(
  'components/home/financial-settings.tsx',
  'utf8'
)
assert.match(
  setup,
  /identity:\s*\{\s*country:\s*'ca',\s*entity_type:\s*'individual'/
)
assert.match(setup, /contact_email: data\.user\.email/)
assert.doesNotMatch(setup, /business_profile:\s*\{[^}]*mcc\s*:/s)
assert.match(
  onboarding,
  /Stripe collects identity and payout information directly/
)
assert.match(onboarding, /UU does not display these private details to buyers/)
for (const status of [
  'Action required',
  'Submitted / Pending review',
  'Ready',
  'Unable to refresh',
  'Not available',
]) {
  assert.match(settings, new RegExp(status.replace(/[/?]/g, '\\$&')))
}
assert.doesNotMatch(settings, /Verification unavailable \/ failed/)
console.log('stripe resale onboarding defaults and privacy checks passed')

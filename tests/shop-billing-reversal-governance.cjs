const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-reversal-governance.ts'),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)

assert.match(environment, /SHOP_BILLING_REVERSAL_GOVERNANCE_ENABLED/)
assert.match(source, /resolveTrustedBillingReviewOperator/)
assert.match(source, /throw unavailable\(\)/)
assert.match(source, /marketplace_shop_billing_create_reversal_review_proposal/)
assert.match(
  source,
  /marketplace_shop_billing_approve_reversal_review_proposal/
)
assert.doesNotMatch(source, /service_role.*operator|operator.*service_role/i)
console.log(
  'PASS Billing reversal governance adapter contract: separately flagged and fail-closed without a trusted staff identity source.'
)

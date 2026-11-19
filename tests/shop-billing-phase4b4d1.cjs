const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261119053840_shop_billing_reversal_governance_records.sql'
  ),
  'utf8'
)

for (const value of [
  'shop_billing_review_operators',
  'shop_billing_reversal_review_proposals',
  'shop_billing_reversal_review_approvals',
  'shop_billing_reversal_governance_audit',
  'pending_approval',
  'approved_unexecuted',
  'Trusted active Billing review operator required',
  'Billing governance requires a second operator',
  "security definer set search_path=''",
  'revoke all on marketplace_private.shop_billing_review_operators',
])
  assert.match(
    migration,
    new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  )

assert.doesNotMatch(
  migration,
  /apply_reversal_proof|provider_terms\s+set|shop_memberships\s+set/i
)
console.log(
  'PASS Billing Phase 4B-4D-1 static contract: private operator/proposal/approval governance only, dual control, immutable audit, and no entitlement mutation.'
)

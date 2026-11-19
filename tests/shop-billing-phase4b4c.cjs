const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261119001659_shop_billing_reversal_manual_review.sql'
  ),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)
const adapter = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-reversal-reviews.ts'),
  'utf8'
)
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)

assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_reviews/
)
assert.match(
  migration,
  /pending_review','under_review','resolved_no_effect','escalated/
)
assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_review_audit/
)
assert.match(migration, /security definer set search_path=''/)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(migration, /for update/)
assert.match(
  migration,
  /v_state\.classification = 'verified_full_reversal' and v_state\.reversal_type = 'refund'/
)
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_billing_reversal_reviews/
)
assert.match(migration, /marketplace_shop_billing_register_reversal_review/)
assert.doesNotMatch(
  migration,
  /shop_membership_provider_terms set[\s\S]*revoked_at/
)
assert.doesNotMatch(migration, /shop_memberships set revision/)
assert.match(environment, /SHOP_BILLING_REVERSAL_REVIEW_ENABLED === 'true'/)
assert.match(adapter, /marketplace_shop_billing_register_reversal_review/)
assert.match(webhook, /registerShopBillingReversalReview/)

console.log(
  'PASS Shop Billing Phase 4B-4C static contract: service-only, evidence-only complex reversal review with no Provider Term or Membership mutation.'
)

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)
const route = fs.readFileSync(
  path.join(root, 'pages/api/shop/billing/webhook.ts'),
  'utf8'
)
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261117164538_shop_billing_webhook_foundation.sql'
  ),
  'utf8'
)

assert.match(route, /bodyParser: false/)
assert.match(
  webhook,
  /webhooks\.constructEvent\(\s*rawBody,\s*signature,\s*config\.webhookSecret\s*\)/
)
assert.match(
  webhook,
  /if \(event\.livemode \|\| \(event\.account && event\.account !== config\.platform\)\)/
)
assert.match(webhook, /subscriptions\.retrieve\(\s*subscriptionId\s*\)/)
assert.match(webhook, /marketplace_shop_billing_event_command/)
assert.match(webhook, /marketplace_shop_billing_sync_subscription/)
assert.doesNotMatch(
  webhook,
  /shop_membership_command|claimOwnTrial|marketplace_claim_shop_trial/
)
assert.match(migration, /lease_token uuid/)
assert.match(migration, /for update/)
assert.match(migration, /skip locked|pg_advisory_xact_lock|lease_until/)
assert.match(migration, /provider_updated_at/)
assert.match(migration, /shop_billing_audit_event_action_unique/)
assert.match(
  migration,
  /grant execute on function public\.marketplace_shop_billing_event_command[\s\S]*marketplace_shop_billing_sync_subscription[\s\S]*to service_role/
)
console.log(
  'PASS Shop Billing Phase 4A static contract: raw-body signature verification, Test-only inbox, leases, provider-state reconciliation, and no Membership mutation.'
)

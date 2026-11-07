const fs = require('fs')
const path = require('path')

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '202611060001_b31_buyer_receipt_protection.sql'
  ),
  'utf8'
)
const required = [
  "release_eligible_at = buyer_confirmed_at + interval '48 hours'",
  "p_source is distinct from 'buyer_received'",
  'marketplace_confirm_buyer_receipt',
  'marketplace_private.is_verified_user()',
  'p.release_eligible_at>t',
  'Buyer receipt protection is not released.',
  'on conflict (buyer_id,command) do nothing',
  "state in('prepared','in_flight','reconciling')",
  'pg_advisory_xact_lock(hashtextextended(',
  'p.completed_at<p.release_eligible_at',
  'order_transfer_b31_release_gate',
]
for (const fragment of required) {
  if (!migration.includes(fragment))
    throw new Error(`Missing B31 invariant: ${fragment}`)
}
if (migration.includes("STRIPE_PROVIDER_ENABLED='true'"))
  throw new Error('B31 migration must not enable Stripe')
console.log(`B31 static protection invariants PASS (${required.length})`)

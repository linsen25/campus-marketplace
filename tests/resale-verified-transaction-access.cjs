const fs = require('node:fs')
const assert = require('node:assert/strict')

const migration = fs.readFileSync(
  'supabase/migrations/202611080009_resale_verified_transaction_access.sql',
  'utf8'
)
assert.match(migration, /\bbegin;\s/i)
assert.match(migration, /\bcommit;\s*$/i)
assert.match(migration, /marketplace_private\.is_verified_user\(\)/)
assert.match(migration, /marketplace_prepare_order_media\(uuid,uuid,uuid\)/)
assert.match(migration, /email_confirmed_at is not null/)
assert.match(migration, /expected_function_count constant integer := 23/)
assert.match(
  migration,
  /expected_replaced_function_count constant integer := 10/
)
assert.match(migration, /legacy_count <> item\.expected_legacy_count/)
assert.match(migration, /item\.should_replace/)
assert.match(
  migration,
  /replaced_function_count <> expected_replaced_function_count/
)
assert.match(migration, /proowner.*prosecdef.*proconfig.*proacl/s)
assert.match(migration, /metadata changed while replacing/i)
assert.doesNotMatch(migration, /grant\s+execute[^;]*\bpublic\b/i)
assert.doesNotMatch(migration, /@uwo\[\.\]ca.*verified/i)
// Snapshot supplied by the independent B32 pg_catalog check. The migration
// must abort if the live catalog deviates from this signature/predicate map.
const catalogBaseline = new Map([
  ['marketplace_private.lock_order_participant(uuid)', [1, true]],
  ['public.marketplace_external_exchange(uuid)', [1, true]],
  ['public.marketplace_confirm_external_exchange(uuid,uuid)', [0, false]],
  ['public.marketplace_dispute_external_exchange(uuid,text,uuid)', [0, false]],
  ['public.marketplace_order_agreement(uuid)', [1, true]],
  ['public.marketplace_confirm_order_agreement(uuid)', [1, true]],
  ['public.marketplace_generate_handoff_qr(uuid,uuid)', [1, true]],
  ['public.marketplace_handoff_credential(uuid)', [1, true]],
  ['public.marketplace_verify_handoff(uuid,text,text,uuid)', [1, true]],
  ['public.marketplace_order_fulfillment(uuid)', [1, true]],
  ['public.marketplace_start_order_payment(uuid,uuid)', [1, true]],
  ['public.marketplace_start_campus_payment(uuid,uuid)', [0, false]],
  ['public.marketplace_order_snapshot_media(uuid)', [1, true]],
  ['public.marketplace_start_delivery_checkout(uuid)', [1, false]],
  ['public.marketplace_save_delivery_address(uuid,jsonb)', [1, false]],
  ['public.marketplace_delivery_checkout(uuid)', [1, false]],
  ['public.marketplace_order_cancellation_state(uuid)', [1, false]],
  ['public.marketplace_start_seller_delivery(uuid,uuid)', [0, false]],
  [
    'public.marketplace_request_delivery_full_refund(uuid,text,text,uuid)',
    [0, false],
  ],
  [
    'public.marketplace_respond_delivery_cancellation(uuid,text,uuid)',
    [0, false],
  ],
  [
    'public.marketplace_record_courier_shipment(uuid,text,text,uuid)',
    [1, false],
  ],
  ['public.marketplace_record_trusted_courier_delivery(uuid,text)', [0, false]],
  ['public.marketplace_confirm_courier_received(uuid,uuid)', [0, false]],
])
for (const [signature, [count, shouldReplace]] of catalogBaseline) {
  assert.ok(
    migration.includes(`('${signature}',${count},${shouldReplace})`),
    `B32 catalog baseline: ${signature}=${count},replace=${shouldReplace}`
  )
}

// The migration never widens the caller ACL, the Stripe/Interac mode resolver,
// or service-role media boundary. These negative assertions keep the ordinary
// confirmed-email change separate from Western-only and financial privileges.
assert.doesNotMatch(migration, /payment_mode\s*\(/i)
assert.doesNotMatch(
  migration,
  /stripe_(?:payment|transfer|refund)|paymentintent|transfer_group|stripe\.com/i
)
const media = fs.readFileSync('lib/server/order-snapshot-media.ts', 'utf8')
assert.match(media, /requireMarketplaceUser\(client\)/)
assert.match(media, /p_actor:\s*actor\.id/)
const mediaSql = fs.readFileSync(
  'supabase/migrations/202610120003_order_snapshot_media.sql',
  'utf8'
)
assert.match(
  mediaSql,
  /p_actor\s+not\s+in\s*\(r\.buyer_origin_id\s*,\s*r\.seller_origin_id\)/
)
assert.match(mediaSql, /email_confirmed_at is not null/)
const offerOrder = fs.readFileSync(
  'supabase/migrations/202610260011_resale_verified_offer_order_permissions.sql',
  'utf8'
)
assert.match(offerOrder, /marketplace_private\.is_verified_user\(\)/)
assert.match(offerOrder, /buyer_id\s*=\s*\(select auth\.uid\(\)\)/)
const paymentSql = fs.readFileSync(
  'supabase/migrations/202610200002_order_payment_intent_start.sql',
  'utf8'
)
assert.match(paymentSql, /marketplace_private\.payment_mode/)
const payoutGateSql = fs.readFileSync(
  'supabase/migrations/202610160005_dual_payment_paths.sql',
  'utf8'
)
assert.match(payoutGateSql, /marketplace_private\.require_seller_payout_ready/)
const handoffSql = fs.readFileSync(
  'supabase/migrations/202610150003_order_agreement_handoff_v2.sql',
  'utf8'
)
assert.match(handoffSql, /o\.seller_id is distinct from auth\.uid\(\)/)
assert.match(handoffSql, /o\.payment_status<>'paid'/)
const deliverySql = fs.readFileSync(
  'supabase/migrations/202610140002_order_cancellation_settlement.sql',
  'utf8'
)
assert.match(deliverySql, /marketplace_private\.order_progression_allowed/)
assert.match(deliverySql, /payment_status<>'paid'/)
const westernOnly = fs.readFileSync(
  'supabase/migrations/202610190004_shop_product_publication.sql',
  'utf8'
)
assert.match(westernOnly, /marketplace_private\.is_western_user\(\)/)
const orderRequest = fs.readFileSync(
  'lib/server/order-request-service.ts',
  'utf8'
)
assert.match(orderRequest, /requireOrderRequestEnvironment/)
assert.match(orderRequest, /giqdwyiupslpfhstbtqf/)
// Direct/Interac paths are external and must not enter the Stripe payment RPC.
const paymentMode = fs.readFileSync(
  'supabase/migrations/202611070004_resale_three_payment_methods.sql',
  'utf8'
)
assert.match(paymentMode, /external|in_person|interac_etransfer/)
assert.match(paymentMode, /stripe|payment/i)
console.log('resale verified transaction access migration static checks passed')

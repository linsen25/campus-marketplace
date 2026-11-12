const fs = require('node:fs')
const assert = require('node:assert/strict')

const migrationPath =
  'supabase/migrations/20261109083118_interac_receipt_completion_history.sql'
const sql = fs.readFileSync(migrationPath, 'utf8')

assert.match(sql, /^-- B32 follow-up:/)
assert.match(sql, /\bbegin;[\s\S]*\bcommit;\s*$/i)
assert.match(sql, /marketplace_interac_payment_state\(uuid\)/)
assert.match(sql, /marketplace_confirm_external_exchange\(uuid,uuid\)/)
assert.match(sql, /marketplace_private\.interac_order_participant\(p_order_id\)/)
assert.match(sql, /auth\.uid\(\) is distinct from o\.buyer_id/)
assert.match(sql, /auth\.uid\(\) is distinct from o\.seller_id/)
assert.match(sql, /Seller receipt confirmation required before Interac exchange\./)
assert.match(sql, /Seller receipt confirmation required before Interac completion\./)
assert.match(sql, /buyer_reported_at is not null[\s\S]*seller_received_at is not null/)
assert.match(sql, /new\.payment_status<>'pending'/)
assert.match(sql, /new\.payment_paid_at is not null/)
assert.match(sql, /new\.payout_status<>'not_eligible'/)
assert.match(sql, /create trigger orders_interac_receipt_before_completion/i)
assert.match(sql, /security definer set search_path=''/i)
assert.match(
  sql,
  /revoke all on function marketplace_private\.guard_interac_completion\(\) from public,anon,authenticated,service_role/i
)
assert.doesNotMatch(sql, /\bupdate\s+public\.orders\b/i)
assert.doesNotMatch(sql, /\binsert\s+into\s+marketplace_private\.interac_payment_confirmations\b/i)

const domain = fs.readFileSync('lib/server/order-domain-service.ts', 'utf8')
assert.match(domain, /Seller receipt confirmation required before Interac exchange\./)
assert.match(domain, /Seller receipt confirmation required before Interac completion\./)
assert.match(domain, /ListingApiError\([\s\S]*?,\s*409\s*\)/)

const paymentUi = fs.readFileSync('components/home/order-current-step.tsx', 'utf8')
assert.match(paymentUi, /Payment reported/)
assert.match(paymentUi, /Receipt confirmed by seller/)
assert.doesNotMatch(paymentUi, /Bank verified/)

console.log(
  'PASS Interac receipt prerequisite, historical participant read, non-Paid invariant, and safe error mapping'
)

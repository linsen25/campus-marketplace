const fs = require('node:fs'),
  assert = require('node:assert/strict')
const s = fs.readFileSync(
  'supabase/migrations/202611070008_interac_payment_confirmation.sql',
  'utf8'
)
const body = s.replace(/--.*$/gm, '')
assert.match(s, /interac_payment_confirmations/)
assert.match(s, /marketplace_report_interac_payment/)
assert.match(s, /marketplace_confirm_interac_receipt/)
assert.match(s, /o\.buyer_id<>auth\.uid\(\)/)
assert.match(s, /o\.seller_id<>auth\.uid\(\)/)
assert.match(s, /payment_mode.*interac_etransfer/s)
assert.match(s, /o\.lifecycle_status<>'open'/)
assert.match(s, /o\.payment_status<>'pending'/)
assert.match(s, /o\.payment_paid_at is not null/)
assert.match(s, /o\.payout_status<>'not_eligible'/)
assert.match(s, /not o\.holds_listing/)
assert.match(s, /for update/)
assert.match(s, /revoke all on function .* from public, anon/)
assert.doesNotMatch(
  body,
  /payment_status\s*=\s*'paid'|stripe\s*\.|transfer\s+funds/i
)
console.log(
  'PASS Interac payment report/receipt participant gates, idempotent timestamps, no Stripe state mutation'
)

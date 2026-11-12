// Static migration contract: B32 alone may replace the historical service ref,
// while the server-only V2 receipt gate and function metadata checks remain.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const file = 'supabase/migrations/20261111002000_b32_stripe_payment_receipt_authority.sql'
const sql = fs.readFileSync(file, 'utf8')

assert.match(sql, /begin;[\s\S]*commit;/i)
assert.match(sql, /marketplace_private\.protect_order\(\)/)
assert.match(sql, /'pcaqxezdfxofysghssyo'/)
assert.match(sql, /'giqdwyiupslpfhstbtqf'/)
assert.match(sql, /auth\.jwt\(\)->>'role'\)='service_role'/)
assert.match(sql, /Trusted V2 payment receipt required\./)
assert.match(sql, /new\.payment_paid_at=a\.finished_at/)
assert.match(sql, /pg_catalog\.pg_get_functiondef/)
assert.match(sql, /proowner.*prosecdef.*proconfig.*proacl/s)
assert.match(sql, /search_path=""/)
assert.doesNotMatch(sql, /grant\s+/i)
assert.doesNotMatch(sql, /payment_status='paid'/i)
console.log('PASS B32 Stripe payment receipt authority migration is narrow, fail-closed, and server-only')

const fs = require('fs'),
  assert = require('assert/strict'),
  ts = require('typescript')
const mod = { exports: {} }
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('lib/offer-amount.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
)(mod.exports)
for (const [s, zero, expected] of [
  ['80', false, 8000],
  ['0', false, null],
  ['0', true, 0],
  ['0.01', false, 1],
  ['80.20', false, 8020],
  ['-1', false, null],
  ['1.234', false, null],
  ['1e3', false, null],
  ['90071992547409.92', false, null],
  ['90071992547409.91', false, 9007199254740991],
])
  assert.equal(mod.exports.parseOfferAmount(s, zero), expected)
const migration = fs.readFileSync(
  'supabase/migrations/202610120002_offer_final_terms.sql',
  'utf8'
)
assert(
  !/update public.listings|insert into public.orders|marketplace_accept_offer|request_expires_at|interval '30 minutes'/i.test(
    migration
  )
)
assert(migration.includes('validate_offer_terms'))
assert(migration.includes('p_terms,l.updated_at'))
assert(migration.includes('digest:=encode(sha256'))
assert(migration.includes('require_seller_payout_ready'))
assert(
  migration.indexOf('if found then') <
    migration.indexOf('validate_offer_terms(p_terms,t)')
)
const ui = fs.readFileSync('components/home/offer-ui.tsx', 'utf8')
assert(!/Shipping cost pending|paymentMethod|protectionExpires/.test(ui))
assert(ui.includes('profile.segment'))
assert(ui.includes('FadingDialog'))
assert(ui.includes('OrderScheduleField'))
console.log(
  'PASS integer cents/zero/precision/limits, final term authority/no Accept/Order/inventory/timer, idempotent replay precedes schedule revalidation, shared controls (C2 Accept UI separately qualified)'
)

assert(
  fs
    .readFileSync('next.config.js', 'utf8')
    .includes('messages|offers|order-requests'),
  'Offer API must be in the existing private NetworkOnly service-worker boundary'
)

assert(
  fs.readFileSync('lib/framer-motion-features.ts', 'utf8').indexOf("m('div')") <
    fs
      .readFileSync('lib/framer-motion-features.ts', 'utf8')
      .indexOf('export default domMax'),
  'Initialize renderer before lazy feature registration'
)

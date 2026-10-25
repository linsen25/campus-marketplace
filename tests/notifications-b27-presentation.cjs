const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  cache.set(full, module.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('./')
        ? load(path.join(path.dirname(full), `${name}.ts`))
        : require(name),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}

const { notificationCopy, notificationTarget } = load(
  'lib/notification-presentation.ts'
)
const { notificationCategory } = load('lib/notification-category.ts')
const { notificationUiTarget } = load('lib/notification-navigation.ts')

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const shopDestination = { section: 'shop', destination: 'my-shop' }
const orderDestination = {
  section: 'orders',
  destination: 'sales',
  orderId,
}
const settingsDestination = {
  section: 'settings',
  panel: 'payments-payouts',
}
const cases = [
  ['shop_trial_activated', 'Shop trial activated', 'system', shopDestination],
  [
    'shop_membership_access_started',
    'Shop membership active',
    'system',
    shopDestination,
  ],
  [
    'shop_membership_access_upgraded',
    'Shop membership upgraded',
    'system',
    shopDestination,
  ],
  ['shop_suspended', 'Shop temporarily suspended', 'system', shopDestination],
  ['shop_reopened', 'Shop reopened', 'system', shopDestination],
  ['order_refund_succeeded', 'Refund confirmed', 'order', orderDestination],
  ['order_refund_failed', 'Refund unsuccessful', 'order', orderDestination],
  [
    'order_refund_unresolved',
    'Refund status needs review',
    'order',
    orderDestination,
  ],
  [
    'seller_transfer_succeeded',
    'Seller transfer confirmed',
    'order',
    orderDestination,
  ],
  [
    'seller_transfer_failed',
    'Seller transfer unsuccessful',
    'order',
    orderDestination,
  ],
  [
    'seller_transfer_unresolved',
    'Seller transfer status needs review',
    'order',
    orderDestination,
  ],
  [
    'seller_transfer_reversed',
    'Seller transfer reversed',
    'order',
    orderDestination,
  ],
  [
    'seller_transfer_partially_reversed',
    'Seller transfer partly reversed',
    'order',
    orderDestination,
  ],
  [
    'connected_bank_payout_paid',
    'Bank payout marked paid',
    'system',
    settingsDestination,
  ],
  [
    'connected_bank_payout_failed',
    'Bank payout failed',
    'system',
    settingsDestination,
  ],
  [
    'connected_bank_payout_canceled',
    'Bank payout canceled',
    'system',
    settingsDestination,
  ],
]

for (const [eventType, title, category, destination] of cases) {
  const copy = notificationCopy(eventType)
  assert.equal(copy.title, title, eventType)
  assert.notEqual(copy.title, 'Transaction update', eventType)
  assert.notEqual(copy.body, 'Open the app to review this update.', eventType)
  assert.equal(
    notificationCategory({ event_type: eventType, destination }),
    category,
    eventType
  )
  assert(notificationUiTarget(destination, eventType), eventType)
}

assert.match(notificationCopy('shop_trial_activated').body, /does not start/i)
assert.match(
  notificationCopy('shop_membership_access_started').body,
  /does not confirm/i
)
assert.match(notificationCopy('shop_suspended').body, /account remains active/i)
assert.match(
  notificationCopy('order_refund_unresolved').body,
  /could not be confirmed/i
)
assert.match(
  notificationCopy('seller_transfer_succeeded').body,
  /Connected Account/
)
assert.match(
  notificationCopy('seller_transfer_succeeded').body,
  /does not confirm a bank payout/i
)
assert.notEqual(
  notificationCopy('connected_bank_payout_paid').title,
  notificationCopy('connected_bank_payout_failed').title
)
assert.equal(notificationTarget(shopDestination), '/home?section=my-shop')
assert.equal(
  notificationTarget(settingsDestination),
  '/home?section=settings&focus=payments-payouts'
)
assert.equal(
  notificationTarget({
    section: 'settings',
    panel: 'payments-payouts',
    url: 'https://evil.invalid',
  }),
  '/home?section=settings&focus=payments-payouts'
)
for (const invalid of [
  { section: 'shop', destination: 'my-shop?next=https://evil.invalid' },
  { section: 'settings', panel: 'payments-payouts&token=secret' },
  { section: 'orders', destination: 'sales', orderId: 'not-a-uuid' },
])
  assert.equal(notificationTarget(invalid), null)

const migration = fs.readFileSync(
  'supabase/migrations/20261023173802_authoritative_shop_provider_notifications.sql',
  'utf8'
)
const delivery = fs.readFileSync(
  'supabase/migrations/202610150004_notification_delivery_foundation.sql',
  'utf8'
)
for (const [eventType] of cases) {
  assert(migration.includes(`'${eventType}'`), `${eventType} producer exists`)
  assert(!delivery.includes(`'${eventType}'`), `${eventType} stays inbox-only`)
}
assert.equal(
  (migration.match(/'ACTION_REQUIRED'/g) || []).length,
  1,
  'ACTION_REQUIRED appears only in the projector input validation contract'
)

console.log(
  `PASS B27-B presentation: ${cases.length} authoritative event types have explicit copy, category and safe navigation; all remain informational and inbox-only`
)

const fs = require('fs'),
  assert = require('assert/strict'),
  ts = require('typescript')
function load(f) {
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
  )((n) => load('lib/' + n.replace('./', '') + '.ts'), m, m.exports)
  return m.exports
}
const { notificationUiTarget: target } = load('lib/notification-navigation.ts')
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  offerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  orderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
for (const destination of ['buying', 'selling']) {
  const context = { section: 'messages', destination, conversationId, offerId }
  for (const event of [
    'incoming_offer',
    'incoming_counter_offer',
    'offer_declined',
    'offer_closed',
    'offer_withdrawn',
  ])
    assert.equal(
      target(context, event),
      `/home?section=messages&destination=${destination}&conversation=${conversationId}&offer=${offerId}`
    )
  assert.equal(
    target(context, 'new_message'),
    `/home?section=messages&destination=${destination}&conversation=${conversationId}`
  )
  assert(
    !target(
      { ...context, conversationId: 'https://malicious.invalid' },
      'new_message'
    )
  )
  assert(
    !target(
      { ...context, destination: 'buying&token=secret' },
      'incoming_offer'
    )
  )
  assert(
    !target(
      { ...context, offerId: 'x&secret=unsafe' },
      'incoming_offer'
    ).includes('offer=')
  )
}
for (const destination of ['purchases', 'sales'])
  for (const event of [
    'offer_accepted',
    'agreement_confirmation_required',
    'agreement_other_confirmed',
    'agreement_complete',
    'payment_required',
    'payment_paid',
    'seller_delivery_started',
    'handoff_ready',
    'handoff_confirmed',
    'protection_started',
    'protection_case_opened',
    'order_completed',
    'order_cancelled',
    'reservation_expired',
  ]) {
    assert.equal(
      target(
        {
          section: 'orders',
          destination,
          orderId,
          stage: 'old',
          qrToken: 'never-in-url',
          address: 'private',
        },
        event
      ),
      `/home?section=orders&destination=${destination}&order=${orderId}`
    )
  }
for (const invalid of [
  null,
  {},
  'https://malicious.invalid',
  { section: 'orders', destination: 'sales', orderId: 'bad' },
  { section: 'auth', token: 'private' },
])
  assert.equal(target(invalid, 'new_message'), null)
console.log(
  'PASS safe deep navigation: exact Conversation/Offer, both Order roles, Agreement/current/terminal context; invalid IDs/URL injection rejected, no secret or stale-stage forwarding'
)

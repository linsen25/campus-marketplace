const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
function load(file, requireFn) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
  )(requireFn, module, module.exports)
  return module.exports
}
const presentation = load('lib/message-presentation.ts', () => {
  throw Error('Unexpected dependency')
})
const { mergeMessageTimeline, groupMessageTimeline } = load(
  'lib/message-timeline-preview.ts',
  (name) => {
    assert.equal(name, './message-presentation')
    return presentation
  }
)
const at = (n) => new Date(Date.UTC(2026, 9, 12, 14, 0, n)).toISOString()
const message = (id, n, type = 'TEXT', senderId = 'seller') => ({
  id,
  createdAt: at(n),
  type,
  senderId,
  content: id,
})
const requests = [
  { id: 'r1', createdAt: at(3), status: 'active' },
  { id: 'r2', createdAt: at(5), status: 'active' },
]
const messages = [
  message('seller-text', 1),
  message('seller-image', 2, 'IMAGE'),
  message('buyer-text', 4, 'TEXT', 'buyer'),
  message('buyer-latest', 6, 'TEXT', 'buyer'),
]
const timeline = mergeMessageTimeline(messages, requests)
assert.deepEqual(
  timeline.map((x) => x.id),
  [
    'message:seller-text',
    'message:seller-image',
    'request:r1',
    'message:buyer-text',
    'request:r2',
    'message:buyer-latest',
  ]
)
const before = timeline.map((x) => x.id)
for (const status of ['superseded', 'accepted']) {
  requests[0].status = status
  assert.deepEqual(
    mergeMessageTimeline(messages, requests).map((x) => x.id),
    before
  )
}
assert.equal(groupMessageTimeline(timeline).length, 5)
assert.deepEqual(
  groupMessageTimeline(mergeMessageTimeline(messages, [])).map((x) =>
    x.messages.map((m) => m.id)
  ),
  [
    ['seller-text', 'seller-image'],
    ['buyer-text', 'buyer-latest'],
  ]
)
const tied = [message('z', 3), message('a', 3)]
assert.deepEqual(
  mergeMessageTimeline(tied, requests.slice(0, 1)).map((x) => x.id),
  mergeMessageTimeline([...tied].reverse(), requests.slice(0, 1)).map(
    (x) => x.id
  )
)
assert.equal(messages.length, 4)
console.log(
  'PASS TEXT/IMAGE/Request interleave; immutable timestamp position across statuses; stable ties; existing message grouping; no input mutation'
)

const cancellation = {
  id: 'cancel-a',
  conversationId: 'conversation',
  createdAt: at(7),
  kind: 'request-cancelled',
  requestId: 'r1',
  cancellation: {
    cancelledBy: 'seller',
    cancelReason: 'Sent by mistake',
    cancelNote: '',
    cancelledAt: at(7),
  },
}
const withEvent = mergeMessageTimeline(messages, requests, [cancellation])
assert.deepEqual(
  withEvent.slice(0, -1).map((x) => x.id),
  before
)
assert.equal(withEvent.at(-1).kind, 'event')
assert.equal(groupMessageTimeline(withEvent).at(-1).kind, 'event')
console.log(
  'PASS cancellation event at cancellation time; original request position unchanged; event has no message sequence'
)

const auditEvents = [
  cancellation,
  ...['request-created', 'request-replaced', 'request-expired'].map(
    (kind, i) => ({ id: kind, kind, requestId: 'r1', createdAt: at(8 + i) })
  ),
]
const auditBefore = JSON.stringify(auditEvents)
for (const status of ['cancelled', 'superseded', 'expired', 'active']) {
  const formalRequests = requests.map((request, i) =>
    i ? request : { ...request, status }
  )
  const visible = mergeMessageTimeline(
    messages,
    formalRequests,
    auditEvents,
    true
  )
  assert.deepEqual(
    visible
      .filter((item) => item.kind === 'event')
      .map((item) => item.event.id),
    ['cancel-a']
  )
  assert.equal(
    visible.find((item) => item.id === 'request:r1').createdAt,
    at(3)
  )
  assert.equal(
    visible.find((item) => item.id === 'event:cancel-a').createdAt,
    at(7)
  )
  assert(
    visible.findIndex((item) => item.id === 'message:buyer-text') <
      visible.findIndex((item) => item.id === 'event:cancel-a')
  )
}
assert.equal(JSON.stringify(auditEvents), auditBefore)
console.log(
  'PASS formal cancellation-only projection; created/replaced/expired remain audit-only; immutable timestamps, TEXT/IMAGE chronology and event input preserved'
)

const minuteMessages = [
  message('t0', 0),
  message('image', 10, 'IMAGE'),
  message('buyer', 20, 'TEXT', 'buyer'),
  message('same-seller-next-minute', 65),
  message('same-seller-third-minute', 125),
]
const minuteRequests = [
  { id: 'minute-request', createdAt: at(30), status: 'cancelled' },
]
const minuteEvent = { ...cancellation, id: 'minute-cancel', createdAt: at(40) }
const minuteTimeline = mergeMessageTimeline(
  minuteMessages,
  minuteRequests,
  [minuteEvent],
  true
)
const minuteGroups = groupMessageTimeline(minuteTimeline)
assert.deepEqual(
  minuteGroups.map((g) => g.showTimestamp),
  [true, false, false, false, true, true]
)
assert.deepEqual(
  minuteGroups.flatMap((g) =>
    g.kind === 'messages' ? g.messages.map((m) => 'message:' + m.id) : [g.id]
  ),
  minuteTimeline.map((item) => item.id)
)
assert.equal(minuteGroups.filter((g) => g.showTimestamp).length, 3)
const nextDay = {
  ...minuteRequests[0],
  id: 'next-day',
  createdAt: '2026-10-13T14:00:30.000Z',
}
assert.deepEqual(
  groupMessageTimeline(
    mergeMessageTimeline([], [...minuteRequests, nextDay], [], true)
  ).map((g) => g.showTimestamp),
  [true, true]
)
console.log(
  'PASS shared minute separators across sender/TEXT/IMAGE/Request/cancellation changes; new minute/date gets a separator; original items/order/timestamps preserved'
)

const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(file) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports }
  )
  return exports
}
const { createDemoMessageHistory, DEMO_CURRENT_USER_ID } = load(
  'lib/demo-message-history.ts'
)
const { groupMessages } = load('lib/message-presentation.ts')
const a = {
  id: 'buying-a',
  person: { id: 'sarah', name: 'Sarah Jenkins' },
  listing: { title: 'Chair' },
  createdAt: '2026-10-06T09:00:00Z',
  lastMessageAt: '2026-10-06T10:45:00Z',
}
const b = { ...a, id: 'buying-b', listing: { title: 'AirPods' } }
const histories = [
  createDemoMessageHistory(a),
  createDemoMessageHistory(b),
  createDemoMessageHistory({ ...a, id: 'selling-a' }),
]
assert(histories[0] !== histories[1])
assert.equal(new Set(histories.flat().map((m) => m.id)).size, 72)
for (const [index, history] of histories.entries()) {
  const id = ['buying-a', 'buying-b', 'selling-a'][index]
  assert(history.every((m) => m.conversationId === id && m.type === 'TEXT'))
  assert(history.some((m) => m.senderId === DEMO_CURRENT_USER_ID))
  assert(history.some((m) => m.senderId === 'sarah'))
  assert(history.some((m) => m.content.length > 200))
  assert(
    history.every(
      (m, i) =>
        i === 0 ||
        Date.parse(m.createdAt) > Date.parse(history[i - 1].createdAt)
    )
  )
  const snapshot = JSON.stringify(history)
  history.forEach(Object.freeze)
  Object.freeze(history)
  const groups = groupMessages(history)
  assert.equal(groups.length, 12)
  assert.equal(groups[0].length, 3)
  assert.equal(groups[1].length, 3)
  assert(groups.every((g) => g.every((m) => m.senderId === g[0].senderId)))
  assert(
    groups.every(
      (g, i) => i === 0 || g[0].senderId !== groups[i - 1][0].senderId
    )
  )
  assert.equal(JSON.stringify(groups.flat()), snapshot)
  assert.equal(JSON.stringify(history), snapshot)
}
assert(histories[0][0].content.includes('Chair'))
assert(histories[1][0].content.includes('AirPods'))
assert.equal(groupMessages([]).length, 0)
console.log(
  'PASS: separate histories and identities, TEXT model, chronological messages, short/long content, sender grouping, immutable input'
)

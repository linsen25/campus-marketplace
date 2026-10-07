const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync('lib/conversation-state.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText
const context = { exports: {} }
vm.runInNewContext(code, context)
const { getConversationActivityAt, sortConversationsByRecent } = context.exports
const entry = (id, minute, unreadCount = 0) =>
  Object.freeze({
    id,
    createdAt: '2026-10-06T09:00:00Z',
    lastMessageAt: `2026-10-06T10:${minute}:00Z`,
    unreadCount,
  })
const a = entry('a', '45', 2),
  b = entry('b', '42'),
  c = entry('c', '30', 1)
const input = Object.freeze([c, a, b])
const ids = (data) => Array.from(sortConversationsByRecent(data), (c) => c.id)
assert.deepEqual(ids(input), ['a', 'b', 'c'])
assert.deepEqual(
  input.map((c) => c.id),
  ['c', 'a', 'b']
)
assert.notEqual(sortConversationsByRecent(input), input)
const fallback = Object.freeze({
  id: 'fallback',
  createdAt: '2026-10-06T10:46:00Z',
})
assert.equal(
  getConversationActivityAt(fallback),
  Date.parse(fallback.createdAt)
)
assert.equal(
  getConversationActivityAt({ ...fallback, lastMessageAt: null }),
  Date.parse(fallback.createdAt)
)
assert.deepEqual(ids([...input, fallback]), ['fallback', 'a', 'b', 'c'])
assert.deepEqual(ids([entry('z', '45'), a]), ['a', 'z'])
assert.deepEqual(ids([a, entry('z', '45')]), ['a', 'z'])
assert.deepEqual(ids(input), ids(input))
assert.deepEqual(ids([c, { ...a, unreadCount: 0 }, b]), ['a', 'b', 'c'])
assert.deepEqual(ids([a, b, { ...c, lastMessageAt: '2026-10-06T10:50:00Z' }]), [
  'c',
  'a',
  'b',
])
assert.deepEqual(
  ids([
    { ...a, id: 'earlier', lastMessageAt: '2026-10-06T10:45:00.000001+00:00' },
    { ...a, id: 'later', lastMessageAt: '2026-10-06T10:45:00.000002+00:00' },
  ]),
  ['later', 'earlier']
)
console.log(
  'PASS: latest activity, absent/null fallback, immutable frozen input, deterministic ties, read does not reorder, new activity does reorder'
)

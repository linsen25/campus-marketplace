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
    { exports, require: () => load('lib/listing-images.ts') }
  )
  return exports
}
const { validateMessageImages } = load('lib/message-images.ts')
for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  validateMessageImages([{ type, size: 3145728 }], 3)
  assert.throws(() => validateMessageImages([{ type, size: 3145729 }], 0))
}
for (const type of ['application/pdf', 'text/plain', 'video/mp4'])
  assert.throws(() => validateMessageImages([{ type, size: 1024 }], 0))
assert.throws(() => validateMessageImages([{ type: 'image/png', size: 0 }], 0))
const batch = Object.freeze([
  Object.freeze({ type: 'image/png', size: 128 }),
  Object.freeze({ type: 'image/webp', size: 256 }),
])
validateMessageImages(batch, 2)
assert.throws(() => validateMessageImages(batch, 3), /at most 4/)
assert.equal(batch.length, 2)
const { groupMessages } = load('lib/message-presentation.ts')
const base = { conversationId: 'buying-one', createdAt: '2026-10-06T10:42:00Z' }
const messages = [
  { ...base, id: 'one', senderId: 'me', type: 'TEXT', content: 'Photos below' },
  { ...base, id: 'two', senderId: 'me', type: 'IMAGE', images: [] },
  { ...base, id: 'three', senderId: 'other', type: 'TEXT', content: 'Thanks' },
]
const groups = groupMessages(messages)
assert.equal(groups.length, 2)
assert.equal(groups[0].length, 2)
assert.equal(groups[1][0].id, 'three')
console.log('PASS: image selection boundaries and mixed TEXT/IMAGE grouping')

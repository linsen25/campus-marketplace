const assert = require('node:assert/strict')
const { parseRows } = require('../scripts/cli-json-result.cjs')
const rows = [{ nested: [{ value: '} { [ ]', quote: '"', slash: '\\' }] }]
const json = JSON.stringify({ rows })
for (const output of [
  json,
  'CLI starting\n' + json,
  json + '\nCLI done {notice}',
  'before\n' + json + '\nafter',
])
  assert.deepEqual(parseRows(output), rows)
assert.deepEqual(parseRows('{"rows":[]}'), [])
for (const output of [
  '',
  'no JSON',
  '{"rows":[]',
  '{"rows":[}',
  '{"rows":[],}',
  '{"rows":"wrong"}',
  '{}',
  '{bad}\n{"rows":[]}',
])
  assert.throws(() => parseRows(output))
console.log(
  'PASS CLI JSON extraction: clean/prefix/suffix/nesting/strings/escapes; malformed/incomplete/unexpected results rejected'
)

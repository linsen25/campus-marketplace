const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const directory = path.join(__dirname, '..', 'emails', 'resend')
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, 'templates.json'), 'utf8')
)

assert.equal(manifest.brand, 'Usual & Unusual')
assert.equal(manifest.templates.length, 4)
for (const template of manifest.templates) {
  assert.match(template.alias, /^uu-[a-z-]+-v1$/)
  assert.match(template.subject, /Usual & Unusual|\{\{\{EVENT_TITLE\}\}\}/)
  const declared = template.variables.map((entry) => entry.split(':')[0]).sort()
  for (const name of [template.html, template.text]) {
    const content = fs.readFileSync(path.join(directory, name), 'utf8')
    const used = [...content.matchAll(/\{\{\{([A-Z_]+)\}\}/g)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual([...new Set(used)].sort(), declared)
    assert.doesNotMatch(content, /<script|<link\b|\s+on[a-z]+\s*=/i)
    assert.match(content, /Usual &amp; Unusual|Usual & Unusual/)
  }
}
console.log('PASS Resend template source contract')

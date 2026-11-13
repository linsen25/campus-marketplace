// Focused canonical-project guard tests. No network, database, user, or email.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')

const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}

const environment = load('lib/marketplace-test-environment.ts')
const messages = load('lib/server/messages-environment.ts')
const ref = environment.canonicalUuProjectRef
const jwt = (claims) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'unit'].join('.')

process.env.APP_ENV = 'uu'
process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: 'anon', ref })
assert.equal(environment.configuredUuProjectRef(), ref)
assert.equal(environment.isConfiguredUuProject('uu', `https://${ref}.supabase.co`), true)
assert.equal(messages.requireMessagesEnvironment(), ref)

for (const [designation, url] of [
  ['staging', 'https://pcaqxezdfxofysghssyo.supabase.co'],
  ['b32', 'https://giqdwyiupslpfhstbtqf.supabase.co'],
  ['uu', 'https://example.com'],
  ['production', `https://${ref}.supabase.co`],
]) {
  process.env.APP_ENV = designation
  process.env.NEXT_PUBLIC_SUPABASE_URL = url
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: 'anon', ref })
  assert.equal(environment.configuredUuProjectRef(), null)
  assert.throws(() => messages.requireMessagesEnvironment())
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-environment-'))
try {
  for (const body of [
    `APP_ENV=uu\nNEXT_PUBLIC_SUPABASE_URL=https://pcaqxezdfxofysghssyo.supabase.co\n`,
    `APP_ENV=uu\nNEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_unit\nSUPABASE_SERVICE_ROLE_KEY=bad.jwt\n`,
    `APP_ENV=uu\nNEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_unit\nSUPABASE_SERVICE_ROLE_KEY=${jwt({ role: 'service_role', ref })}\nSTRIPE_PROVIDER_ENABLED=true\n`,
  ]) {
    fs.writeFileSync(path.join(directory, '.env.uu.local'), body)
    const result = spawnSync(process.execPath, [path.resolve('scripts/dev-v1-uu.cjs')], {
      cwd: directory,
      windowsHide: true,
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0, 'Unsafe UU configuration must fail before Next starts')
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
console.log('PASS: canonical UU environment accepts only exact uu URL and matching anon JWT; legacy refs fail closed')

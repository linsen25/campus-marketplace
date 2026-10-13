// Explicit local staging qualification/maintenance worker. No provider integration.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const Module = require('node:module')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const ref = 'pcaqxezdfxofysghssyo'
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(env.APP_ENV, 'staging')
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
const claims = JSON.parse(
  Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')
)
assert.equal(claims.ref, ref)
assert.equal(claims.role, 'service_role')
Object.assign(process.env, env)
const resolve = Module._resolveFilename
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith('@/') ? path.resolve(id.slice(2)) : id,
    ...args
  )
}
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    f
  )
const {
  sweepOrderSnapshotMedia,
} = require('../lib/server/order-snapshot-media.ts')
const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
let running = false,
  lastMedia = 0
async function tick() {
  if (running) return
  running = true
  try {
    const result = await client.rpc('marketplace_run_transaction_due_work', {})
    if (result.error) throw Error('Due-work operation failed')
    if (Date.now() - lastMedia >= 3600000) {
      await sweepOrderSnapshotMedia()
      lastMedia = Date.now()
    }
    console.log(
      JSON.stringify({
        stagingDueWork: true,
        mediaSweepDueInSeconds: Math.ceil(
          (3600000 - (Date.now() - lastMedia)) / 1000
        ),
      })
    )
  } catch {
    console.error('Staging worker failed; no sensitive diagnostics printed')
    process.exitCode = 1
  } finally {
    running = false
  }
}
if (process.argv.includes('--once')) tick()
else {
  tick()
  setInterval(tick, 60000)
}

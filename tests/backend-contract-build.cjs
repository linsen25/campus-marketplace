// Isolated production-mode compilation/runtime, configured ONLY for staging.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = 'tests/artifacts/backend-completion-build'
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
const values = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [
        line.slice(0, i).trim(),
        line
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(values.APP_ENV, 'staging')
assert.equal(
  values.NEXT_PUBLIC_SUPABASE_URL,
  'https://pcaqxezdfxofysghssyo.supabase.co'
)
Object.assign(process.env, values, {
  NODE_ENV: 'production',
  ORDER_PREVIEW_MODE: '',
})
;(async () => {
  const phase =
    process.argv[2] === 'serve'
      ? require('next/constants').PHASE_PRODUCTION_SERVER
      : require('next/constants').PHASE_PRODUCTION_BUILD
  const config = await require('next/dist/server/config').default(
    phase,
    process.cwd()
  )
  config.distDir = root
  // Keep local validation workers within this machine's memory budget.
  config.experimental = { ...config.experimental, cpus: 2 }
  if (process.argv[2] !== 'serve')
    await require('next/dist/build').default(
      process.cwd(),
      config,
      false,
      false,
      false
    )
  else {
    const app = require('next')({
      dev: false,
      conf: config,
      hostname: 'localhost',
      port: 3000,
    })
    await app.prepare()
    require('node:http')
      .createServer(app.getRequestHandler())
      .listen(3000, () =>
        console.log(
          'STAGING main app ready on localhost:3000 (production-mode validation build)'
        )
      )
  }
})().catch(() => {
  console.error('Staging validation build/runtime failed')
  process.exitCode = 1
})

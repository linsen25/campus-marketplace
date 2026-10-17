const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict')
const names = [
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_ACCOUNT_WEBHOOK_SECRET',
  'STRIPE_WORKER_SECRET',
  'STRIPE_PLATFORM_ACCOUNT_ID',
  'STRIPE_APPLICATION_ORIGIN',
  'STRIPE_API_VERSION',
  'STRIPE_PROVIDER_ENABLED',
]
for (const configured of [true, false]) {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://pcaqxezdfxofysghssyo.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_Synthetic',
  }
  if (configured) names.forEach((k) => (values[k] = 'SyntheticLocal_' + k))
  const content = Object.entries(values)
    .map(([k, v]) => k + '=' + v)
    .join('\n')
  let spawned,
    logs = []
  const req = (name) =>
    name === 'node:fs'
      ? { readFileSync: () => content }
      : name === 'node:child_process'
      ? {
          spawn: (_exe, _args, options) => {
            spawned = options
            return { on() {} }
          },
        }
      : require(name)
  req.resolve = require.resolve
  vm.runInNewContext(fs.readFileSync('scripts/dev-staging.cjs', 'utf8'), {
    require: req,
    Buffer,
    Object,
    Error,
    console: { log: (v) => logs.push(v) },
    process: {
      execPath: process.execPath,
      argv: ['node', 'dev-staging'],
      env: Object.fromEntries(names.map((k) => [k, 'SyntheticInherited_' + k])),
    },
  })
  assert.equal(spawned.env.APP_ENV, 'staging')
  names.forEach((k) =>
    assert.equal(spawned.env[k], configured ? values[k] : '')
  )
  assert(!logs.join('').includes('SyntheticLocal_'))
}
console.log(
  'PASS staging runner forwards only configured Stripe values, overrides inherited values with explicit blanks, prints no values; no server/network started'
)

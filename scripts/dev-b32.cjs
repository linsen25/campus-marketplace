// Starts Next.js with the ignored B32 environment file and refuses known Staging.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const file = path.resolve('.env.b32.test.local')
if (!fs.existsSync(file)) throw new Error('Missing .env.b32.test.local')
const parseEnv = (contents) =>
  Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=')
        if (i < 1) return ['', '']
        return [
          line.slice(0, i).trim(),
          line
            .slice(i + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ]
      })
      .filter(([name]) => name)
  )
const values = parseEnv(fs.readFileSync(file, 'utf8'))
if (
  values.B32_SUPABASE_PROJECT_REF !== 'giqdwyiupslpfhstbtqf' ||
  (values.B32_TEST_PROJECT_REF &&
    values.B32_TEST_PROJECT_REF !== 'giqdwyiupslpfhstbtqf') ||
  values.NEXT_PUBLIC_SUPABASE_URL !== 'https://giqdwyiupslpfhstbtqf.supabase.co'
)
  throw new Error('B32 Supabase target mismatch.')
if (!/^sk_test_/.test(values.STRIPE_SECRET_KEY || ''))
  throw new Error('B32 requires a Stripe Test Secret Key.')
if (!/^pk_test_/.test(values.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''))
  throw new Error('B32 requires a Stripe Test Publishable Key.')
for (const name of [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_ACCOUNT_WEBHOOK_SECRET',
  'STRIPE_APPLICATION_ORIGIN',
]) {
  if (!values[name]) throw new Error(`B32 requires ${name}.`)
}
if (Object.values(values).some((value) => /(?:sk|pk)_live_/i.test(value)))
  throw new Error('B32 refuses Live Stripe credentials.')
if (values.STRIPE_ORDER_PAYMENTS_ENABLED === 'true')
  console.warn(
    'Payment calls are enabled; use only an isolated Test Mode database.'
  )
const port = process.argv[2] || '3021'
const distDir = process.argv[3] || process.env.NEXT_DIST_DIR || '.next-b32'
console.log(
  `B32 target ${values.B32_SUPABASE_PROJECT_REF || 'missing'} on port ${port}`
)
const isolated = { ...process.env }
// Next automatically reads .env.local. Blank every variable from that file
// unless B32 explicitly provides it, so stale Staging values cannot leak in.
const localEnvFile = path.resolve('.env.local')
if (fs.existsSync(localEnvFile)) {
  for (const name of Object.keys(parseEnv(fs.readFileSync(localEnvFile, 'utf8')))) {
    if (!(name in values)) isolated[name] = ''
  }
}
for (const name of [
  'B32_SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_PLATFORM_ACCOUNT_ID',
  'STRIPE_API_VERSION',
  'STRIPE_APPLICATION_ORIGIN',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_ACCOUNT_WEBHOOK_SECRET',
  'STRIPE_WORKER_SECRET',
  'CRON_SECRET',
  'STRIPE_PROVIDER_ENABLED',
  'STRIPE_ORDER_PAYMENTS_ENABLED',
  'STRIPE_ORDER_REFUNDS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_CREATE_APPROVED',
  'NEXT_DIST_DIR',
])
  isolated[name] = ''
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', port],
  {
    cwd: process.cwd(),
    env: {
      ...isolated,
      ...values,
      APP_ENV: 'staging',
      NEXT_DIST_DIR: distDir,
    },
    stdio: 'inherit',
    windowsHide: true,
  }
)
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))

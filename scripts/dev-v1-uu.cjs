// Starts the unified V1 application only against the canonical UU project.
// Values stay in the ignored .env.uu.local file and are never logged.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ref = 'uqhyjpjiznpgomuizfqe'
const file = path.resolve('.env.uu.local')
if (!fs.existsSync(file)) throw new Error('Missing .env.uu.local')
const values = Object.fromEntries(
  fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      if (index < 1) throw new Error('Invalid .env.uu.local entry')
      return [
        line.slice(0, index),
        line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''),
      ]
    })
)
const jwtClaims = (value) => {
  try {
    return JSON.parse(Buffer.from(value.split('.')[1] || '', 'base64url'))
  } catch {
    return null
  }
}
const anon = values.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const secret = values.SUPABASE_SECRET_KEY || ''
const anonClaims = jwtClaims(anon)
if (
  values.APP_ENV !== 'uu' ||
  values.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
  !anon ||
  (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(anon) &&
    (!anonClaims || anonClaims.role !== 'anon' || anonClaims.ref !== ref)) ||
  (secret && !/^sb_secret_[A-Za-z0-9_-]+$/.test(secret)) ||
  Object.values(values).some((value) => /(?:sk|pk)_live_/i.test(value))
)
  throw new Error('UU Supabase credentials do not match the canonical project.')

for (const name of [
  'STRIPE_PROVIDER_ENABLED',
  'STRIPE_ORDER_PAYMENTS_ENABLED',
  'STRIPE_ORDER_REFUNDS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_CREATE_APPROVED',
  'GOOGLE_PLACES_API_KEY',
])
  if (values[name] === 'true') throw new Error(`${name} must remain disabled.`)

const isolated = { ...process.env }
for (const name of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
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
  'GOOGLE_PLACES_API_KEY',
])
  isolated[name] = ''

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', '3000'],
  {
    cwd: process.cwd(),
    env: {
      ...isolated,
      ...values,
      APP_ENV: 'uu',
      NEXT_PUBLIC_MESSAGES_ENV: 'uu',
      STRIPE_APPLICATION_ORIGIN: 'http://localhost:3000',
      STRIPE_PROVIDER_ENABLED: 'false',
      STRIPE_ORDER_PAYMENTS_ENABLED: 'false',
      STRIPE_ORDER_REFUNDS_ENABLED: 'false',
      STRIPE_ORDER_TRANSFERS_ENABLED: 'false',
      STRIPE_ORDER_TRANSFERS_CREATE_APPROVED: 'false',
      GOOGLE_PLACES_API_KEY: '',
    },
    stdio: 'inherit',
    windowsHide: true,
  }
)
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))

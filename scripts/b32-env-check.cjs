// B32 environment preflight. This command never contacts Supabase or Stripe.
const fs = require('node:fs')
const path = require('node:path')

const file = process.env.B32_ENV_FILE || '.env.b32.test.local'
if (!fs.existsSync(file)) {
  console.error(
    `Missing ${file}. Copy the template outside Git and fill Test Mode values.`
  )
  process.exit(1)
}

const values = Object.fromEntries(
  fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith('#'))
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

const url = values.NEXT_PUBLIC_SUPABASE_URL || ''
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1] || ''
const expectedRef =
  values.B32_TEST_PROJECT_REF || process.env.B32_TEST_PROJECT_REF || ''
const knownStaging = ref === 'pcaqxezdfxofysghssyo'
if (!url || knownStaging || (ref && expectedRef && ref !== expectedRef)) {
  console.error(
    'Refusing known Staging/Production or mismatched Supabase target.'
  )
  process.exit(1)
}
if (!ref && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
  console.error(
    'Supabase target must be localhost or an explicitly named B32 test project.'
  )
  process.exit(1)
}

const required = {
  STRIPE_SECRET_KEY: /^sk_test_[A-Za-z0-9]+$/,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: /^pk_test_[A-Za-z0-9]+$/,
  STRIPE_PLATFORM_ACCOUNT_ID: /^acct_[A-Za-z0-9]+$/,
  STRIPE_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9]+$/,
  STRIPE_CONNECT_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9]+$/,
  STRIPE_ACCOUNT_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9]+$/,
}
for (const [name, pattern] of Object.entries(required)) {
  if (!pattern.test(values[name] || '')) {
    console.error(`${name} is missing or not Test Mode formatted.`)
    process.exit(1)
  }
}
if (values.APP_ENV !== 'staging' || values.STRIPE_PROVIDER_ENABLED !== 'true') {
  console.error(
    'APP_ENV=staging and STRIPE_PROVIDER_ENABLED=true are required for B32 Test Mode.'
  )
  process.exit(1)
}
for (const name of [
  'STRIPE_ORDER_REFUNDS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_CREATE_APPROVED',
]) {
  if (values[name] === 'true') {
    console.error(
      `${name} must remain false until its B32 phase is explicitly enabled.`
    )
    process.exit(1)
  }
}

const allMigrations = fs
  .readdirSync(path.resolve('supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
const migrations = allMigrations.filter(
  (name) => !name.includes('202610260011')
)
console.log(
  `PASS B32 environment preflight (${ref || 'localhost'}, ${
    migrations.length
  } allowlisted migrations)`
)

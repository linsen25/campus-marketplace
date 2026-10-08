// Read ONLY the dedicated ignored staging config; .env.local remains unchanged.
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')
const ref = 'pcaqxezdfxofysghssyo'
const filename = path.resolve('.env.staging.local')
const content = fs.readFileSync(filename, 'utf8')
const values = Object.fromEntries(
  content
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [
        line.slice(0, index),
        line
          .slice(index + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
const url = values.NEXT_PUBLIC_SUPABASE_URL
const key = values.NEXT_PUBLIC_SUPABASE_ANON_KEY
const storageKey = values.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
if (url !== `https://${ref}.supabase.co`)
  throw new Error(
    'Refusing to start: expected western-marketplace-staging URL.'
  )
if (!key) throw new Error('A staging public anon/publishable key is required.')
if (!key.startsWith('sb_publishable_')) {
  const claims = JSON.parse(
    Buffer.from(key.split('.')[1] || '', 'base64url').toString()
  )
  if (claims.role !== 'anon' || claims.ref !== ref)
    throw new Error('Refusing a secret or another project key.')
}
if (storageKey) {
  let valid = false
  try {
    const claims = JSON.parse(Buffer.from(storageKey.split('.')[1] || '', 'base64url').toString())
    valid = claims.role === 'service_role' && claims.ref === ref
  } catch { valid = false }
  if (!valid) throw new Error('Refusing a mismatched staging Storage credential.')
}
console.log(
  'Starting western-marketplace-staging. Production .env.local is unchanged.'
)
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      APP_ENV: 'staging',
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
      // Explicit empty value prevents Next dotenv from inheriting a production secret.
      SUPABASE_SERVICE_ROLE_KEY: storageKey,
    },
  }
)
child.on('exit', (code) => {
  process.exitCode = code || 0
})

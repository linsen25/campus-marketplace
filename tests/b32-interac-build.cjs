const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const parse = text => Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
const values = parse(fs.readFileSync('.env.b32.test.local', 'utf8'))
if (values.NEXT_PUBLIC_SUPABASE_URL !== 'https://giqdwyiupslpfhstbtqf.supabase.co' || !values.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('B32 isolation mismatch')
const env = { ...process.env }
if (fs.existsSync('.env.local')) for (const key of Object.keys(parse(fs.readFileSync('.env.local', 'utf8')))) env[key] = ''
Object.assign(env, values, { NODE_ENV: 'production', APP_ENV: 'staging', NEXT_DIST_DIR: '.next-b32-interac-build', NEXT_TELEMETRY_DISABLED: '1', STRIPE_ORDER_PAYMENTS_ENABLED: 'false', STRIPE_ORDER_REFUNDS_ENABLED: 'false', STRIPE_ORDER_TRANSFERS_ENABLED: 'false' })
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { env, stdio: 'inherit', windowsHide: true })
process.exitCode = result.status === null ? 1 : result.status

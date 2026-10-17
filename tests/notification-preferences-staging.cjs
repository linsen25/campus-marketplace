const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const file = 'supabase/migrations/202610160002_notification_preferences.sql'
const sql = fs.readFileSync(file, 'utf8')
const fingerprint = () =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync('.env.local'))
    .digest('hex')
const before = fingerprint()
const body = process.argv.includes('--deployed')
  ? ''
  : sql.replace(/\bbegin;\s*/, '').replace(/\bcommit;\s*$/, '')
const rows = h.query(
  'begin;\n' +
    body +
    '\n' +
    fs.readFileSync('tests/notification-preferences-staging.sql', 'utf8') +
    '\nrollback;'
)
assert(rows.some((row) => row.result?.startsWith('PASS')))
assert.equal(fingerprint(), before)
console.log(JSON.stringify(rows.filter((row) => row.result)))
console.log(
  'PASS rollback-only staging pcaqxezdfxofysghssyo; .env.local unchanged; no persistent synthetic data'
)

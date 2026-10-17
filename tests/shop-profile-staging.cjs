const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const filename = 'supabase/migrations/202610160006_shop_profile_foundation.sql'
const hash = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const envBefore = ['.env.local', '.env.staging.local'].map(hash)
const deployed = process.argv.includes('--deployed')
const migration = fs.readFileSync(filename, 'utf8')
const baseline = deployed
  ? h.query('select count(*)::int count from public.shops')[0].count
  : 0
const usersBefore = h.query(
  "select count(*)::int count from auth.users where email like 'shop_profile_%@uwo.ca'"
)[0].count
const body = deployed
  ? ''
  : migration.slice(migration.indexOf('begin;') + 6).replace(/commit;\s*$/, '')
const rows = h.query(
  'begin;\n' +
    body +
    '\n' +
    fs.readFileSync('tests/shop-profile-staging.sql', 'utf8') +
    '\nrollback;'
)
assert(rows.some((row) => row.result?.startsWith('PASS')))
assert.equal(
  h.query(
    "select count(*)::int count from auth.users where email like 'shop_profile_%@uwo.ca'"
  )[0].count,
  usersBefore
)
if (deployed)
  assert.equal(
    h.query('select count(*)::int count from public.shops')[0].count,
    baseline
  )
else
  assert.equal(
    h.query("select to_regclass('public.shops') is null absent")[0].absent,
    true
  )
assert.deepEqual(['.env.local', '.env.staging.local'].map(hash), envBefore)
console.log(rows.filter((row) => row.result))
console.log(
  'PASS staging-only rollback; no synthetic Shop/users retained; environment files unchanged'
)

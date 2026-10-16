// Exact staging target; candidate DDL and all synthetic rows are rolled back.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const migration = '202610160001_notification_inbox_management.sql'
const sql = fs
  .readFileSync('supabase/migrations/' + migration, 'utf8')
  .replace(/^\uFEFF/, '')
const body = sql.replace(/\bbegin;\s*/, '').replace(/\bcommit;\s*$/, '')
const test = fs.readFileSync('tests/notification-inbox-staging.sql', 'utf8')
const hash = () =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync('.env.local'))
    .digest('hex')
const before = hash()
const deployed = process.argv.includes('--deployed')
const scopeCount = () =>
  h.query(
    "select (select count(*) from marketplace_private.notification_events where source_key like 'inbox-rollback:%')::int events,(select count(*) from auth.users where email like 'ni_%@uwo.ca')::int users"
  )
const initialScope = scopeCount()
const rows = h.query(
  'begin isolation level repeatable read;\n' +
    (deployed ? '' : body) +
    '\n' +
    test +
    '\nrollback;'
)
assert.equal(hash(), before)
assert.deepEqual(scopeCount(), initialScope)
console.log(JSON.stringify(rows))
console.log(
  'PASS rollback completed; no synthetic fixtures persisted; .env.local unchanged; target ' +
    h.environment().NEXT_PUBLIC_SUPABASE_URL
)

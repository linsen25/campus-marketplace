const fs = require('fs'),
  path = require('path'),
  Module = require('module'),
  assert = require('assert/strict')
const m = new Module(path.resolve('tests/contact-fixtures.cjs'), module)
m.filename = path.resolve('tests/contact-fixtures.cjs')
m.paths = Module._nodeModulePaths(path.dirname(m.filename))
m._compile(
  fs
    .readFileSync('tests/order-meetup-fixtures.cjs', 'utf8')
    .replaceAll(
      'tests/artifacts/meetup-d1-fixtures',
      'tests/artifacts/contact-seller-fixtures'
    )
    .replace(
      "if (code !== 0) return fail('Staging SQL process failed', code)",
      "if (code !== 0) { console.error(e.match(/ERROR[^\\n]*/)?.[0]?.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+/g,'[redacted]') || 'SQL diagnostic unavailable');return fail('Staging SQL process failed',code) }"
    ),
  m.filename
)
const h = m.exports
;(async () => {
  const migration = fs.readFileSync(
    'supabase/migrations/202610150009_contact_seller_first_contact.sql',
    'utf8'
  )
  assert(/commit;\s*$/.test(migration))
  const applied = await h.query(
    "begin read only;select count(*) n from supabase_migrations.schema_migrations where version='202610150009';rollback;"
  )
  const prefix =
    applied[0].n === 1 ? 'begin;' : migration.replace(/commit;\s*$/, '')
  const rows = await h.query(
    prefix +
      '\n' +
      fs.readFileSync('tests/contact-seller-staging.sql', 'utf8') +
      '\nrollback;'
  )
  assert(rows.some((r) => r.passed))
  console.log(
    'PASS staging rollback-only first contact: exact intro/ack, repeat/reuse, one Seller notification, no Buyer fake unread/email, real reply, origin spoof/withdraw denial, grants and atomic failure recovery'
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

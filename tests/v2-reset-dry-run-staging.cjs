// Read-only hosted proof that the default reset command has zero mutation.
const assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process')
const {
  query,
  q,
  hash,
  environment,
  block,
} = require('../scripts/v2-maintenance-staging.cjs')
environment()
const payload =
  "Literal note $$; select 'data only'; -- \\ quote ' and dollar $maintenance$"
const roundTrip = query(
  'begin read only;' +
    block(
      `begin perform set_config('maintenance.roundtrip',${q(
        payload
      )},true);end;`
    ) +
    "select current_setting('maintenance.roundtrip') value;rollback;"
)[0]
assert.equal(
  roundTrip.value,
  payload,
  'Reset SQL must preserve quotes/backslashes/dollar delimiters as data'
)
const tables = query(
  "begin read only;select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in('public','marketplace_private') order by table_schema,table_name;rollback;"
)
const sql = tables
  .map((t) => {
    const name = t.table_schema + '.' + t.table_name
    return `select ${q(
      name
    )} name,count(*) count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${name} t`
  })
  .join(' union all ')
const fingerprint = () => query('begin read only;' + sql + ';rollback;')
const before = fingerprint()
const r = spawnSync(process.execPath, ['scripts/demo-reset-v2-staging.cjs'], {
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 4 * 1024 * 1024,
})
assert.equal(r.status, 0, 'Canonical dry-run failed (output suppressed)')
assert.deepEqual(fingerprint(), before, 'Dry-run changed staging rows')
console.log(
  JSON.stringify({
    project: 'pcaqxezdfxofysghssyo',
    dryRunZeroMutation: true,
    protectedTables: tables.length,
    fingerprint: hash(before),
  })
)
console.log(r.stdout)

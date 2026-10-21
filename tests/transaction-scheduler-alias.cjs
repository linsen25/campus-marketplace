// LOCAL PostgreSQL regression only: never reads env files or Supabase credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')

const historical = 'supabase/migrations/202610160005_dual_payment_paths.sql'
const migration =
  'supabase/migrations/202610180001_transaction_scheduler_alias_fix.sql'
const oldSql = fs.readFileSync(historical, 'utf8')
const nextSql = fs.readFileSync(migration, 'utf8')
const extract = (sql) =>
  sql.match(
    /create or replace function marketplace_private\.run_transaction_due_work\(\)[\s\S]*?end;\$\$;/
  )?.[0]
const before = extract(oldSql)
const after = extract(nextSql)
assert(before && after, 'Both actual scheduler definitions must exist')
const oldQuery =
  "from public.order_requests r where r.conversation_id=c.id and r.protocol_version=2 and r.status='active' and r.offer_terms->>'fulfillment'='on_campus' and (r.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp()"
const newQuery = oldQuery
  .replace(
    'public.order_requests r where',
    'public.order_requests due_offer where'
  )
  .replaceAll('r.', 'due_offer.')
assert.equal(before.split(oldQuery).length, 2, 'Exactly one colliding query')
assert.equal(
  after.replaceAll('\r', ''),
  before.replace(oldQuery, newQuery).replaceAll('\r', ''),
  'The entire function must be identical except the Offer SQL alias'
)
assert.equal(
  nextSql
    .replace(after, '')
    .replace(/^--[^\n]*$/gm, '')
    .replace(/\s/g, '')
    .toLowerCase(),
  'begin;commit;',
  'Forward migration may replace only this function inside a transaction'
)
console.log('PASS static: complete function equality except one SQL alias')

const executable = (name) => {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, name + suffix)
  const windows = path.join('C:/pgsql/bin', name + suffix)
  return process.platform === 'win32' && fs.existsSync(windows)
    ? windows
    : name + suffix
}
// Discard ambient connection/service/credential/options settings. Every psql
// invocation uses this test's new loopback port and freshly initialized cluster.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
env.PGCONNECT_TIMEOUT = '3'
const run = (name, args, input) => {
  const result = spawnSync(executable(name), args, {
    input,
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 30000,
  })
  assert.equal(
    result.status,
    0,
    `${name} failed locally: ${result.error?.message || result.stderr}`
  )
  return result.stdout.trim()
}

async function main() {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
  const artifacts = path.resolve('tests/artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const folder = fs.mkdtempSync(path.join(artifacts, 'scheduler-alias-local-'))
  const data = path.join(folder, 'data')
  const args = [
    '-X',
    '--no-password',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'scheduler_test',
    '-d',
    'postgres',
    '-At',
  ]
  const sql = (text) => run('psql', args, text)
  let started = false
  let holder
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'scheduler_test',
      '--auth=trust',
      '--no-locale',
      '--encoding=UTF8',
    ])
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(folder, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ])
    started = true
    sql(
      fs.readFileSync('tests/transaction-scheduler-alias-fixture.sql', 'utf8')
    )
    sql(
      before +
        '\nrevoke all on function marketplace_private.run_transaction_due_work() from public,anon,authenticated,service_role;'
    )
    const metadata = () =>
      sql(
        "select json_build_array(oid,proowner,proacl::text,prosecdef,proconfig,pg_get_function_identity_arguments(oid),pg_get_function_result(oid)) from pg_proc where oid='marketplace_private.run_transaction_due_work()'::regprocedure;"
      )
    const baseline = metadata()
    sql(`do $test$ begin
      perform marketplace_private.run_transaction_due_work();
      raise exception 'Old function unexpectedly succeeded';
    exception when undefined_column then
      if sqlerrm <> 'record "r" has no field "conversation_id"' then raise;end if;
    end;$test$;`)
    console.log(
      'PASS real PL/pgSQL: historical function reproduces exact error'
    )
    sql(nextSql)
    assert.equal(
      metadata(),
      baseline,
      'Function identity/owner/ACL/settings retained'
    )
    sql(
      fs.readFileSync(
        'tests/transaction-scheduler-alias-assertions.sql',
        'utf8'
      )
    )
    console.log(
      'PASS local migration: expiry selection, settlement order, all reminder branches, external guard, retry deduplication, private ACL and search_path'
    )

    holder = spawn(executable('psql'), args, {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const locked = new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(
        () => reject(Error('Local lock holder timed out')),
        5000
      )
      holder.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('LOCK_READY')) {
          clearTimeout(timer)
          resolve()
        }
      })
      holder.on('error', reject)
      holder.on('exit', (code) => {
        if (!output.includes('LOCK_READY')) {
          clearTimeout(timer)
          reject(Error(`Local lock holder exited: ${code}`))
        }
      })
    })
    holder.stdin.write(
      "begin; select pg_advisory_xact_lock(hashtextextended('marketplace_v2_due_work',0));\n\\echo LOCK_READY\n"
    )
    await locked
    const overlap = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.deepEqual(overlap, { overlapSkipped: true })
    assert.equal(
      sql(
        "select count(*) from marketplace_private.test_calls where operation='notify';"
      ),
      '3'
    )
    holder.stdin.end('rollback;\n\\q\n')
    await new Promise((resolve) => holder.once('exit', resolve))
    holder = undefined
    // Empty data still compiles/runs, and replaying the forward migration is safe.
    sql(
      'truncate public.order_requests,public.orders,marketplace_private.notification_reminders;'
    )
    sql(nextSql)
    assert.equal(
      JSON.parse(sql('select marketplace_private.run_transaction_due_work();'))
        .ordersChecked,
      0
    )
    assert.equal(metadata(), baseline)
    console.log(
      'PASS local overlap guard, empty scan and CREATE OR REPLACE replay'
    )
  } finally {
    holder?.kill()
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    // Keep ignored evidence; do not recursively delete unrelated artifacts.
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

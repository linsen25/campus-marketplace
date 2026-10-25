// LOCAL PostgreSQL regression only: never reads env files or Supabase credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')

const historical = 'supabase/migrations/202610160005_dual_payment_paths.sql'
const migration =
  'supabase/migrations/202610180001_transaction_scheduler_alias_fix.sql'
const runtimeMigration =
  'supabase/migrations/20261023190043_worker_runtime_reliability.sql'
const oldSql = fs.readFileSync(historical, 'utf8')
const nextSql = fs.readFileSync(migration, 'utf8')
const runtimeSql = fs.readFileSync(runtimeMigration, 'utf8')
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

    sql(runtimeSql)
    assert.equal(
      metadata(),
      baseline,
      'B28 CREATE OR REPLACE retains identity/owner/ACL/settings'
    )
    const runtimeDefinition = extract(runtimeSql)
    assert(runtimeDefinition, 'B28 scheduler definition must exist')
    assert.equal(
      runtimeDefinition.match(/limit batch_limit/g)?.length,
      3,
      'Each existing due-work category must have its own bound'
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
    assert.deepEqual(overlap, { overlapSkipped: true, batchLimit: 50 })
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
    sql(runtimeSql)
    const empty = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.equal(empty.ordersChecked, 0)
    assert.equal(empty.offersChecked, 0)
    assert.equal(empty.remindersChecked, 0)
    assert.equal(empty.batchLimit, 50)
    assert.equal(metadata(), baseline)
    console.log(
      'PASS local overlap guard, empty scan and CREATE OR REPLACE replay'
    )

    // Each category is independently bounded. Domain functions remain the
    // authority for state transitions; this test only counts selected work.
    sql(`truncate marketplace_private.test_calls,marketplace_private.notification_events,
      marketplace_private.notification_reminders,marketplace_private.delivery_checkouts,
      marketplace_private.order_protection,marketplace_private.protection_cases,
      marketplace_private.test_external_started,public.order_meetup_revisions,
      public.orders,public.order_requests,public.conversations,public.listings;
      insert into public.listings
      select md5('listing-'||n)::uuid from generate_series(1,55) n;
      insert into public.conversations
      select md5('conversation-'||n)::uuid,md5('listing-'||n)::uuid
      from generate_series(1,55) n;
      insert into public.order_requests
      select md5('conversation-'||n)::uuid,2,'active',
       jsonb_build_object('fulfillment','on_campus','scheduled_at',clock_timestamp()-interval '1 hour')
      from generate_series(1,55) n;`)
    const offerBound = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.equal(offerBound.offersChecked, 50)
    assert.equal(
      sql(
        "select count(*) from marketplace_private.test_calls where operation='expire';"
      ),
      '50'
    )

    sql(`truncate marketplace_private.test_calls,public.order_requests,public.conversations;
      insert into public.orders
      select md5('order-'||n)::uuid,md5('listing-'||n)::uuid,2,'open',true,'pending'
      from generate_series(1,55) n;
      insert into marketplace_private.delivery_checkouts
      select md5('order-'||n)::uuid,null,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour'
      from generate_series(1,55) n;`)
    const orderBound = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.equal(orderBound.ordersChecked, 50)
    assert.equal(
      sql(
        "select count(*) from marketplace_private.test_calls where operation='delivery';"
      ),
      '50'
    )
    sql(`truncate marketplace_private.test_calls;
      update marketplace_private.delivery_checkouts
      set checkout_claim_deadline_at=clock_timestamp()+interval '1 hour';
      update marketplace_private.delivery_checkouts checkout
      set checkout_claim_deadline_at=clock_timestamp()-interval '1 hour'
      where checkout.order_id in(
       select due_order.id from public.orders due_order
       order by due_order.listing_id desc limit 5);`)
    const dueOnly = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.equal(dueOnly.ordersChecked, 5)
    assert.equal(
      sql(
        "select count(*) from marketplace_private.test_calls where operation='delivery';"
      ),
      '5',
      'future Orders cannot consume the bounded due-work batch'
    )

    sql(`truncate marketplace_private.test_calls,public.orders;
      insert into public.orders
      values(md5('reminder-order')::uuid,md5('listing-1')::uuid,2,'open',true,'pending');
      insert into marketplace_private.delivery_checkouts
      values(md5('reminder-order')::uuid,null,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour');
      insert into marketplace_private.notification_reminders(identity,order_id,recipient,kind,due_at)
      select 'bounded-'||lpad(n::text,2,'0'),md5('reminder-order')::uuid,
       md5('recipient-'||n)::uuid,'delivery_claim_1h',clock_timestamp()-interval '1 hour'
      from generate_series(1,55) n;`)
    const reminderBound = JSON.parse(
      sql('select marketplace_private.run_transaction_due_work();')
    )
    assert.equal(reminderBound.remindersChecked, 50)
    assert.equal(
      sql(
        'select count(*) from marketplace_private.notification_reminders where delivered_at is not null;'
      ),
      '50'
    )
    assert.equal(
      sql(
        'select count(*) from marketplace_private.notification_reminders where delivered_at is null;'
      ),
      '5'
    )
    console.log(
      'PASS B28 scheduler bounds: Offers 50, due Orders 50 without future-order starvation, Reminders 50 per invocation'
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

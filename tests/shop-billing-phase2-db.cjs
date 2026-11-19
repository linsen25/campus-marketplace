// Disposable loopback PostgreSQL verification for Billing Phase 2.
// It does not read PG_* credentials and always removes its temporary cluster.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
const run = (name, args, input) => {
  const result = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(
    result.status,
    0,
    `${name}: ${result.stderr || result.error?.message}`
  )
  return result.stdout
}
const reject = (sql, statement, code) =>
  sql(`select public.billing_reject($q$${statement}$q$,'${code}');`)

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(
    path.join(root, 'tests/artifacts/shop-billing-phase2-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  const psqlArgs = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'billing_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'billing_test',
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
      'start',
    ])
    started = true
    const sql = (text) => run('psql', psqlArgs, text)
    sql(
      `create extension if not exists pgcrypto; create schema auth; create schema marketplace_private; create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls; create table auth.users(id uuid primary key); insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');`
    )
    sql(
      fs.readFileSync(
        path.join(
          root,
          'supabase/migrations/20261117160034_shop_billing_security_foundation.sql'
        ),
        'utf8'
      )
    )
    sql(`
      create function public.billing_reject(statement text, code text) returns void language plpgsql as $$
      begin
        begin execute statement;
        exception when others then
          if sqlstate=code then return; end if;
          raise;
        end;
        raise exception 'unexpected success: %', statement;
      end $$;
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id) values
      ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','acct_test','cus_owner_one'),
      ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','acct_test','cus_owner_two');
      insert into marketplace_private.shop_billing_subscriptions(id,owner_id,billing_customer_id,provider_account_id,provider_subscription_id,tier,status,current_period_start,current_period_end) values
      ('50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','acct_test','sub_owner_one','pro','active',clock_timestamp(),clock_timestamp()+interval '1 month');
      insert into marketplace_private.shop_billing_invoices(owner_id,billing_customer_id,billing_subscription_id,provider_account_id,provider_invoice_id,status,currency,amount_due_cents,amount_paid_cents) values
      ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000005','acct_test','in_owner_one','paid','CAD',199,199);
      insert into marketplace_private.shop_billing_events(provider_account_id,provider_event_id,event_type,payload_sha256,processing_status) values
      ('acct_test','evt_duplicate','invoice.paid',repeat('a',64),'received');
      update marketplace_private.shop_billing_events set processing_status='retryable',retry_count=1,next_retry_at=clock_timestamp()+interval '1 minute',error_summary='temporary failure' where provider_event_id='evt_duplicate';
      insert into marketplace_private.shop_billing_audit_log(owner_id,billing_customer_id,billing_subscription_id,action,details) values
      ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000005','subscription_synced','{"source":"test"}');
    `)
    reject(
      sql,
      "insert into marketplace_private.shop_billing_events(provider_account_id,provider_event_id,event_type,payload_sha256) values('acct_test','evt_duplicate','invoice.paid',repeat('b',64))",
      '23505'
    )
    reject(
      sql,
      "insert into marketplace_private.shop_billing_subscriptions(owner_id,billing_customer_id,provider_account_id,provider_subscription_id,tier,status) values('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','acct_test','sub_cross_owner','plus','active')",
      '23514'
    )
    reject(
      sql,
      "insert into marketplace_private.shop_billing_subscriptions(owner_id,billing_customer_id,provider_account_id,provider_subscription_id,tier,status) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','acct_test','sub_bad_status','plus','invented')",
      '23514'
    )
    reject(
      sql,
      "insert into marketplace_private.shop_billing_audit_log(owner_id,billing_invoice_id,action) select '20000000-0000-4000-8000-000000000002',id,'invoice_synced' from marketplace_private.shop_billing_invoices where provider_invoice_id='in_owner_one'",
      '23514'
    )
    reject(
      sql,
      "update marketplace_private.shop_billing_audit_log set action='event_failed'",
      '42501'
    )
    const result = sql(`
      create function public.billing_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'billing: %', label; end if; end $$;
      select public.billing_assert((select retry_count=1 and processing_status='retryable' and error_summary='temporary failure' from marketplace_private.shop_billing_events where provider_event_id='evt_duplicate'),'retry status retained');
      set role authenticated;
      select public.billing_reject($q$select * from marketplace_private.shop_billing_customers$q$,'42501');
      select public.billing_reject($q$insert into marketplace_private.shop_billing_events(provider_account_id,provider_event_id,event_type,payload_sha256) values('acct_test','evt_direct','invoice.paid',repeat('c',64))$q$,'42501');
      reset role;
      set role anon;
      select public.billing_reject($q$select * from marketplace_private.shop_billing_subscriptions$q$,'42501');
      reset role;
      set role service_role;
      select public.billing_reject($q$select * from marketplace_private.shop_billing_invoices$q$,'42501');
      reset role;
    `)
    assert.equal(typeof result, 'string')
    console.log(
      'PASS isolated Billing Phase 2 PostgreSQL: idempotent provider events, owner-bound records, fail-closed direct access, retry state, and immutable audit history.'
    )
  } finally {
    if (started)
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '5', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

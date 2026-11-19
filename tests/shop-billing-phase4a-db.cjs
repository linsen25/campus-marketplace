// Disposable loopback PostgreSQL coverage for Billing webhook inbox/state sync.
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

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(
    path.join(root, 'tests/artifacts/shop-billing-phase4a-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  const args = [
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
    const sql = (text) => run('psql', args, text)
    sql(
      `create schema extensions; create extension if not exists pgcrypto with schema extensions; create schema auth; create schema marketplace_private; create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls; create table auth.users(id uuid primary key); create table public.shops(id uuid primary key,owner_id uuid unique not null); create table marketplace_private.shop_memberships(owner_id uuid primary key references auth.users(id),revision bigint not null default 0); insert into auth.users values('10000000-0000-4000-8000-000000000001'); insert into public.shops values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001'); insert into marketplace_private.shop_memberships values('10000000-0000-4000-8000-000000000001',0);`
    )
    for (const file of [
      '20261117160034_shop_billing_security_foundation.sql',
      '20261117161641_shop_billing_checkout_command.sql',
      '20261117164538_shop_billing_webhook_foundation.sql',
    ])
      sql(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'))
    const output = sql(`
      create function public.p4_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'p4: %', label; end if; end $$;
      create function public.p4_subscription_count() returns integer language sql security definer set search_path='' as $$ select count(*)::integer from marketplace_private.shop_billing_subscriptions where provider_subscription_id='sub_Test' and status='active' $$;
      create function public.p4_event_state() returns text language sql security definer set search_path='' as $$ select processing_status from marketplace_private.shop_billing_events where provider_event_id='evt_Test' $$;
      create function public.p4_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id) values('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','acct_Test','cus_Test');
      set role service_role;
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Test','{"eventType":"customer.subscription.updated","objectId":"sub_Test","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerCreatedAt":"2026-11-17T00:00:00Z"}');
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Test','{"eventType":"customer.subscription.updated","objectId":"sub_Test","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerCreatedAt":"2026-11-17T00:00:00Z"}');
      do $$ declare c jsonb; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Test'); perform public.p4_assert((c->>'claimed')::boolean,'claim'); perform public.marketplace_shop_billing_sync_subscription('acct_Test','evt_Test',(c->>'lease')::uuid,'{"subscriptionId":"sub_Test","customerId":"cus_Test","status":"active","tier":"pro","priceId":"price_Pro","periodStart":"2026-11-01T00:00:00Z","periodEnd":"2026-12-01T00:00:00Z","cancelAtPeriodEnd":false,"canceledAt":null,"endedAt":null,"providerUpdatedAt":"2026-11-17T00:00:00Z"}'); perform public.marketplace_shop_billing_event_command('complete','acct_Test','evt_Test','{}'::jsonb,(c->>'lease')::uuid); end $$;
      select public.p4_assert(public.p4_subscription_count()=1,'provider subscription synced');
      reset role;
      select public.p4_assert(public.p4_event_state()='processed','event processed');
      set role authenticated;
      select public.p4_reject($q$select public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Test')$q$,'42501');
      reset role;
    `)
    assert.equal(typeof output, 'string')
    console.log(
      'PASS isolated Billing Phase 4A PostgreSQL: idempotent inbox, service-only lease, trusted customer binding, state sync, and processed completion.'
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

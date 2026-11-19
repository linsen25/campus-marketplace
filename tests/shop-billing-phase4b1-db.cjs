// Disposable loopback PostgreSQL coverage for Phase 4B-1 only.
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
    path.join(root, 'tests/artifacts/shop-billing-phase4b1-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
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
    const sql = (text) => run('psql', args, text)
    const migration = (name) =>
      fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8')

    sql(`
      create schema extensions;
      create extension if not exists pgcrypto with schema extensions;
      create extension if not exists btree_gist with schema extensions;
      create schema auth;
      create schema marketplace_private;
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      create table public.shops(id uuid primary key, owner_id uuid unique not null);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select true$$;
      insert into auth.users values
        ('10000000-0000-4000-8000-000000000001'),
        ('10000000-0000-4000-8000-000000000002'),
        ('10000000-0000-4000-8000-000000000003');
      insert into public.shops values
        ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
        ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
        ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003');
    `)
    sql(migration('202610190003_shop_membership_authority.sql'))
    sql(migration('20261117160034_shop_billing_security_foundation.sql'))
    sql(migration('20261117175102_shop_billing_membership_provider_terms.sql'))
    const output = sql(`
      create function public.p4b_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'p4b: %', label; end if; end $$;
      create function public.p4b_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;

      -- Existing Trial, One Month and legacy Grace retain their original evaluator.
      select marketplace_private.shop_membership_command('10000000-0000-4000-8000-000000000001','trial','30000000-0000-4000-8000-000000000001','{}','2027-01-01T00:00:00Z');
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000001','2027-01-15T00:00:00Z')->>'status')='trial','legacy Trial unchanged');
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000001','2027-03-03T00:00:00Z')->>'status')='grace','legacy Trial Grace unchanged');
      insert into marketplace_private.shop_memberships(owner_id,cycle_id,anchor_local,revision)
        values('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','2027-01-01 00:00:00',0);
      select marketplace_private.shop_membership_command('10000000-0000-4000-8000-000000000002','purchase','30000000-0000-4000-8000-000000000002',jsonb_build_object('expectedRevision',0,'expectedCycle','40000000-0000-4000-8000-000000000002','proof','legacy-one-month','tier','plus','mode','one_month','currency','CAD','amountCents',299),'2027-01-01T00:00:00Z');
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000002','2027-01-15T00:00:00Z')->>'status')='active','legacy One Month unchanged');

      -- Owner three has no legacy coverage. These are the only trusted provider records.
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id)
        values('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','acct_Test','cus_Test');
      insert into marketplace_private.shop_billing_subscriptions(id,owner_id,billing_customer_id,provider_account_id,provider_subscription_id,provider_price_id,tier,status,current_period_start,current_period_end,provider_updated_at)
        values('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','acct_Test','sub_Test','price_Pro','pro','canceled','2027-02-01T00:00:00Z','2027-03-01T00:00:00Z','2027-02-01T00:00:00Z');
      insert into marketplace_private.shop_billing_invoices(id,owner_id,billing_customer_id,billing_subscription_id,provider_account_id,provider_invoice_id,status,currency,amount_due_cents,amount_paid_cents,paid_at,provider_updated_at,service_period_start,service_period_end,provider_event_version)
        values('70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003','acct_Test','in_Test','paid','CAD',499,499,'2027-02-01T00:00:00Z','2027-02-01T00:00:00Z','2027-02-01T00:00:00Z','2027-03-01T00:00:00Z','2027-02-01T00:00:00Z');
      set role service_role;
      select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_membership_command('apply_paid_invoice','70000000-0000-4000-8000-000000000003',null);
      select public.marketplace_shop_billing_membership_command('apply_paid_invoice','70000000-0000-4000-8000-000000000003',null);
      reset role;
      select public.p4b_assert((select count(*)=1 from marketplace_private.shop_membership_provider_terms where billing_invoice_id='70000000-0000-4000-8000-000000000003'),'Invoice idempotency');
      select public.p4b_reject($q$select marketplace_private.shop_membership_command('10000000-0000-4000-8000-000000000003','trial','30000000-0000-4000-8000-000000000003','{}','2027-02-15T00:00:00Z')$q$,'23505');
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000003','2027-02-15T00:00:00Z')->>'status')='active','paid current period active despite period-end cancellation');
      set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
      select public.p4b_assert((public.marketplace_shop_membership()->>'status')='suspended','public projection uses provider-aware evaluator');
      reset role;
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000003','2027-03-02T00:00:00Z')->>'status')='suspended','period-end cancellation has no Grace');

      update marketplace_private.shop_billing_subscriptions set status='past_due',provider_updated_at='2027-03-01T00:00:00Z' where id='60000000-0000-4000-8000-000000000003';
      set role service_role;
      select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_membership_command('record_payment_failure',null,'60000000-0000-4000-8000-000000000003');
      reset role;
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000003','2027-03-03T00:00:00Z')->>'status')='grace','past due grants bounded paid Grace');
      select public.p4b_assert((marketplace_private.shop_entitlements('10000000-0000-4000-8000-000000000003','2027-03-07T00:00:00Z')->>'status')='suspended','paid Grace expires after five days');
      update marketplace_private.shop_billing_subscriptions set status='active',provider_updated_at='2027-03-02T00:00:00Z' where id='60000000-0000-4000-8000-000000000003';
      set role service_role;
      select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_membership_command('resolve_payment_state',null,'60000000-0000-4000-8000-000000000003');
      reset role;
      select public.p4b_assert((select grace_ends_at is null from marketplace_private.shop_membership_provider_terms where billing_invoice_id='70000000-0000-4000-8000-000000000003'),'recovered payment clears stale Grace');

      set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select public.p4b_reject($q$select public.marketplace_shop_billing_membership_command('apply_paid_invoice','70000000-0000-4000-8000-000000000003',null)$q$,'42501');
      reset role;
      select public.p4b_reject($q$insert into marketplace_private.shop_membership_provider_terms(owner_id,provider_account_id,billing_customer_id,billing_subscription_id,billing_invoice_id,provider_customer_id,provider_subscription_id,provider_invoice_id,provider_price_id,tier,payment_confirmed_at,service_period_start,service_period_end,provider_subscription_status,billing_revision,provider_event_version) values('10000000-0000-4000-8000-000000000001','acct_Test','50000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000003','cus_Test','sub_Test','in_Test','price_Pro','pro',now(),'2027-02-01','2027-03-01','active',0,'2027-02-01')$q$,'23514');
      select public.p4b_reject($q$delete from marketplace_private.shop_membership_billing_audit_log$q$,'42501');
    `)
    assert.equal(typeof output, 'string')
    console.log(
      'PASS isolated Billing Phase 4B-1 PostgreSQL: legacy terms preserved; verified Stripe invoice periods, cancellation, bounded paid Grace, idempotency, binding, and private access enforced.'
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

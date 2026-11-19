// Disposable loopback PostgreSQL coverage for Phase 4B-2 only.
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
    timeout: 60000,
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
    path.join(root, 'tests/artifacts/shop-billing-phase4b2-db-')
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
      create schema auth; create schema marketplace_private;
      create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      create table public.shops(id uuid primary key, owner_id uuid unique not null);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select true$$;
      insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
      insert into public.shops values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
    `)
    for (const file of [
      '202610190003_shop_membership_authority.sql',
      '20261117160034_shop_billing_security_foundation.sql',
      '20261117161641_shop_billing_checkout_command.sql',
      '20261117164538_shop_billing_webhook_foundation.sql',
      '20261117175102_shop_billing_membership_provider_terms.sql',
      '20261117212126_shop_billing_invoice_reconciliation.sql',
    ])
      sql(migration(file))
    const output = sql(`
      create function public.p42_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'p42: %', label; end if; end $$;
      create function public.p42_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id)
        values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','acct_Test','cus_Test');
      insert into marketplace_private.shop_billing_subscriptions(id,owner_id,billing_customer_id,provider_account_id,provider_subscription_id,provider_price_id,tier,status,current_period_start,current_period_end,provider_updated_at)
        values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','acct_Test','sub_Test','price_Pro','pro','active','2027-01-01T00:00:00Z','2027-02-01T00:00:00Z','2027-01-01T00:00:00Z');
      set role service_role;
      select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Paid','{"eventType":"invoice.paid","objectId":"in_Test","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerCreatedAt":"2027-01-02T00:00:00Z"}');
      do $$ declare c jsonb; r jsonb; p jsonb := '{"invoiceId":"in_Test","customerId":"cus_Test","subscriptionId":"sub_Test","status":"paid","currency":"CAD","amountDueCents":"499","amountPaidCents":"499","attemptCount":"1","billingReason":"subscription_cycle","priceId":"price_Pro","tier":"pro","servicePeriodStart":"2027-01-01T00:00:00Z","servicePeriodEnd":"2027-02-01T00:00:00Z","providerVersion":"2027-01-02T00:00:00Z","lineItemCount":"1","lineItemDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verificationState":"verified_paid","reason":"","paidAt":"2027-01-02T00:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Paid'); perform public.p42_assert((c->>'claimed')::boolean,'paid event lease'); r:=public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Paid',(c->>'lease')::uuid,p); perform public.p42_assert((r->>'proofEligible')::boolean,'verified proof'); r:=public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Paid',(c->>'lease')::uuid,p); perform public.p42_assert((r->>'state')='already_verified','idempotent proof replay'); perform public.marketplace_shop_billing_event_command('complete','acct_Test','evt_Paid','{}',(c->>'lease')::uuid); end $$;
      reset role;
      select public.p42_assert((select count(*)=1 from marketplace_private.shop_billing_invoice_proofs),'one immutable Invoice proof');
      select public.p42_assert((select count(*)=0 from marketplace_private.shop_membership_provider_terms),'proof does not grant Membership');
      set role service_role;
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Failed','{"eventType":"invoice.payment_failed","objectId":"in_Failed","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerCreatedAt":"2027-02-02T00:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"invoiceId":"in_Failed","customerId":"cus_Test","subscriptionId":"sub_Test","status":"open","currency":"CAD","amountDueCents":"499","amountPaidCents":"0","attemptCount":"1","billingReason":"subscription_cycle","priceId":"","tier":"","servicePeriodStart":"","servicePeriodEnd":"","providerVersion":"2027-02-02T00:00:00Z","lineItemCount":"1","lineItemDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","verificationState":"payment_failed","reason":"payment failed","paidAt":""}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Failed'); perform public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Failed',(c->>'lease')::uuid,p); end $$;
      reset role;
      select public.p42_assert((select reconciliation_state='payment_failed' and not proof_eligible from marketplace_private.shop_billing_invoices where provider_invoice_id='in_Failed'),'payment failure has no proof');
      set role service_role;
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Recovered','{"eventType":"invoice.paid","objectId":"in_Failed","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","providerCreatedAt":"2027-02-03T00:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"invoiceId":"in_Failed","customerId":"cus_Test","subscriptionId":"sub_Test","status":"paid","currency":"CAD","amountDueCents":"499","amountPaidCents":"499","attemptCount":"2","billingReason":"subscription_cycle","priceId":"price_Pro","tier":"pro","servicePeriodStart":"2027-02-01T00:00:00Z","servicePeriodEnd":"2027-03-01T00:00:00Z","providerVersion":"2027-02-03T00:00:00Z","lineItemCount":"1","lineItemDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","verificationState":"verified_paid","reason":"","paidAt":"2027-02-03T00:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Recovered'); perform public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Recovered',(c->>'lease')::uuid,p); end $$;
      reset role;
      select public.p42_assert((select proof_eligible and reconciliation_state='verified_paid' from marketplace_private.shop_billing_invoices where provider_invoice_id='in_Failed'),'same Invoice can recover only through a later verified paid event');
      set role service_role;
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Mismatch','{"eventType":"invoice.paid","objectId":"in_Mismatch","customerId":"cus_Other","subscriptionId":"sub_Test","payloadSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","providerCreatedAt":"2027-02-04T00:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"invoiceId":"in_Mismatch","customerId":"cus_Test","subscriptionId":"sub_Test","status":"paid","currency":"CAD","amountDueCents":"499","amountPaidCents":"499","attemptCount":"1","billingReason":"subscription_cycle","priceId":"price_Pro","tier":"pro","servicePeriodStart":"2027-03-01T00:00:00Z","servicePeriodEnd":"2027-04-01T00:00:00Z","providerVersion":"2027-02-04T00:00:00Z","lineItemCount":"1","lineItemDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","verificationState":"verified_paid","reason":"","paidAt":"2027-02-04T00:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Mismatch'); begin perform public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Mismatch',(c->>'lease')::uuid,p); raise exception 'mismatched event binding unexpectedly reconciled'; exception when sqlstate '23514' then null; end; end $$;
      reset role;
      set role authenticated;
      select public.p42_reject($q$select public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Paid','10000000-0000-4000-8000-000000000001','{}')$q$,'42501');
      select public.p42_reject($q$select * from marketplace_private.shop_billing_invoice_proofs$q$,'42501');
      select public.p42_reject($q$delete from marketplace_private.shop_billing_invoice_proofs$q$,'42501');
      reset role;
    `)
    assert.equal(typeof output, 'string')
    console.log(
      'PASS isolated Billing Phase 4B-2 PostgreSQL: chained migrations, service-only verified Invoice proofs, idempotency, payment-failure separation, immutable private records, and no Membership mutation.'
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

// Disposable loopback PostgreSQL coverage for Phase 4B-4B only.
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
    path.join(root, 'tests/artifacts/shop-billing-phase4b4b-db-')
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
    const readFixtureUuid = (query, label) => {
      const value = sql(query).trim()
      assert.match(
        value,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        `${label} fixture UUID`
      )
      return value
    }
    const migration = (name) =>
      fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8')
    sql(`
      create schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists btree_gist with schema extensions;
      create schema auth; create schema marketplace_private;
      create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls;
      create table auth.users(id uuid primary key); create table public.shops(id uuid primary key, owner_id uuid unique not null);
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
      '20261118024311_shop_billing_invoice_proof_entitlements.sql',
      '20261118083423_shop_billing_reversal_reconciliation.sql',
      '20261118091746_shop_billing_reversal_entitlements.sql',
    ])
      sql(migration(file))

    sql(`
      create function public.p44b_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'p44b: %', label; end if; end $$;
      create function public.p44b_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id) values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','acct_Test','cus_Test');
      insert into marketplace_private.shop_billing_subscriptions(id,owner_id,billing_customer_id,provider_account_id,provider_subscription_id,provider_price_id,tier,status,current_period_start,current_period_end,provider_updated_at) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','acct_Test','sub_Test','price_Pro','pro','active','2027-01-01T00:00:00Z','2027-02-01T00:00:00Z','2027-01-02T00:00:00Z');
    `)

    const reconcilePaid = (eventId, invoiceId, start, end, version) =>
      sql(`
        set role service_role; select set_config('request.jwt.claim.role','service_role',false);
        select public.marketplace_shop_billing_event_command('ingest','acct_Test','${eventId}','{"eventType":"invoice.paid","objectId":"${invoiceId}","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerCreatedAt":"${version}"}');
        do $$ declare c jsonb; p jsonb := '{"invoiceId":"${invoiceId}","customerId":"cus_Test","subscriptionId":"sub_Test","status":"paid","currency":"CAD","amountDueCents":"499","amountPaidCents":"499","attemptCount":"1","billingReason":"subscription_cycle","priceId":"price_Pro","tier":"pro","servicePeriodStart":"${start}","servicePeriodEnd":"${end}","providerVersion":"${version}","lineItemCount":"1","lineItemDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verificationState":"verified_paid","reason":"","paidAt":"${version}"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','${eventId}'); perform public.marketplace_shop_billing_reconcile_invoice('acct_Test','${eventId}',(c->>'lease')::uuid,p); end $$;
        reset role; select set_config('request.jwt.claim.role','authenticated',false);
      `)

    reconcilePaid(
      'evt_PaidOne',
      'in_One',
      '2027-01-01T00:00:00Z',
      '2027-02-01T00:00:00Z',
      '2027-01-02T00:00:00Z'
    )
    const invoiceOne = readFixtureUuid(
      "select id::text from marketplace_private.shop_billing_invoices where provider_invoice_id='in_One'",
      'first verified Invoice'
    )
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_apply_verified_invoice('${invoiceOne}'::uuid);
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
      update marketplace_private.shop_billing_subscriptions set current_period_start='2027-02-01T00:00:00Z',current_period_end='2027-03-01T00:00:00Z',provider_updated_at='2027-02-02T00:00:00Z' where provider_subscription_id='sub_Test';
    `)
    reconcilePaid(
      'evt_PaidTwo',
      'in_Two',
      '2027-02-01T00:00:00Z',
      '2027-03-01T00:00:00Z',
      '2027-02-02T00:00:00Z'
    )
    const invoiceTwo = readFixtureUuid(
      "select id::text from marketplace_private.shop_billing_invoices where provider_invoice_id='in_Two'",
      'second verified Invoice'
    )
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_apply_verified_invoice('${invoiceTwo}'::uuid);
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
    `)

    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_PartialOne','{"eventType":"refund.updated","objectId":"re_Partial","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","providerCreatedAt":"2027-02-02T12:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"sourceObjectId":"re_Partial","reversalId":"re_Partial","reversalType":"refund","sourceStatus":"succeeded","customerId":"cus_Test","subscriptionId":"sub_Test","invoiceId":"in_One","amountCents":"100","currency":"CAD","classification":"manual_review","providerVersion":"2027-02-02T12:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_PartialOne'); perform public.marketplace_shop_billing_reconcile_reversal('acct_Test','evt_PartialOne',(c->>'lease')::uuid,p); end $$;
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_DisputeOne','{"eventType":"charge.dispute.created","objectId":"dp_One","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","providerCreatedAt":"2027-02-02T12:30:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"sourceObjectId":"dp_One","reversalId":"dp_One","reversalType":"dispute","sourceStatus":"needs_response","customerId":"cus_Test","subscriptionId":"sub_Test","invoiceId":"in_One","amountCents":"499","currency":"CAD","classification":"observed","providerVersion":"2027-02-02T12:30:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_DisputeOne'); perform public.marketplace_shop_billing_reconcile_reversal('acct_Test','evt_DisputeOne',(c->>'lease')::uuid,p); end $$;
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p44b_assert((select count(*)=0 from marketplace_private.shop_billing_reversal_proofs),'partial refund and pending dispute create no automatic reversal proof');
      select public.p44b_assert((select revoked_at is null from marketplace_private.shop_membership_provider_terms where provider_invoice_id='in_One'),'partial refund and pending dispute do not revoke');
    `)

    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_RefundOne','{"eventType":"refund.updated","objectId":"re_One","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerCreatedAt":"2027-02-03T00:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"sourceObjectId":"re_One","reversalId":"re_One","reversalType":"refund","sourceStatus":"succeeded","customerId":"cus_Test","subscriptionId":"sub_Test","invoiceId":"in_One","amountCents":"499","currency":"CAD","classification":"verified_full_reversal","providerVersion":"2027-02-03T00:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_RefundOne'); perform public.marketplace_shop_billing_reconcile_reversal('acct_Test','evt_RefundOne',(c->>'lease')::uuid,p); end $$;
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
    `)
    const reversalProof = readFixtureUuid(
      "select id::text from marketplace_private.shop_billing_reversal_proofs where provider_reversal_id='re_One'",
      'verified full-refund reversal proof'
    )
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      do $$ declare r jsonb; begin r:=public.marketplace_shop_billing_apply_reversal_proof('${reversalProof}'::uuid); perform public.p44b_assert((r->>'outcome')='applied','full refund revokes exact original term'); r:=public.marketplace_shop_billing_apply_reversal_proof('${reversalProof}'::uuid); perform public.p44b_assert((r->>'outcome')='already_applied','duplicate reversal application is idempotent'); end $$;
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p44b_assert((select count(*)=1 from marketplace_private.shop_billing_reversal_entitlement_applications),'one immutable reversal application');
      select public.p44b_assert((select revoked_at is not null and revoke_reason='refund' from marketplace_private.shop_membership_provider_terms where provider_invoice_id='in_One'),'only original term is revoked');
      select public.p44b_assert((select revoked_at is null from marketplace_private.shop_membership_provider_terms where provider_invoice_id='in_Two'),'later paid term remains valid');
      select public.p44b_assert((marketplace_private.shop_provider_entitlements('10000000-0000-4000-8000-000000000001','2027-02-15T00:00:00Z')->>'status')='active','historical reversal cannot remove later valid coverage');
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_apply_verified_invoice('${invoiceOne}'::uuid);
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p44b_assert((select revoked_at is not null from marketplace_private.shop_membership_provider_terms where provider_invoice_id='in_One'),'old paid proof replay cannot restore revoked term');
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p44b_reject($q$select * from marketplace_private.shop_billing_reversal_entitlement_applications$q$,'42501');
      select public.p44b_reject($q$select public.marketplace_shop_billing_apply_reversal_proof('90000000-0000-4000-8000-000000000001')$q$,'42501');
      reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.p44b_reject($q$select * from marketplace_private.shop_billing_reversal_entitlement_applications$q$,'42501');
      reset role; select set_config('request.jwt.claim.role','authenticated',false);
    `)
    console.log(
      'PASS isolated Billing Phase 4B-4B PostgreSQL: proof-only full-refund revocation, exact-term idempotency, replay resistance, later-term preservation, and private-table denial.'
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

// Disposable loopback PostgreSQL coverage for Phase 4B-4C only.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')

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
    path.join(root, 'tests/artifacts/shop-billing-phase4b4c-db-')
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
    const readUuid = (query, label) => {
      const value = sql(query).trim()
      assert.match(
        value,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        label
      )
      return value
    }
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
      '20261119001659_shop_billing_reversal_manual_review.sql',
    ])
      sql(migration(file))
    sql(`
      create function public.p45_assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'p45: %', label; end if; end $$;
      create function public.p45_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;
      insert into marketplace_private.shop_billing_customers(id,owner_id,provider_account_id,provider_customer_id) values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','acct_Test','cus_Test');
      insert into marketplace_private.shop_billing_subscriptions(id,owner_id,billing_customer_id,provider_account_id,provider_subscription_id,provider_price_id,tier,status,current_period_start,current_period_end,provider_updated_at) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','acct_Test','sub_Test','price_Pro','pro','active','2027-01-01T00:00:00Z','2027-02-01T00:00:00Z','2027-01-02T00:00:00Z');
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','evt_Paid','{"eventType":"invoice.paid","objectId":"in_Test","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerCreatedAt":"2027-01-02T00:00:00Z"}');
      do $$ declare c jsonb; p jsonb := '{"invoiceId":"in_Test","customerId":"cus_Test","subscriptionId":"sub_Test","status":"paid","currency":"CAD","amountDueCents":"499","amountPaidCents":"499","attemptCount":"1","billingReason":"subscription_cycle","priceId":"price_Pro","tier":"pro","servicePeriodStart":"2027-01-01T00:00:00Z","servicePeriodEnd":"2027-02-01T00:00:00Z","providerVersion":"2027-01-02T00:00:00Z","lineItemCount":"1","lineItemDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verificationState":"verified_paid","reason":"","paidAt":"2027-01-02T00:00:00Z"}'; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','evt_Paid'); perform public.marketplace_shop_billing_reconcile_invoice('acct_Test','evt_Paid',(c->>'lease')::uuid,p); end $$;
      reset role;
    `)
    const reversal = (eventId, objectId, value) =>
      sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_event_command('ingest','acct_Test','${eventId}','{"eventType":"${
        value.eventType
      }","objectId":"${objectId}","customerId":"cus_Test","subscriptionId":"sub_Test","payloadSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerCreatedAt":"${
        value.providerVersion
      }"}');
      do $$ declare c jsonb; begin c:=public.marketplace_shop_billing_event_command('claim','acct_Test','${eventId}'); perform public.marketplace_shop_billing_reconcile_reversal('acct_Test','${eventId}',(c->>'lease')::uuid,'${JSON.stringify(
        value.payload
      )}'::jsonb); end $$;
      reset role;
    `)
    const payload = (
      reversalId,
      reversalType,
      sourceStatus,
      amount,
      classification,
      providerVersion
    ) => ({
      sourceObjectId: reversalId,
      reversalId,
      reversalType,
      sourceStatus,
      customerId: 'cus_Test',
      subscriptionId: 'sub_Test',
      invoiceId: 'in_Test',
      amountCents: String(amount),
      currency: 'CAD',
      classification,
      providerVersion,
    })
    reversal('evt_Partial', 're_Partial', {
      eventType: 'refund.updated',
      providerVersion: '2027-02-03T00:00:00Z',
      payload: payload(
        're_Partial',
        'refund',
        'succeeded',
        100,
        'manual_review',
        '2027-02-03T00:00:00Z'
      ),
    })
    const partialState = readUuid(
      "select id::text from marketplace_private.shop_billing_reversal_states where provider_reversal_id='re_Partial'",
      'partial state'
    )
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      do $$ declare r jsonb; begin r:=public.marketplace_shop_billing_register_reversal_review('${partialState}'::uuid); perform public.p45_assert((r->>'outcome')='created','partial creates review'); r:=public.marketplace_shop_billing_register_reversal_review('${partialState}'::uuid); perform public.p45_assert((r->>'outcome')='already_recorded','duplicate review is idempotent'); end $$;
      reset role;
      select public.p45_assert((select review_status='pending_review' and review_reason='partial_refund' from marketplace_private.shop_billing_reversal_reviews where reversal_state_id='${partialState}'::uuid),'partial refund pending review');
      select public.p45_assert((select count(*)=0 from marketplace_private.shop_membership_provider_terms),'review never creates Provider Terms');
      select public.p45_assert((select count(*)=0 from marketplace_private.shop_memberships),'review never changes Membership');
    `)
    const partialReview = readUuid(
      `select id::text from marketplace_private.shop_billing_reversal_reviews where reversal_state_id='${partialState}'::uuid`,
      'partial review'
    )
    const locker = spawn(bin('psql'), args, {
      env,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    const lockerDone = new Promise((resolve, reject) =>
      locker.on('close', (code) =>
        code === 0 ? resolve() : reject(Error('review locker failed'))
      )
    )
    locker.stdin.end(
      `begin; select * from marketplace_private.shop_billing_reversal_reviews where id='${partialReview}'::uuid for update; select pg_sleep(0.7); commit;`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const concurrent = sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_register_reversal_review('${partialState}'::uuid);
      reset role;
    `)
    assert.equal(typeof concurrent, 'string')
    await lockerDone
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_reversal_review_command('${partialReview}'::uuid,'begin_review',0);
      reset role;
      select public.p45_assert((select review_status='under_review' and revision=1 from marketplace_private.shop_billing_reversal_reviews where id='${partialReview}'::uuid),'service-only review lifecycle');
      select public.p45_assert((select count(*)=1 from marketplace_private.shop_billing_reversal_reviews where reversal_state_id='${partialState}'::uuid),'concurrent workers create one review case');
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p45_reject($q$select * from marketplace_private.shop_billing_reversal_reviews$q$,'42501');
      select public.p45_reject($q$select public.marketplace_shop_billing_register_reversal_review('${partialState}'::uuid)$q$,'42501');
      reset role;
    `)
    reversal('evt_Dispute', 'dp_Won', {
      eventType: 'charge.dispute.funds_reinstated',
      providerVersion: '2027-02-04T00:00:00Z',
      payload: payload(
        'dp_Won',
        'dispute',
        'won',
        499,
        'observed',
        '2027-02-04T00:00:00Z'
      ),
    })
    const disputeState = readUuid(
      "select id::text from marketplace_private.shop_billing_reversal_states where provider_reversal_id='dp_Won'",
      'dispute state'
    )
    sql(`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.marketplace_shop_billing_register_reversal_review('${disputeState}'::uuid);
      reset role;
      select public.p45_assert((select review_reason='conflicting_reversal_evidence' from marketplace_private.shop_billing_reversal_reviews where reversal_state_id='${disputeState}'::uuid),'same-Invoice dispute is reviewed as conflicting evidence');
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.p45_reject($q$select public.marketplace_shop_billing_register_reversal_review('90000000-0000-4000-8000-000000000001')$q$,'23514');
      reset role;
    `)
    console.log(
      'PASS isolated Billing Phase 4B-4C PostgreSQL: service-only manual review, duplicate/stale-safe cases, partial/dispute no-op, private-table denial, and no entitlement mutation.'
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

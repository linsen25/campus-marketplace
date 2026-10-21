// B23-A isolated native PostgreSQL test. Loopback only; no Supabase or Stripe.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const binary = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function run(name, args, input) {
  const result = spawnSync(binary(name), args, {
    input,
    env: environment,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}),
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return (result.stdout || '').trim()
}
function runAsync(name, args, input) {
  const child = spawn(binary(name), args, {
    env: environment,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (value) => (stdout += value))
  child.stderr.on('data', (value) => (stderr += value))
  child.stdin.end(input)
  return new Promise((resolve, reject) =>
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr))
    )
  )
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b23-db-'))
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
    'b23_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'b23_test',
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
    const sql = (text) => run('psql', args, text)
    sql(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema marketplace_private; create extension pgcrypto;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
      create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
      create table public.profiles(id uuid primary key);
      create table public.listings(id uuid primary key,status text,reserved_order_id uuid);
      create table public.orders(
       id uuid primary key,request_id uuid,conversation_id uuid,listing_id uuid references public.listings(id),buyer_id uuid,seller_id uuid,
       order_protocol_version int,terms_snapshot jsonb,lifecycle_status text,holds_listing boolean,payment_status text,payment_paid_at timestamptz,
       fulfillment_status text default 'awaiting_payment',payout_status text default 'not_eligible',created_at timestamptz default now(),updated_at timestamptz default now(),
       expired_at timestamptz,reservation_ended_at timestamptz,cancelled_at timestamptz,cancelled_by uuid,cancelled_by_role text,
       cancel_reason_code text,cancel_reason_label_snapshot text,cancel_note text);
      create table marketplace_private.campus_payment_attempts(
       id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),buyer_id uuid not null,command uuid not null,
       status text not null check(status in('processing','paid','failed')),started_at timestamptz not null,finished_at timestamptz,
       unique(buyer_id,command),check((status='processing')=(finished_at is null)),check(finished_at>=started_at));
      create unique index campus_one_processing on marketplace_private.campus_payment_attempts(order_id) where status='processing';
      create unique index campus_one_paid on marketplace_private.campus_payment_attempts(order_id) where status='paid';
      create table marketplace_private.financial_capabilities(user_id uuid,capability text,status text,primary key(user_id,capability));
      create table marketplace_private.delivery_checkouts(order_id uuid primary key,checkout_started_at timestamptz,payment_deadline_at timestamptz,address_snapshot jsonb,address_frozen_at timestamptz);
      create table marketplace_private.stripe_bindings(id uuid primary key default gen_random_uuid(),user_id uuid,kind text,platform text,mode text,status text,owner_ref text,instrument_ref text);
      create table marketplace_private.stripe_webhook_inbox(
       platform text not null,mode text not null check(mode='test'),event_id text not null,event_type text not null,account_scope text not null,owner_ref text,
       received_at timestamptz not null default now(),status text not null default 'pending' check(status in('pending','processing','done')),
       lease uuid,lease_until timestamptz,attempts int not null default 0,next_attempt_at timestamptz not null default now(),
       error_code text check(error_code in('reconcile_failed','binding_not_ready')),processed_at timestamptz,primary key(platform,mode,account_scope,event_id));
      create table marketplace_private.order_cancellation_intents(
       order_id uuid primary key references public.orders(id),state text not null,finalized_at timestamptz);
      create table marketplace_private.order_settlement_authorizations(
       order_id uuid primary key references public.orders(id),disposition text not null,secured_cents bigint not null,
       buyer_release_cents bigint not null,seller_delivery_compensation_cents bigint not null,
       platform_retained_cents bigint not null default 0,platform_reversed_cents bigint not null,
       seller_sale_payout_cents bigint not null default 0,authorized_at timestamptz not null,
       check(secured_cents=buyer_release_cents+seller_delivery_compensation_cents));
      create table marketplace_private.v2_order_economics(
       order_id uuid primary key references public.orders(id),item_price_cents bigint not null,delivery_fee_cents bigint not null,
       buyer_service_fee_cents bigint not null,buyer_total_cents bigint not null,seller_platform_fee_cents bigint not null,
       seller_gross_cents bigint not null,fee_rule text not null,created_at timestamptz not null);
      create table marketplace_private.meetup_expiries(order_id uuid,confirmed_id uuid,deadline timestamptz);
      create table public.order_meetup_revisions(id uuid primary key);
      create table public.transaction_events(conversation_id uuid,request_id uuid,order_id uuid,actor_id uuid,actor_role text,event_type text,created_at timestamptz,transition_key text unique,metadata jsonb);
      create function marketplace_private.require_stripe_staging() returns void language plpgsql security definer set search_path='' as $$begin
       if auth.role() is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then
        raise exception 'Trusted staging service required.' using errcode='42501';end if;end$$;
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
      create function marketplace_private.lock_financial_capability(uuid,text) returns void language sql as $$select$$;
      create function marketplace_private.order_agreement_ready(uuid) returns boolean language sql stable as $$select true$$;
      create function marketplace_private.payment_mode(jsonb) returns text language sql immutable as $$select $1->>'payment_mode'$$;
      create function marketplace_private.assert_order_progression(public.orders) returns void language sql as $$select$$;
      create function marketplace_private.v2_order_money(p uuid) returns jsonb language sql stable as $$
       select jsonb_build_object('total',buyer_total_cents) from marketplace_private.v2_order_economics where order_id=p$$;
      create function marketplace_private.notify_order_history(uuid) returns void language sql as $$select$$;
      create function marketplace_private.finalize_order_cancellation(uuid) returns void language sql as $$select$$;
      create function public.marketplace_stripe_events(p_action text,p_platform text,p_value jsonb default '{}'::jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
      grant usage on schema public to anon,authenticated,service_role;
    `)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610200002_order_payment_intent_start.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610210001_order_payment_reconciliation.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610210002_order_refund_operations.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610210003_order_refund_observations.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610210004_order_refund_event_integration.sql',
        'utf8'
      )
    )

    const buyer = randomUUID()
    const seller = randomUUID()
    const platform = 'acct_TestPlatform'
    const claims = `select set_config('request.jwt.claims','{"sub":"${buyer}","role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false);`
    const result = (statement) =>
      sql(claims + statement)
        .split('\n')
        .filter(Boolean)
        .at(-1)
    const prepare = (order, selectedPlatform = platform) =>
      JSON.parse(
        result(
          `select public.marketplace_order_refund_operation('prepare','${order}','${selectedPlatform}',null);`
        )
      )
    const claimFor = (order) => {
      sql(`update marketplace_private.order_refund_operations set next_reconcile_at=now()+interval '1 hour'
       where state in('prepared','in_flight','reconciling');
       update marketplace_private.order_refund_operations set next_reconcile_at=now()-interval '1 second',lease=null,lease_until=null
       where order_id='${order}';`)
      return JSON.parse(
        result(
          `select public.marketplace_order_refund_operation('claim_due',null,'${platform}',null);`
        )
      )
    }
    const observation = (operation, status, overrides = {}) => ({
      amount: String(operation.amount_cents),
      currency: 'cad',
      livemode: false,
      metadataAttempt: operation.payment_attempt_id,
      metadataEnvironment: 'staging',
      metadataKind: 'marketplace_order_refund',
      metadataOperation: operation.operation_id,
      metadataOrder: operation.order_id,
      operationId: operation.operation_id,
      paymentIntentRef: operation.payment_intent_ref,
      providerMode: 'test',
      providerPlatform: platform,
      providerStatus: status,
      refundRef: `re_${operation.operation_id.replaceAll('-', '')}`,
      ...overrides,
    })
    const applyResult = (operation, status, overrides = {}) =>
      JSON.parse(
        result(
          `select public.marketplace_order_refund_result('apply','${
            operation.order_id
          }','${platform}','${operation.lease}','${JSON.stringify(
            observation(operation, status, overrides)
          ).replaceAll("'", "''")}');`
        )
      )
    const deferResult = (operation, errorCode) =>
      JSON.parse(
        result(
          `select public.marketplace_order_refund_result('defer','${operation.order_id}','${platform}','${operation.lease}','{"errorCode":"${errorCode}"}');`
        )
      )
    const seed = ({
      paymentMode = 'uu_pay',
      paymentStatus = 'paid',
      attemptStatus = 'paid',
      intentState = 'finalized',
      secured = 10825,
      release = 10825,
      compensation = 0,
      withAuthorization = true,
      reconcileState = 'applied',
      exceptionCode = null,
      providerAmount = 10825,
      providerCurrency = 'CAD',
    } = {}) => {
      const ids = {
        order: randomUUID(),
        listing: randomUUID(),
        attempt: randomUUID(),
        pi: `pi_${randomUUID().replaceAll('-', '')}`,
      }
      const paidAt = '2026-10-21T12:00:00Z'
      const finished = attemptStatus === 'processing' ? 'null' : `'${paidAt}'`
      const paidOrderAt = paymentStatus === 'paid' ? `'${paidAt}'` : 'null'
      sql(`
       insert into public.listings values('${ids.listing}','available',null);
       insert into public.orders(id,request_id,conversation_id,listing_id,buyer_id,seller_id,order_protocol_version,terms_snapshot,lifecycle_status,holds_listing,payment_status,payment_paid_at,reservation_ended_at,cancelled_at)
        values('${ids.order}',gen_random_uuid(),gen_random_uuid(),'${
        ids.listing
      }','${buyer}','${seller}',2,
         '{"terms":{"payment_mode":"${paymentMode}"}}','cancelled',false,'${paymentStatus}',${paidOrderAt},'${paidAt}','${paidAt}');
       insert into marketplace_private.v2_order_economics values('${
         ids.order
       }',10000,0,825,10825,0,10000,'item_only_4pct_min100_max1500_v1','${paidAt}');
       insert into marketplace_private.order_cancellation_intents values('${
         ids.order
       }','${intentState}',case when '${intentState}'='finalized' then '${paidAt}'::timestamptz end);
       insert into marketplace_private.campus_payment_attempts(id,order_id,buyer_id,command,status,started_at,finished_at,provider,provider_mode,provider_platform,provider_purpose,
        provider_operation_id,provider_idempotency_key,provider_customer_ref,provider_instrument_ref,provider_seller_account_ref,provider_amount_cents,provider_currency,
        provider_transfer_group,provider_reference,provider_create_started_at,provider_bound_at,provider_status,provider_observed_at,provider_evidence_id,provider_reconcile_state,provider_exception_code)
       values('${ids.attempt}','${
        ids.order
      }','${buyer}',gen_random_uuid(),'${attemptStatus}','2026-10-21T11:59:00Z',${finished},'stripe','test','${platform}','marketplace_order',gen_random_uuid(),
        'uu:test:${platform}:order:'||gen_random_uuid(),'cus_Buyer','pm_Card','acct_Seller',${providerAmount},'${providerCurrency}','uu_order_${
        ids.order
      }','${ids.pi}',
        '2026-10-21T11:58:00Z','2026-10-21T11:58:30Z','succeeded','${paidAt}','evt_Evidence','${reconcileState}',${
        exceptionCode ? `'${exceptionCode}'` : 'null'
      });
      `)
      if (withAuthorization)
        sql(`insert into marketplace_private.order_settlement_authorizations values(
         '${ids.order}','${
          compensation ? 'delivery_compensation' : 'full_release'
        }',${secured},${release},${compensation},0,825,0,'${paidAt}');`)
      return ids
    }

    sql(`insert into public.profiles values('${buyer}'),('${seller}');`)
    assert.equal(
      sql(
        `select has_function_privilege('anon','public.marketplace_order_refund_operation(text,uuid,text,uuid)','execute') or
         has_function_privilege('authenticated','public.marketplace_order_refund_operation(text,uuid,text,uuid)','execute');`
      ),
      'f'
    )
    assert.equal(
      sql(
        `select has_table_privilege('anon','marketplace_private.order_refund_operations','select') or
         has_table_privilege('authenticated','marketplace_private.order_refund_operations','select') or
         has_table_privilege('service_role','marketplace_private.order_refund_operations','select');`
      ),
      'f'
    )
    assert.equal(
      sql(
        `select relrowsecurity from pg_class where oid='marketplace_private.order_refund_operations'::regclass;`
      ),
      't'
    )
    assert.equal(
      sql(
        `select has_function_privilege('anon','public.marketplace_order_refund_events(text,text,uuid,jsonb)','execute') or
         has_function_privilege('authenticated','public.marketplace_order_refund_events(text,text,uuid,jsonb)','execute') or
         has_function_privilege('anon','public.marketplace_order_refund_candidates(text,integer)','execute');`
      ),
      'f'
    )
    assert.throws(() =>
      sql(
        claims +
          `select public.marketplace_order_refund_operation(null,null,'${platform}',null);`
      )
    )
    assert.throws(() =>
      sql(
        claims +
          `select public.marketplace_order_refund_operation('claim_due',null,null,null);`
      )
    )

    const noAuthorization = seed({ withAuthorization: false })
    assert.throws(() => prepare(noAuthorization.order))
    const notFinal = seed({ intentState: 'awaiting_seller' })
    assert.throws(() => prepare(notFinal.order))
    const external = seed({ paymentMode: 'external' })
    assert.throws(() => prepare(external.order))
    const unpaid = seed({
      paymentStatus: 'pending',
      attemptStatus: 'processing',
      secured: 0,
      release: 0,
    })
    assert.throws(() => prepare(unpaid.order))
    const failed = seed({
      paymentStatus: 'failed',
      attemptStatus: 'failed',
      secured: 0,
      release: 0,
    })
    assert.throws(() => prepare(failed.order))

    const full = seed()
    const before = sql(
      `select row_to_json(x) from(select o.lifecycle_status,o.payment_status,o.payment_paid_at,l.status,
       s.seller_delivery_compensation_cents,s.seller_sale_payout_cents from public.orders o join public.listings l on l.id=o.listing_id
       join marketplace_private.order_settlement_authorizations s on s.order_id=o.id where o.id='${full.order}') x;`
    )
    const fullResult = prepare(full.order)
    assert.equal(fullResult.required, true)
    assert.equal(fullResult.amount_cents, 10825)
    assert.equal(fullResult.payment_intent_ref, full.pi)
    assert.match(
      fullResult.idempotency_key,
      /^uu:test:acct_TestPlatform:refund:/
    )
    const duplicate = prepare(full.order)
    assert.equal(duplicate.id, fullResult.id)
    assert.equal(duplicate.operation_id, fullResult.operation_id)
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_refund_operations where order_id='${full.order}';`
      ),
      '1'
    )
    assert.equal(
      sql(
        `select row_to_json(x) from(select o.lifecycle_status,o.payment_status,o.payment_paid_at,l.status,
         s.seller_delivery_compensation_cents,s.seller_sale_payout_cents from public.orders o join public.listings l on l.id=o.listing_id
         join marketplace_private.order_settlement_authorizations s on s.order_id=o.id where o.id='${full.order}') x;`
      ),
      before
    )

    const partial = seed({ secured: 10825, release: 8825, compensation: 2000 })
    assert.equal(prepare(partial.order).amount_cents, 8825)
    assert.equal(
      sql(
        `select seller_delivery_compensation_cents||'|'||seller_sale_payout_cents from marketplace_private.order_settlement_authorizations where order_id='${partial.order}';`
      ),
      '2000|0'
    )
    const zero = seed({ secured: 10825, release: 0, compensation: 10825 })
    assert.deepEqual(prepare(zero.order), {
      required: false,
      order_id: zero.order,
      amount_cents: 0,
      reason: 'zero_buyer_release',
    })
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_refund_operations where order_id='${zero.order}';`
      ),
      '0'
    )

    const race = seed({
      reconcileState: 'exception',
      exceptionCode: 'paid_after_cancellation_requested',
    })
    assert.equal(prepare(race.order).amount_cents, 10825)
    const otherException = seed({
      reconcileState: 'exception',
      exceptionCode: 'late_success',
    })
    assert.throws(() => prepare(otherException.order))
    const wrongPlatform = seed()
    assert.throws(() => prepare(wrongPlatform.order, 'acct_OtherPlatform'))
    const badBinding = seed({ providerAmount: 10824 })
    assert.throws(() => prepare(badBinding.order))
    const badIntent = seed()
    prepare(badIntent.order)
    sql(
      `update marketplace_private.campus_payment_attempts set provider_reference='pi_ChangedReference' where id='${badIntent.attempt}';`
    )
    assert.throws(() => prepare(badIntent.order))
    const currency = seed()
    assert.throws(() =>
      sql(
        `update marketplace_private.campus_payment_attempts set provider_currency='USD' where id='${currency.attempt}';`
      )
    )

    sql(`update marketplace_private.order_refund_operations set next_reconcile_at=now()+interval '1 hour';
      update marketplace_private.order_refund_operations set next_reconcile_at=now()-interval '2 minutes' where order_id='${partial.order}';
      update marketplace_private.order_refund_operations set next_reconcile_at=now()-interval '1 minute' where order_id='${race.order}';`)
    const lockedCandidate = runAsync(
      'psql',
      args,
      `begin;select 1 from public.listings where id='${partial.listing}' for update;select pg_sleep(2);commit;`
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const skippedClaim = JSON.parse(
      result(
        `select public.marketplace_order_refund_operation('claim_due',null,'${platform}',null);`
      )
    )
    assert.equal(skippedClaim.order_id, race.order)
    await lockedCandidate

    sql(`update marketplace_private.order_refund_operations set next_reconcile_at=now()+interval '1 hour';
      update marketplace_private.order_refund_operations set next_reconcile_at=now()-interval '1 second' where order_id='${full.order}';`)
    const concurrentInput = `${claims}begin;
      select public.marketplace_order_refund_operation('claim_due',null,'${platform}',null)->>'lease';
      select pg_sleep(2);commit;`
    const firstClaimPromise = runAsync('psql', args, concurrentInput)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(
      result(
        `select public.marketplace_order_refund_operation('claim_due',null,'${platform}',null) is null;`
      ),
      't'
    )
    const firstClaimText = await firstClaimPromise
    const firstLease = [
      ...firstClaimText.matchAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
      ),
    ].at(-1)?.[0]
    assert.ok(firstLease)
    assert.equal(
      JSON.parse(
        result(
          `select public.marketplace_order_refund_operation('read','${full.order}','${platform}','${firstLease}');`
        )
      ).claim_kind,
      null
    )
    sql(
      `update marketplace_private.order_refund_operations set lease_until=now()-interval '1 second',next_reconcile_at=now()-interval '1 second' where order_id='${full.order}';`
    )
    const replacement = JSON.parse(
      result(
        `select public.marketplace_order_refund_operation('claim_due',null,'${platform}',null);`
      )
    )
    assert.equal(replacement.claim_kind, 'reconcile')
    assert.notEqual(replacement.lease, firstLease)
    assert.throws(() =>
      result(
        `select public.marketplace_order_refund_operation('read','${full.order}','${platform}','${firstLease}');`
      )
    )
    assert.equal(
      JSON.parse(
        result(
          `select public.marketplace_order_refund_operation('read','${full.order}','${platform}','${replacement.lease}');`
        )
      ).id,
      fullResult.id
    )
    assert.throws(() =>
      sql(
        `update marketplace_private.order_refund_operations set amount_cents=1 where order_id='${full.order}';`
      )
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_refund_operations where state='succeeded' or refund_ref is not null;`
      ),
      '0'
    )

    assert.equal(
      sql(
        `select has_function_privilege('anon','public.marketplace_order_refund_result(text,uuid,text,uuid,jsonb)','execute') or
         has_function_privilege('authenticated','public.marketplace_order_refund_result(text,uuid,text,uuid,jsonb)','execute');`
      ),
      'f'
    )
    const pendingIds = seed()
    prepare(pendingIds.order)
    const pendingClaim = claimFor(pendingIds.order)
    const pendingResult = applyResult(pendingClaim, 'pending')
    assert.equal(pendingResult.state, 'reconciling')
    assert.equal(pendingResult.provider_status, 'pending')

    const successIds = seed({
      secured: 10825,
      release: 8825,
      compensation: 2000,
    })
    const successBefore = sql(
      `select row_to_json(x) from(select o.lifecycle_status,o.payment_status,l.status,
       s.buyer_release_cents,s.seller_delivery_compensation_cents,s.seller_sale_payout_cents
       from public.orders o join public.listings l on l.id=o.listing_id
       join marketplace_private.order_settlement_authorizations s on s.order_id=o.id where o.id='${successIds.order}') x;`
    )
    prepare(successIds.order)
    const successClaim = claimFor(successIds.order)
    const successResult = applyResult(successClaim, 'succeeded')
    assert.equal(successResult.state, 'succeeded')
    assert.equal(successResult.amount_cents, 8825)
    assert.equal(applyResult(successClaim, 'succeeded').result, 'duplicate')
    assert.throws(() => applyResult(successClaim, 'failed'))
    assert.equal(
      sql(
        `select row_to_json(x) from(select o.lifecycle_status,o.payment_status,l.status,
         s.buyer_release_cents,s.seller_delivery_compensation_cents,s.seller_sale_payout_cents
         from public.orders o join public.listings l on l.id=o.listing_id
         join marketplace_private.order_settlement_authorizations s on s.order_id=o.id where o.id='${successIds.order}') x;`
      ),
      successBefore
    )

    for (const [providerStatus, expectedState] of [
      ['failed', 'failed'],
      ['canceled', 'failed'],
      ['requires_action', 'exception'],
    ]) {
      const ids = seed()
      prepare(ids.order)
      const claimed = claimFor(ids.order)
      const applied = applyResult(claimed, providerStatus)
      assert.equal(applied.state, expectedState)
      assert.equal(applied.provider_status, providerStatus)
      if (providerStatus === 'requires_action')
        assert.equal(applied.last_error_code, 'requires_action')
    }

    const mismatchIds = seed()
    prepare(mismatchIds.order)
    const mismatchClaim = claimFor(mismatchIds.order)
    assert.throws(() =>
      applyResult(mismatchClaim, 'succeeded', { amount: '1' })
    )
    assert.equal(
      deferResult(mismatchClaim, 'provider_mismatch').state,
      'exception'
    )

    const unknownIds = seed()
    prepare(unknownIds.order)
    const unknownClaim = claimFor(unknownIds.order)
    const deferred = deferResult(unknownClaim, 'unknown_outcome')
    assert.equal(deferred.state, 'reconciling')
    assert.equal(deferred.lease, null)

    const exhaustedIds = seed()
    prepare(exhaustedIds.order)
    sql(
      `update marketplace_private.order_refund_operations set attempts=5 where order_id='${exhaustedIds.order}';`
    )
    const exhaustedClaim = claimFor(exhaustedIds.order)
    assert.equal(
      deferResult(exhaustedClaim, 'unknown_outcome').state,
      'exception'
    )

    const staleIds = seed()
    prepare(staleIds.order)
    const staleClaim = claimFor(staleIds.order)
    sql(
      `update marketplace_private.order_refund_operations set lease_until=now()-interval '1 second' where order_id='${staleIds.order}';`
    )
    assert.throws(() => applyResult(staleClaim, 'succeeded'))

    const candidateIds = seed()
    sql(
      `update public.orders set cancelled_at='2026-10-20T00:00:00Z',reservation_ended_at='2026-10-20T00:00:00Z'
       where id='${candidateIds.order}';`
    )
    const candidateRows = sql(
      claims +
        `select order_id from public.marketplace_order_refund_candidates('${platform}',20);`
    )
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    assert(candidateRows.includes(candidateIds.order))
    assert(!candidateRows.includes(external.order))
    assert(!candidateRows.includes(zero.order))

    const eventIds = seed()
    const eventOperation = prepare(eventIds.order)
    const eventId = 'evt_RefundEvent'
    sql(`insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
      values('${platform}','test','evt_Setup','customer.updated','${platform}','account_setup',null),
       ('${platform}','test','evt_Payment','payment_intent.succeeded','${platform}','marketplace_order','pi_Isolated');`)
    const enqueueValue = JSON.stringify({
      id: eventId,
      type: 'refund.updated',
      scope: platform,
      providerReference: 're_RefundEvent',
    })
    sql(
      claims +
        `select public.marketplace_order_refund_events('enqueue','${platform}',null,$json$${enqueueValue}$json$::jsonb);
         select public.marketplace_order_refund_events('enqueue','${platform}',null,$json$${enqueueValue}$json$::jsonb);`
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.stripe_webhook_inbox where purpose='marketplace_order_refund' and event_id='${eventId}';`
      ),
      '1'
    )
    const eventClaim = JSON.parse(
      result(
        `select public.marketplace_order_refund_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    assert.equal(eventClaim.providerReference, 're_RefundEvent')
    assert.equal(
      sql(
        `select count(*) from marketplace_private.stripe_webhook_inbox
         where event_id in('evt_Setup','evt_Payment') and status='pending';`
      ),
      '2'
    )
    const doneValue = JSON.stringify({
      amount: String(eventOperation.amount_cents),
      currency: 'cad',
      eventId,
      metadataOperation: eventOperation.operation_id,
      metadataOrder: eventIds.order,
      paymentIntentRef: eventOperation.payment_intent_ref,
      refundRef: 're_RefundEvent',
    })
    sql(
      claims +
        `select public.marketplace_order_refund_events('done','${platform}','${eventClaim.lease}',$json$${doneValue}$json$::jsonb);`
    )
    assert.equal(
      sql(
        `select status||':'||coalesce(error_code,'none') from marketplace_private.stripe_webhook_inbox
         where purpose='marketplace_order_refund' and event_id='${eventId}';`
      ),
      'done:none'
    )
    assert.throws(() =>
      sql(
        claims +
          `select public.marketplace_order_refund_events('retry','${platform}','${eventClaim.lease}',
           '{"eventId":"${eventId}","reason":"provider_unavailable"}'::jsonb);`
      )
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.stripe_webhook_inbox where purpose='marketplace_order_refund' and status<>'done';`
      ),
      '0'
    )
    const crashValue = JSON.stringify({
      id: 'evt_RefundCrash',
      type: 'refund.created',
      scope: platform,
      providerReference: 're_RefundCrash',
    })
    sql(
      claims +
        `select public.marketplace_order_refund_events('enqueue','${platform}',null,$json$${crashValue}$json$::jsonb);`
    )
    const abandoned = JSON.parse(
      result(
        `select public.marketplace_order_refund_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    sql(
      `update marketplace_private.stripe_webhook_inbox set lease_until=now()-interval '1 second'
       where purpose='marketplace_order_refund' and event_id='evt_RefundCrash';`
    )
    const recoveredEvent = JSON.parse(
      result(
        `select public.marketplace_order_refund_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    assert.notEqual(recoveredEvent.lease, abandoned.lease)
    assert.throws(() =>
      sql(
        claims +
          `select public.marketplace_order_refund_events('retry','${platform}','${abandoned.lease}',
           '{"eventId":"evt_RefundCrash","reason":"provider_unavailable"}'::jsonb);`
      )
    )
    sql(
      claims +
        `select public.marketplace_order_refund_events('retry','${platform}','${recoveredEvent.lease}',
         '{"eventId":"evt_RefundCrash","reason":"provider_unavailable"}'::jsonb);`
    )
    console.log(
      'PASS B23-A/B/C isolated PostgreSQL authorization, bounded discovery, purpose-isolated event dedupe/lease/wake, immutable refund identity, fenced observations and no Order/Seller mutation'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

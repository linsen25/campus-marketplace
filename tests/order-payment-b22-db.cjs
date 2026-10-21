// B22 isolated native PostgreSQL test. Loopback only; no Supabase or Stripe.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
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
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b22-db-'))
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
    'b22_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'b22_test',
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
      create table marketplace_private.campus_payment_attempts(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),buyer_id uuid not null,command uuid not null,status text not null,started_at timestamptz not null,finished_at timestamptz,unique(buyer_id,command));
      create unique index campus_one_processing on marketplace_private.campus_payment_attempts(order_id) where status='processing';
      create table marketplace_private.financial_capabilities(user_id uuid,capability text,status text,primary key(user_id,capability));
      create table marketplace_private.delivery_checkouts(order_id uuid primary key,checkout_started_at timestamptz,payment_deadline_at timestamptz,address_snapshot jsonb,address_frozen_at timestamptz);
      create table marketplace_private.stripe_bindings(id uuid primary key default gen_random_uuid(),user_id uuid,kind text,platform text,mode text,status text,owner_ref text,instrument_ref text);
      create table marketplace_private.stripe_webhook_inbox(
       platform text not null,mode text not null check(mode='test'),event_id text not null,event_type text not null,account_scope text not null,owner_ref text,
       received_at timestamptz not null default now(),status text not null default 'pending' check(status in('pending','processing','done')),
       lease uuid,lease_until timestamptz,attempts int not null default 0,next_attempt_at timestamptz not null default now(),
       error_code text check(error_code in('reconcile_failed','binding_not_ready')),processed_at timestamptz,primary key(platform,mode,account_scope,event_id));
      create table marketplace_private.order_cancellation_intents(order_id uuid primary key,state text default 'pending');
      create table marketplace_private.order_settlement_authorizations(order_id uuid primary key,kind text);
      create table marketplace_private.meetup_expiries(order_id uuid,confirmed_id uuid,deadline timestamptz);
      create table public.order_meetup_revisions(id uuid primary key);
      create table public.transaction_events(conversation_id uuid,request_id uuid,order_id uuid,actor_id uuid,actor_role text,event_type text,created_at timestamptz,transition_key text unique,metadata jsonb);
      create function marketplace_private.require_stripe_staging() returns void language plpgsql security definer set search_path='' as $$begin if auth.role() is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging service required.' using errcode='42501';end if;end$$;
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
      create function marketplace_private.lock_financial_capability(uuid,text) returns void language sql as $$select$$;
      create function marketplace_private.order_agreement_ready(uuid) returns boolean language sql stable as $$select true$$;
      create function marketplace_private.payment_mode(jsonb) returns text language sql immutable as $$select $1->>'payment_mode'$$;
      create function marketplace_private.assert_order_progression(public.orders) returns void language sql as $$select$$;
      create function marketplace_private.v2_order_money(uuid) returns jsonb language sql stable as $$select '{"item":10000,"delivery":0,"fee":825,"total":10825,"sellerFee":0,"sellerGross":10000}'::jsonb$$;
      create function marketplace_private.notify_order_history(uuid) returns void language sql as $$select$$;
      create function marketplace_private.finalize_order_cancellation(p_order uuid) returns void language plpgsql security definer set search_path='' as $$begin
       if exists(select 1 from marketplace_private.order_cancellation_intents where order_id=p_order) then
        insert into marketplace_private.order_settlement_authorizations values(p_order,'review') on conflict do nothing;
        update public.orders set lifecycle_status='cancelled',holds_listing=false,cancelled_at=now(),reservation_ended_at=now(),
         cancelled_by=buyer_id,cancelled_by_role='buyer',cancel_reason_code='test',cancel_reason_label_snapshot='Test',cancel_note='Test' where id=p_order;
       end if;
      end$$;
      create function public.marketplace_stripe_events(p_action text,p_platform text,p_value jsonb default '{}'::jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
      grant usage on schema public to anon,authenticated,service_role;
    `)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610200002_order_payment_intent_start.sql',
        'utf8'
      )
    )
    sql(`insert into marketplace_private.stripe_webhook_inbox(
      platform,mode,event_id,event_type,account_scope,owner_ref)
      values('acct_TestPlatform','test','evt_LegacySetup','customer.updated',
       'acct_TestPlatform','cus_Legacy');`)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610210001_order_payment_reconciliation.sql',
        'utf8'
      )
    )
    sql(
      `create trigger order_event after insert or update on public.orders for each row execute function marketplace_private.order_event();`
    )

    const buyer = '22333333-3333-4333-8333-333333333333'
    const seller = '22777777-7777-4777-8777-777777777777'
    const claims = `select set_config('request.jwt.claims','{"sub":"${buyer}","role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false);`
    const platform = 'acct_TestPlatform'
    const base = (suffix) => ({
      order: `22222222-2222-4222-8222-2222222222${suffix}`,
      listing: `22888888-8888-4888-8888-8888888888${suffix}`,
      attempt: `22111111-1111-4111-8111-1111111111${suffix}`,
    })
    sql(`insert into public.profiles values('${buyer}'),('${seller}');`)
    assert.equal(
      sql(
        `select purpose||'|'||coalesce(provider_ref,'null') from marketplace_private.stripe_webhook_inbox
         where event_id='evt_LegacySetup';`
      ),
      'account_setup|null'
    )
    sql(`insert into marketplace_private.stripe_bindings(user_id,kind,platform,mode,status,owner_ref,instrument_ref) values
      ('${buyer}','payment_method','${platform}','test','set','cus_Buyer','pm_Card'),
      ('${seller}','payout_account','${platform}','test','ready','acct_Seller','ba_Bank');`)
    const seed = (ids, pi) => {
      sql(`
       insert into public.listings values('${ids.listing}','pending','${ids.order}');
       insert into public.orders(id,request_id,conversation_id,listing_id,buyer_id,seller_id,order_protocol_version,terms_snapshot,lifecycle_status,holds_listing,payment_status)
        values('${ids.order}',gen_random_uuid(),gen_random_uuid(),'${ids.listing}','${buyer}','${seller}',2,'{"terms":{"payment_mode":"uu_pay","fulfillment":"on_campus"}}','open',true,'processing');
       insert into marketplace_private.campus_payment_attempts(id,order_id,buyer_id,command,status,started_at,provider,provider_mode,provider_platform,provider_purpose,
        provider_operation_id,provider_idempotency_key,provider_customer_ref,provider_instrument_ref,provider_seller_account_ref,provider_amount_cents,provider_currency,
        provider_transfer_group,provider_reference,provider_create_started_at,provider_bound_at)
       values('${ids.attempt}','${ids.order}','${buyer}',gen_random_uuid(),'processing',now(),'stripe','test','${platform}','marketplace_order',gen_random_uuid(),
        'uu:test:${platform}:order:'||gen_random_uuid(),'cus_Buyer','pm_Card','acct_Seller',10825,'CAD','uu_order_${ids.order}','${pi}',now(),now());
      `)
    }
    const value = (ids, pi, evidence, status, received = 10825) =>
      JSON.stringify({
        amount: '10825',
        amountReceived: String(received),
        attemptId: ids.attempt,
        currency: 'cad',
        customer: 'cus_Buyer',
        evidenceId: evidence,
        livemode: false,
        metadataAttempt: ids.attempt,
        metadataEnvironment: 'staging',
        metadataKind: 'marketplace_order',
        orderId: ids.order,
        paymentMethod: 'pm_Card',
        providerReference: pi,
        providerStatus: status,
        sellerAccount: 'acct_Seller',
        transferGroup: `uu_order_${ids.order}`,
      }).replaceAll("'", "''")
    const enqueue = (event, pi, type = 'payment_intent.succeeded') =>
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('enqueue','${platform}',null,'{"id":"${event}","type":"${type}","scope":"${platform}","providerReference":"${pi}"}');`
      )
    const claimEvent = () => {
      const text = sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('claim_event','${platform}');`
      )
        .split('\n')
        .at(-1)
      return text ? JSON.parse(text) : null
    }
    const applyEvent = (ids, pi, event, lease, status, received) =>
      JSON.parse(
        sql(
          claims +
            `select public.marketplace_order_payment_reconciliation('apply_event','${platform}','${lease}','${value(
              ids,
              pi,
              event,
              status,
              received
            )}');`
        )
          .split('\n')
          .at(-1)
      )

    assert.equal(
      sql(
        `select has_function_privilege('authenticated','public.marketplace_order_payment_reconciliation(text,text,uuid,jsonb)','execute');`
      ),
      'f'
    )
    const first = base('01')
    seed(first, 'pi_Success')
    enqueue('evt_Success', 'pi_Success')
    enqueue('evt_Success', 'pi_Success')
    assert.equal(
      sql(
        `select count(*) from marketplace_private.stripe_webhook_inbox where purpose='marketplace_order';`
      ),
      '1'
    )
    const legacySetupClaim = JSON.parse(
      sql(
        claims +
          `select public.marketplace_stripe_events('claim','${platform}');`
      )
        .split('\n')
        .at(-1)
    )
    assert.equal(legacySetupClaim.event_id, 'evt_LegacySetup')
    assert.equal(
      sql(
        `select status from marketplace_private.stripe_webhook_inbox where purpose='marketplace_order' and event_id='evt_Success';`
      ),
      'pending'
    )
    let claim = claimEvent()
    assert.equal(claim.eventId, 'evt_Success')
    assert.equal(
      applyEvent(first, 'pi_Success', 'evt_Success', claim.lease, 'succeeded')
        .result,
      'applied'
    )
    assert.equal(
      sql(
        `select payment_status from public.orders where id='${first.order}';`
      ),
      'paid'
    )
    assert.equal(
      sql(
        `select status from marketplace_private.campus_payment_attempts where id='${first.attempt}';`
      ),
      'paid'
    )
    assert.equal(
      sql(
        `select metadata->>'source' from public.transaction_events where transition_key='${first.order}:payment_paid';`
      ),
      'stripe'
    )

    enqueue('evt_Duplicate', 'pi_Success', 'payment_intent.payment_failed')
    claim = claimEvent()
    assert.equal(
      applyEvent(first, 'pi_Success', 'evt_Duplicate', claim.lease, 'succeeded')
        .result,
      'duplicate'
    )
    assert.equal(
      sql(
        `select count(*) from public.transaction_events where transition_key='${first.order}:payment_paid';`
      ),
      '1'
    )

    const mismatch = base('02')
    seed(mismatch, 'pi_Mismatch')
    enqueue('evt_Mismatch', 'pi_Mismatch')
    claim = claimEvent()
    const wrong = value(
      mismatch,
      'pi_Mismatch',
      'evt_Mismatch',
      'succeeded'
    ).replace('10825', '10826')
    const mismatchResult = JSON.parse(
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('apply_event','${platform}','${claim.lease}','${wrong}');`
      )
        .split('\n')
        .at(-1)
    )
    assert.equal(mismatchResult.result, 'exception')
    assert.equal(
      sql(
        `select payment_status from public.orders where id='${mismatch.order}';`
      ),
      'processing'
    )
    assert.equal(
      sql(
        `select provider_exception_code from marketplace_private.campus_payment_attempts where id='${mismatch.attempt}';`
      ),
      'binding_mismatch'
    )

    const failed = base('03')
    seed(failed, 'pi_Canceled')
    enqueue('evt_Canceled', 'pi_Canceled', 'payment_intent.canceled')
    claim = claimEvent()
    assert.equal(
      applyEvent(
        failed,
        'pi_Canceled',
        'evt_Canceled',
        claim.lease,
        'canceled',
        0
      ).result,
      'applied'
    )
    assert.equal(
      sql(
        `select payment_status from public.orders where id='${failed.order}';`
      ),
      'failed'
    )
    assert.equal(
      sql(
        `select metadata->>'source' from public.transaction_events where transition_key='${failed.attempt}:payment_failed';`
      ),
      'stripe'
    )

    const race = base('04')
    seed(race, 'pi_Race')
    sql(
      `insert into marketplace_private.order_cancellation_intents values('${race.order}','pending');
       update marketplace_private.campus_payment_attempts set provider_reconcile_after=now()+interval '1 hour'
        where status='processing';
       update marketplace_private.campus_payment_attempts set provider_reconcile_after=now()-interval '1 second'
        where id='${race.attempt}';`
    )
    const raceDueClaim = JSON.parse(
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('claim_due','${platform}');`
      )
        .split('\n')
        .at(-1)
    )
    assert.equal(raceDueClaim.attemptId, race.attempt)
    enqueue('evt_Race', 'pi_Race')
    claim = claimEvent()
    assert.equal(
      applyEvent(race, 'pi_Race', 'evt_Race', claim.lease, 'succeeded').result,
      'exception'
    )
    assert.equal(
      sql(
        `select lifecycle_status||'|'||payment_status from public.orders where id='${race.order}';`
      ),
      'cancelled|paid'
    )
    assert.equal(
      sql(
        `select provider_exception_code from marketplace_private.campus_payment_attempts where id='${race.attempt}';`
      ),
      'paid_after_cancellation_requested'
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_settlement_authorizations where order_id='${race.order}';`
      ),
      '1'
    )
    const dueReplay = JSON.parse(
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('apply_due','${platform}','${
            raceDueClaim.lease
          }','${value(
            race,
            'pi_Race',
            'reconcile:00000000-0000-4000-8000-000000000004',
            'succeeded'
          )}');`
      )
        .split('\n')
        .at(-1)
    )
    assert.equal(dueReplay.result, 'exception')
    assert.equal(dueReplay.exceptionCode, 'paid_after_cancellation_requested')
    assert.equal(
      sql(
        `select provider_exception_code||'|'||provider_evidence_id from marketplace_private.campus_payment_attempts
         where id='${race.attempt}';`
      ),
      'paid_after_cancellation_requested|evt_Race'
    )
    enqueue('evt_RaceReplay', 'pi_Race')
    claim = claimEvent()
    const replay = applyEvent(
      race,
      'pi_Race',
      'evt_RaceReplay',
      claim.lease,
      'succeeded'
    )
    assert.equal(replay.result, 'exception')
    assert.equal(replay.exceptionCode, 'paid_after_cancellation_requested')
    assert.equal(
      sql(
        `select provider_reconcile_state||'|'||provider_exception_code||'|'||provider_evidence_id
         from marketplace_private.campus_payment_attempts where id='${race.attempt}';`
      ),
      'exception|paid_after_cancellation_requested|evt_Race'
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_settlement_authorizations where order_id='${race.order}';`
      ),
      '1'
    )

    const due = base('05')
    seed(due, 'pi_Due')
    const dueClaim = JSON.parse(
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('claim_due','${platform}');`
      )
        .split('\n')
        .at(-1)
    )
    const dueResult = JSON.parse(
      sql(
        claims +
          `select public.marketplace_order_payment_reconciliation('apply_due','${platform}','${
            dueClaim.lease
          }','${value(
            due,
            'pi_Due',
            'reconcile:00000000-0000-4000-8000-000000000001',
            'processing',
            0
          )}');`
      )
        .split('\n')
        .at(-1)
    )
    assert.equal(dueResult.result, 'pending')
    assert.equal(
      sql(
        `select provider_reconcile_lease is null from marketplace_private.campus_payment_attempts where id='${due.attempt}';`
      ),
      't'
    )

    const lease = base('06')
    seed(lease, 'pi_Lease')
    enqueue('evt_Lease', 'pi_Lease', 'payment_intent.processing')
    const expiredClaim = claimEvent()
    sql(
      `update marketplace_private.stripe_webhook_inbox set lease_until=now()-interval '1 second' where event_id='evt_Lease';`
    )
    const recoveredClaim = claimEvent()
    assert.notEqual(recoveredClaim.lease, expiredClaim.lease)
    assert.throws(() =>
      applyEvent(
        lease,
        'pi_Lease',
        'evt_Lease',
        expiredClaim.lease,
        'processing',
        0
      )
    )
    assert.equal(
      applyEvent(
        lease,
        'pi_Lease',
        'evt_Lease',
        recoveredClaim.lease,
        'processing',
        0
      ).result,
      'pending'
    )

    const concurrent = base('07')
    seed(concurrent, 'pi_Concurrent')
    enqueue('evt_Concurrent', 'pi_Concurrent', 'payment_intent.processing')
    const firstWorker = runAsync(
      'psql',
      args,
      `begin;set local application_name='b22_claim_worker';${claims}select public.marketplace_order_payment_reconciliation('claim_event','${platform}');select pg_sleep(2);commit;`
    )
    let lockHeld = false
    for (let index = 0; index < 30; index++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (
        sql(
          `select coalesce(wait_event,'') from pg_stat_activity where application_name='b22_claim_worker';`
        ).includes('PgSleep')
      ) {
        lockHeld = true
        break
      }
    }
    assert(lockHeld, 'first worker must hold the claimed inbox row')
    const secondWorker = sql(
      claims +
        `select public.marketplace_order_payment_reconciliation('claim_event','${platform}') is null;`
    )
      .split('\n')
      .at(-1)
    assert.equal(secondWorker, 't')
    assert((await firstWorker).includes('evt_Concurrent'))

    console.log(
      'PASS B22 isolated PostgreSQL purpose isolation, event dedupe, authoritative apply, mismatch fail-closed, recoverable failure, cancellation race, active reconciliation, grants and immutable event effects'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

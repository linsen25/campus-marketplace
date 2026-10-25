// B24-A/B/C isolated native PostgreSQL test. Loopback only; no Supabase or Stripe.
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
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b24-db-'))
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
    'b24_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'b24_test',
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
      create table marketplace_private.notification_events(
       id uuid primary key default gen_random_uuid(),source_key text not null unique,event_type text not null,
       created_at timestamptz not null default now(),destination jsonb not null);
      create table public.notifications(
       id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null references public.profiles(id),
       domain_event_id uuid not null references marketplace_private.notification_events(id),event_type text not null,
       priority text not null,created_at timestamptz not null,updated_at timestamptz not null,destination jsonb not null,
       unique(recipient_user_id,domain_event_id));
      create function marketplace_private.deliver_notification(uuid,uuid,text) returns void language plpgsql security definer set search_path='' as $$
       declare e marketplace_private.notification_events;begin select * into e from marketplace_private.notification_events where id=$1;
       insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination)
       select $2,e.id,e.event_type,$3,e.created_at,e.created_at,e.destination where exists(select 1 from public.profiles where id=$2)
       on conflict(recipient_user_id,domain_event_id) do nothing;end$$;
      create table marketplace_private.shop_membership_commands(
       owner_id uuid,action text,action_id uuid,input_digest text,proof_key text,input jsonb,result jsonb,recorded_at timestamptz,
       primary key(owner_id,action,action_id));
      create table marketplace_private.shop_suspension_cycles(
       id uuid primary key default gen_random_uuid(),owner_id uuid not null,state text not null default 'open',
       suspended_at timestamptz not null default now(),reopened_at timestamptz);
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
      create table marketplace_private.stripe_bindings(id uuid primary key default gen_random_uuid(),user_id uuid,kind text,platform text,mode text,status text,owner_ref text,instrument_ref text,
       unique(user_id,kind,platform,mode),unique(platform,mode,owner_ref));
      create table marketplace_private.stripe_webhook_inbox(
       platform text not null,mode text not null check(mode='test'),event_id text not null,event_type text not null,account_scope text not null,owner_ref text,
       received_at timestamptz not null default now(),status text not null default 'pending' check(status in('pending','processing','done')),
       lease uuid,lease_until timestamptz,attempts int not null default 0,next_attempt_at timestamptz not null default now(),
       error_code text check(error_code in('reconcile_failed','binding_not_ready')),processed_at timestamptz,
       primary key(platform,mode,account_scope,event_id));
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
      create table marketplace_private.order_protection(
       order_id uuid primary key references public.orders(id),source text,started_at timestamptz,expires_at timestamptz,completed_at timestamptz);
      create table marketplace_private.protection_cases(
       id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),
       buyer_id uuid not null default gen_random_uuid(),command uuid not null default gen_random_uuid(),
       reason text not null default 'ITEM_NOT_RECEIVED',state text not null default 'resolution_required',
       opened_at timestamptz not null default now(),unique(buyer_id,command));
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
    for (const migration of [
      '202610200002_order_payment_intent_start.sql',
      '202610210001_order_payment_reconciliation.sql',
      '202610210002_order_refund_operations.sql',
      '202610210003_order_refund_observations.sql',
      '202610210004_order_refund_event_integration.sql',
      '20261022041410_order_seller_transfer_operations.sql',
      '20261022073253_order_transfer_observations.sql',
      '20261022110000_connected_payout_observations.sql',
      '20261022194401_stripe_dispute_observations.sql',
      '20261022202042_operational_case_foundation.sql',
      '20261023010212_operational_recovery_audit.sql',
      '20261023173802_authoritative_shop_provider_notifications.sql',
    ])
      sql(fs.readFileSync(path.join('supabase/migrations', migration), 'utf8'))

    const buyer = randomUUID()
    const platform = 'acct_TestPlatform'
    const claims = `select set_config('request.jwt.claims','{"sub":"${buyer}","role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false) as ignored \\gset\n`
    const result = (statement) =>
      sql(claims + statement)
        .split('\n')
        .filter(Boolean)
        .at(-1)
    const prepare = (order, selectedPlatform = platform) =>
      JSON.parse(
        result(
          `select public.marketplace_order_transfer_operation('prepare','${order}','${selectedPlatform}',null);`
        )
      )
    const claim = () => {
      const value = result(
        `select public.marketplace_order_transfer_operation('claim_due',null,'${platform}',null);`
      )
      return value ? JSON.parse(value) : null
    }
    const seed = ({
      lifecycle = 'completed',
      paymentMode = 'uu_pay',
      paymentStatus = 'paid',
      payoutStatus = lifecycle === 'completed' ? 'eligible' : 'not_eligible',
      protectionComplete = lifecycle === 'completed',
      protectionCase = false,
      compensation = 0,
      buyerRelease = lifecycle === 'cancelled' ? 10825 - compensation : 0,
      refundState = buyerRelease > 0 ? 'succeeded' : null,
      connectStatus = 'ready',
      connectAccount = null,
      reconcileState = 'applied',
      exceptionCode = null,
    } = {}) => {
      const ids = {
        order: randomUUID(),
        listing: randomUUID(),
        attempt: randomUUID(),
        seller: randomUUID(),
        refundOperation: randomUUID(),
        pi: `pi_${randomUUID().replaceAll('-', '')}`,
      }
      const paidAt = '2026-10-21T12:00:00Z'
      const authorityAt = '2026-10-22T12:00:00Z'
      const providerSellerAccount = `acct_Seller${ids.seller.replaceAll(
        '-',
        ''
      )}`
      const bindingAccount = connectAccount || providerSellerAccount
      sql(`
       insert into public.profiles values('${ids.seller}');
       insert into public.listings values('${ids.listing}','${
        lifecycle === 'completed' ? 'sold' : 'available'
      }',null);
       insert into public.orders(id,request_id,conversation_id,listing_id,buyer_id,seller_id,order_protocol_version,terms_snapshot,lifecycle_status,holds_listing,payment_status,payment_paid_at,
        fulfillment_status,payout_status,reservation_ended_at,cancelled_at)
       values('${ids.order}',gen_random_uuid(),gen_random_uuid(),'${
        ids.listing
      }','${buyer}','${ids.seller}',2,
        '{"terms":{"payment_mode":"${paymentMode}"}}','${lifecycle}',false,'${paymentStatus}',${
        paymentStatus === 'paid' ? `'${paidAt}'` : 'null'
      },
        '${
          lifecycle === 'completed' ? 'fulfilled' : 'awaiting_fulfillment'
        }','${payoutStatus}','${authorityAt}',${
        lifecycle === 'cancelled' ? `'${authorityAt}'` : 'null'
      });
       insert into marketplace_private.v2_order_economics values('${
         ids.order
       }',10000,0,825,10825,0,10000,'item_only_4pct_min100_max1500_v1','${paidAt}');
       insert into marketplace_private.campus_payment_attempts(id,order_id,buyer_id,command,status,started_at,finished_at,provider,provider_mode,provider_platform,provider_purpose,
        provider_operation_id,provider_idempotency_key,provider_customer_ref,provider_instrument_ref,provider_seller_account_ref,provider_amount_cents,provider_currency,
        provider_transfer_group,provider_reference,provider_create_started_at,provider_bound_at,provider_status,provider_observed_at,provider_evidence_id,provider_reconcile_state,provider_exception_code)
       values('${ids.attempt}','${ids.order}','${buyer}',gen_random_uuid(),'${
        paymentStatus === 'paid' ? 'paid' : 'failed'
      }','2026-10-21T11:59:00Z','${paidAt}',
        'stripe','test','${platform}','marketplace_order',gen_random_uuid(),'uu:test:${platform}:order:'||gen_random_uuid(),'cus_Buyer','pm_Card','${providerSellerAccount}',10825,'CAD',
        'uu_order_${ids.order}','${
        ids.pi
      }','2026-10-21T11:58:00Z','2026-10-21T11:58:30Z','succeeded','${paidAt}','evt_Evidence','${reconcileState}',${
        exceptionCode ? `'${exceptionCode}'` : 'null'
      });
      `)
      if (lifecycle === 'completed') {
        sql(
          `insert into marketplace_private.order_protection values('${
            ids.order
          }','handoff','2026-10-21T12:00:00Z','${authorityAt}',${
            protectionComplete ? `'${authorityAt}'` : 'null'
          });`
        )
        if (protectionCase)
          sql(
            `insert into marketplace_private.protection_cases(order_id) values('${ids.order}');`
          )
      } else if (lifecycle === 'cancelled') {
        sql(`insert into marketplace_private.order_cancellation_intents values('${ids.order}','finalized','${authorityAt}');
         insert into marketplace_private.order_settlement_authorizations values('${ids.order}','delivery_compensation',10825,${buyerRelease},${compensation},0,825,0,'${authorityAt}');`)
        if (refundState)
          sql(`insert into marketplace_private.order_refund_operations(order_id,payment_attempt_id,provider,provider_mode,provider_platform,payment_intent_ref,
           amount_cents,currency,operation_id,idempotency_key,refund_ref,state,provider_status)
           values('${ids.order}','${
            ids.attempt
          }','stripe','test','${platform}','${ids.pi}',${buyerRelease},'CAD','${
            ids.refundOperation
          }',
            'uu:test:${platform}:refund:${
            ids.refundOperation
          }','re_TestRefund${ids.order.replaceAll('-', '')}','${refundState}',
            '${refundState === 'succeeded' ? 'succeeded' : 'pending'}');`)
      }
      sql(`insert into marketplace_private.stripe_bindings(user_id,kind,platform,mode,status,owner_ref)
       values('${ids.seller}','payout_account','${platform}','test','${connectStatus}','${bindingAccount}');`)
      ids.sellerAccount = providerSellerAccount
      return ids
    }

    sql(`insert into public.profiles values('${buyer}');`)
    const refundNotice = seed({
      lifecycle: 'cancelled',
      compensation: 1000,
      buyerRelease: 9825,
      refundState: 'reconciling',
    })
    sql(`update marketplace_private.order_refund_operations set state='succeeded',provider_status='succeeded',updated_at=clock_timestamp()
     where order_id='${refundNotice.order}';`)
    assert.equal(
      sql(`select count(*) from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id
       where n.recipient_user_id='${buyer}' and e.source_key='order-refund:${refundNotice.refundOperation}:order_refund_succeeded'
        and n.event_type='order_refund_succeeded' and n.destination->>'orderId'='${refundNotice.order}';`),
      '1'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_order_transfer_operation(text,uuid,text,uuid)','execute') or
       has_function_privilege('authenticated','public.marketplace_order_transfer_operation(text,uuid,text,uuid)','execute');`),
      'f'
    )
    assert.equal(
      sql(`select has_table_privilege('anon','marketplace_private.order_transfer_operations','select') or
       has_table_privilege('authenticated','marketplace_private.order_transfer_operations','select') or
       has_table_privilege('service_role','marketplace_private.order_transfer_operations','select');`),
      'f'
    )
    assert.equal(
      sql(
        `select relrowsecurity from pg_class where oid='marketplace_private.order_transfer_operations'::regclass;`
      ),
      't'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_order_transfer_result(text,uuid,text,uuid,jsonb)','execute') or
       has_function_privilege('authenticated','public.marketplace_order_transfer_result(text,uuid,text,uuid,jsonb)','execute') or
       has_function_privilege('anon','public.marketplace_order_transfer_events(text,text,uuid,jsonb)','execute') or
       has_function_privilege('authenticated','public.marketplace_order_transfer_candidates(text,integer)','execute');`),
      'f'
    )

    const sale = seed()
    const before =
      sql(`select row_to_json(x) from(select o.lifecycle_status,o.payout_status,e.seller_gross_cents
     from public.orders o join marketplace_private.v2_order_economics e on e.order_id=o.id where o.id='${sale.order}') x;`)
    const saleOperation = prepare(sale.order)
    assert.equal(saleOperation.transfer_kind, 'sale_proceeds')
    assert.equal(saleOperation.authority_kind, 'protection_completed')
    assert.equal(saleOperation.amount_cents, 10000)
    assert.equal(saleOperation.destination_account_ref, sale.sellerAccount)
    assert.equal(prepare(sale.order).id, saleOperation.id)
    assert.equal(
      sql(`select row_to_json(x) from(select o.lifecycle_status,o.payout_status,e.seller_gross_cents
     from public.orders o join marketplace_private.v2_order_economics e on e.order_id=o.id where o.id='${sale.order}') x;`),
      before
    )

    assert.throws(() => prepare(seed({ protectionComplete: false }).order))
    assert.throws(() => prepare(seed({ protectionCase: true }).order))
    assert.throws(() => prepare(seed({ paymentMode: 'external' }).order))
    assert.throws(() => prepare(seed({ paymentStatus: 'failed' }).order))
    assert.throws(() =>
      prepare(seed({ connectStatus: 'needs_attention' }).order)
    )
    // B25-A: a strictly attributed Stripe charge dispute creates a sticky
    // operational hold without changing Refund, Transfer or Order facts.
    assert.equal(
      sql(`select has_table_privilege('anon','marketplace_private.stripe_dispute_observations','select') or
       has_table_privilege('authenticated','marketplace_private.stripe_dispute_observations','select') or
       has_table_privilege('service_role','marketplace_private.stripe_dispute_observations','select');`),
      'f'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_stripe_dispute_events(text,text,uuid,jsonb)','execute') or
       has_function_privilege('authenticated','public.marketplace_stripe_dispute_events(text,text,uuid,jsonb)','execute');`),
      'f'
    )
    const disputed = seed()
    const queueDispute = ({
      ids = disputed,
      status = 'needs_response',
      eventType = 'charge.dispute.created',
      amount = '4000',
      metadataOrder = ids.order,
      metadataAttempt = ids.attempt,
      paymentIntentRef = ids.pi,
      balanceAmount = -4000,
    } = {}) => {
      const eventId = `evt_${randomUUID().replaceAll('-', '')}`
      const disputeRef = `du_${ids.order.replaceAll('-', '')}`
      result(`select public.marketplace_stripe_dispute_events('enqueue','${platform}',null,
       '{"id":"${eventId}","providerReference":"${disputeRef}","scope":"${platform}","type":"${eventType}"}'::jsonb);`)
      const eventClaim = JSON.parse(
        result(
          `select public.marketplace_stripe_dispute_events('claim','${platform}',null,'{}'::jsonb);`
        )
      )
      const value = JSON.stringify({
        amount,
        balanceTransactions: [
          {
            amount: balanceAmount,
            id: 'txn_DisputeEvidence',
            reportingCategory: 'dispute',
            status: 'available',
            type: 'adjustment',
          },
        ],
        chargeAmount: '10825',
        chargeRef: `ch_${ids.order.replaceAll('-', '')}`,
        chargeRefunded: '2000',
        currency: 'cad',
        disputeRef,
        eventId,
        eventType,
        evidencePastDue: false,
        evidenceSubmissionCount: 0,
        fundsReinstated: String(Math.max(balanceAmount, 0)),
        fundsWithdrawn: String(Math.max(-balanceAmount, 0)),
        hasEvidence: false,
        metadataAttempt,
        metadataOrder,
        observedAt: new Date().toISOString(),
        paymentIntentRef,
        providerCreatedAt: '2026-10-22T12:00:00.000Z',
        providerStatus: status,
        reason: 'product_not_received',
        responseDueAt: '2026-10-29T12:00:00.000Z',
      }).replaceAll("'", "''")
      return { eventClaim, value }
    }
    const applyDispute = (options) => {
      const { eventClaim, value } = queueDispute(options)
      return JSON.parse(
        result(
          `select public.marketplace_stripe_dispute_events('apply','${platform}','${eventClaim.lease}','${value}'::jsonb);`
        )
      )
    }
    const orderBeforeDispute = sql(
      `select row_to_json(o) from(select lifecycle_status,payment_status,payout_status from public.orders where id='${disputed.order}') o;`
    )
    const disputeResult = applyDispute()
    assert.equal(disputeResult.reconciliation_state, 'attributed')
    assert.equal(disputeResult.blocks_new_financial_operations, true)
    assert.equal(disputeResult.amount_cents, 4000)
    assert.equal(disputeResult.charge_refunded_cents, 2000)
    assert.equal(disputeResult.funds_withdrawn_cents, 4000)
    assert.throws(() => prepare(disputed.order))
    assert.equal(
      sql(
        `select row_to_json(o) from(select lifecycle_status,payment_status,payout_status from public.orders where id='${disputed.order}') o;`
      ),
      orderBeforeDispute
    )

    // Provider won/lost is evidence only; it cannot silently clear the
    // operational hold or decide the internal Protection case.
    const won = applyDispute({
      status: 'won',
      eventType: 'charge.dispute.closed',
      balanceAmount: 4000,
    })
    assert.equal(won.provider_status, 'won')
    assert.equal(won.blocks_new_financial_operations, true)
    assert.throws(() => prepare(disputed.order))
    const replayedWon = applyDispute({
      status: 'won',
      eventType: 'charge.dispute.updated',
      balanceAmount: 4000,
    })
    assert.equal(replayedWon.provider_status, 'won')
    assert.equal(replayedWon.blocks_new_financial_operations, true)
    assert.equal(
      applyDispute({
        status: 'lost',
        eventType: 'charge.dispute.closed',
      }).result,
      'mismatch'
    )
    assert.equal(
      sql(
        `select provider_status from marketplace_private.stripe_dispute_observations where order_id='${disputed.order}';`
      ),
      'won'
    )

    const unknown = seed()
    const unattributed = applyDispute({
      ids: unknown,
      paymentIntentRef: 'pi_UnrecognizedPayment',
      metadataOrder: '',
      metadataAttempt: '',
    })
    assert.equal(unattributed.reconciliation_state, 'unattributed')
    assert.equal(unattributed.order_id, null)
    assert.equal(unattributed.blocks_new_financial_operations, false)

    const restarted = seed()
    const crashedClaim = queueDispute({ ids: restarted })
    sql(`update marketplace_private.stripe_webhook_inbox set lease_until=now()-interval '1 second'
     where purpose='marketplace_dispute' and event_id='${crashedClaim.eventClaim.eventId}';`)
    const recoveredClaim = JSON.parse(
      result(
        `select public.marketplace_stripe_dispute_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    assert.equal(recoveredClaim.eventId, crashedClaim.eventClaim.eventId)
    assert.notEqual(recoveredClaim.lease, crashedClaim.eventClaim.lease)
    assert.throws(() =>
      result(
        `select public.marketplace_stripe_dispute_events('apply','${platform}','${crashedClaim.eventClaim.lease}','${crashedClaim.value}'::jsonb);`
      )
    )
    assert.equal(
      JSON.parse(
        result(
          `select public.marketplace_stripe_dispute_events('apply','${platform}','${recoveredClaim.lease}','${crashedClaim.value}'::jsonb);`
        )
      ).reconciliation_state,
      'attributed'
    )

    // The provider dispute may race Transfer preparation. Either prepare sees
    // the hold and fails, or it commits first and the later observation fences
    // claim_due. Both sessions must finish without a deadlock and no lease may
    // cross the newly persisted hold.
    const raced = seed()
    const racedDispute = queueDispute({ ids: raced })
    const raceBounded = `set lock_timeout='5s';set statement_timeout='10s';${claims}`
    const raceResults = await Promise.allSettled([
      runAsync(
        'psql',
        args,
        `${raceBounded}select public.marketplace_stripe_dispute_events('apply','${platform}','${racedDispute.eventClaim.lease}','${racedDispute.value}'::jsonb);`
      ),
      runAsync(
        'psql',
        args,
        `${raceBounded}select public.marketplace_order_transfer_operation('prepare','${raced.order}','${platform}',null);`
      ),
    ])
    assert(
      raceResults.every(
        (entry) =>
          entry.status === 'fulfilled' ||
          !/deadlock detected/i.test(entry.reason.message)
      )
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.stripe_dispute_observations where order_id='${raced.order}' and blocks_new_financial_operations;`
      ),
      '1'
    )
    if (
      sql(
        `select count(*) from marketplace_private.order_transfer_operations where order_id='${raced.order}';`
      ) === '1'
    ) {
      sql(`update marketplace_private.order_transfer_operations set next_reconcile_at=now()+interval '1 hour';
       update marketplace_private.order_transfer_operations set next_reconcile_at=now()-interval '1 second'
        where order_id='${raced.order}';`)
      assert.throws(() => claim(), /Stripe Dispute blocks Seller Transfer/)
      assert.equal(
        sql(
          `select lease is null from marketplace_private.order_transfer_operations where order_id='${raced.order}';`
        ),
        't'
      )
    }

    assert.equal(
      sql(
        `select count(*) from marketplace_private.protection_cases where order_id='${disputed.order}';`
      ),
      '0'
    )
    assert.throws(() =>
      prepare(seed({ connectAccount: 'acct_OtherSeller' }).order)
    )

    const compensation = seed({
      lifecycle: 'cancelled',
      compensation: 2000,
      buyerRelease: 8825,
    })
    const compensationOperation = prepare(compensation.order)
    assert.equal(compensationOperation.transfer_kind, 'delivery_compensation')
    assert.equal(compensationOperation.amount_cents, 2000)
    assert.equal(
      Number(
        sql(
          `select amount_cents from marketplace_private.order_refund_operations where order_id='${compensation.order}';`
        )
      ) + compensationOperation.amount_cents,
      10825
    )
    assert.throws(() =>
      prepare(
        seed({
          lifecycle: 'cancelled',
          compensation: 2000,
          buyerRelease: 8825,
          refundState: 'reconciling',
        }).order
      )
    )
    const allCompensation = seed({
      lifecycle: 'cancelled',
      compensation: 10825,
      buyerRelease: 0,
      refundState: null,
    })
    assert.equal(prepare(allCompensation.order).amount_cents, 10825)
    assert.throws(() =>
      prepare(
        seed({
          lifecycle: 'cancelled',
          compensation: 0,
          buyerRelease: 10825,
        }).order
      )
    )

    sql(`update marketplace_private.order_transfer_operations set next_reconcile_at=now()+interval '1 hour';
     update marketplace_private.order_transfer_operations set next_reconcile_at=now()-interval '1 second' where order_id='${sale.order}';`)
    const claimed = claim()
    assert.equal(claimed.order_id, sale.order)
    assert.equal(claimed.claim_kind, 'execute')
    assert.equal(claim(), null)
    const oldToken = claimed.lease
    sql(
      `update marketplace_private.order_transfer_operations set lease_until=now()-interval '1 second',next_reconcile_at=now()-interval '1 second' where id='${claimed.id}';`
    )
    const reclaimed = claim()
    assert.equal(reclaimed.claim_kind, 'reconcile')
    assert.notEqual(reclaimed.lease, oldToken)
    assert.throws(() =>
      result(
        `select public.marketplace_order_transfer_operation('read','${sale.order}','${platform}','${oldToken}');`
      )
    )
    const transferRef = `tr_Test${sale.order.replaceAll('-', '')}`
    const sourceCharge = `ch_Test${sale.order.replaceAll('-', '')}`
    const transferObservation = JSON.stringify({
      amount: String(reclaimed.amount_cents),
      amountReversed: '0',
      currency: 'cad',
      destination: reclaimed.destination_account_ref,
      evidenceId: 'reconcile:11111111-1111-4111-8111-111111111111',
      livemode: false,
      metadataAttempt: reclaimed.payment_attempt_id,
      metadataEnvironment: 'staging',
      metadataKind: 'marketplace_order_transfer',
      metadataOperation: reclaimed.operation_id,
      metadataOrder: reclaimed.order_id,
      operationId: reclaimed.operation_id,
      paymentIntentRef: reclaimed.payment_intent_ref,
      providerMode: reclaimed.provider_mode,
      providerPlatform: reclaimed.provider_platform,
      reversed: false,
      sourceChargeRef: sourceCharge,
      transferGroup: reclaimed.transfer_group,
      transferRef,
    }).replaceAll("'", "''")
    const applied = JSON.parse(
      result(
        `select public.marketplace_order_transfer_result('apply','${sale.order}','${platform}','${reclaimed.lease}','${transferObservation}'::jsonb);`
      )
    )
    assert.equal(applied.state, 'succeeded')
    assert.equal(applied.provider_status, 'succeeded')
    assert.equal(applied.transfer_ref, transferRef)
    assert.equal(applied.source_charge_ref, sourceCharge)
    assert.equal(
      sql(`select count(*) from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id
       where n.recipient_user_id='${sale.seller}' and e.source_key='order-transfer:${applied.operation_id}:seller_transfer_succeeded'
        and n.event_type='seller_transfer_succeeded' and n.destination->>'orderId'='${sale.order}';`),
      '1'
    )
    assert.equal(
      sql(`select payout_status from public.orders where id='${sale.order}';`),
      'eligible'
    )
    assert.throws(() =>
      sql(
        `update marketplace_private.order_transfer_operations set transfer_ref='tr_Other' where order_id='${sale.order}';`
      )
    )

    const reversedEvent = randomUUID()
    sql(`${claims}select public.marketplace_order_transfer_events('enqueue','${platform}',null,
     '{"id":"evt_${reversedEvent.replaceAll(
       '-',
       ''
     )}","type":"transfer.reversed","scope":"${platform}","providerReference":"${transferRef}"}'::jsonb);`)
    const eventClaim = JSON.parse(
      result(
        `select public.marketplace_order_transfer_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    const eventDone = JSON.stringify({
      amount: String(applied.amount_cents),
      currency: 'cad',
      destination: applied.destination_account_ref,
      eventId: eventClaim.eventId,
      metadataOperation: applied.operation_id,
      metadataOrder: applied.order_id,
      transferRef,
    }).replaceAll("'", "''")
    result(
      `select public.marketplace_order_transfer_events('done','${platform}','${eventClaim.lease}','${eventDone}'::jsonb);`
    )
    assert.equal(
      sql(
        `select state from marketplace_private.order_transfer_operations where order_id='${sale.order}';`
      ),
      'reconciling'
    )
    const reversalClaim = claim()
    assert.equal(reversalClaim.order_id, sale.order)
    assert.equal(reversalClaim.claim_kind, 'reconcile')
    const reversalObservation = JSON.stringify({
      ...JSON.parse(transferObservation.replaceAll("''", "'")),
      amountReversed: String(reversalClaim.amount_cents),
      evidenceId: 'reconcile:22222222-2222-4222-8222-222222222222',
      reversed: true,
    }).replaceAll("'", "''")
    const reversedResult = JSON.parse(
      result(
        `select public.marketplace_order_transfer_result('apply','${sale.order}','${platform}','${reversalClaim.lease}','${reversalObservation}'::jsonb);`
      )
    )
    assert.equal(reversedResult.state, 'exception')
    assert.equal(reversedResult.provider_status, 'reversed')
    assert.equal(reversedResult.last_error_code, 'terminal_conflict')
    assert.equal(
      sql(`select count(*) from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id
       where n.recipient_user_id='${sale.seller}' and e.source_key='order-transfer:${applied.operation_id}:seller_transfer_reversed'
        and n.event_type='seller_transfer_reversed';`),
      '1'
    )

    const concurrent = seed()
    const bounded = `set lock_timeout='5s';set statement_timeout='10s';${claims}`
    const calls = await Promise.all([
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_order_transfer_operation('prepare','${concurrent.order}','${platform}',null);`
      ),
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_order_transfer_operation('prepare','${concurrent.order}','${platform}',null);`
      ),
    ])
    assert(calls.every((output) => !/deadlock detected/i.test(output)))
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_transfer_operations where order_id='${concurrent.order}';`
      ),
      '1'
    )
    sql(`update marketplace_private.order_transfer_operations set next_reconcile_at=now()+interval '1 hour';
     update marketplace_private.order_transfer_operations set next_reconcile_at=now()-interval '1 second'
      where order_id='${concurrent.order}';`)
    const competingClaims = await Promise.all([
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_order_transfer_operation('claim_due',null,'${platform}',null);`
      ),
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_order_transfer_operation('claim_due',null,'${platform}',null);`
      ),
    ])
    assert.equal(
      competingClaims.filter((output) => output.includes(concurrent.order))
        .length,
      1
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.order_transfer_operations where state='succeeded';`
      ),
      '0'
    )

    const existingTransferState = sql(
      `select state from marketplace_private.order_transfer_operations where order_id='${sale.order}';`
    )
    const lateDispute = applyDispute({ ids: sale })
    assert.equal(
      lateDispute.transfer_state_at_observation,
      existingTransferState
    )
    assert.equal(
      sql(
        `select state from marketplace_private.order_transfer_operations where order_id='${sale.order}';`
      ),
      existingTransferState
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.protection_cases where order_id in('${disputed.order}','${sale.order}');`
      ),
      '0'
    )

    // B24-C observes account-level bank Payout facts without assigning an
    // Order or mutating a successful Transfer.
    assert.equal(
      sql(`select has_table_privilege('anon','marketplace_private.connected_payout_observations','select') or
       has_table_privilege('authenticated','marketplace_private.connected_payout_observations','select') or
       has_table_privilege('service_role','marketplace_private.connected_payout_observations','select');`),
      'f'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_connected_payout_events(text,text,uuid,jsonb)','execute') or
       has_function_privilege('authenticated','public.marketplace_connected_payout_events(text,text,uuid,jsonb)','execute');`),
      'f'
    )
    assert.equal(
      sql(
        `select relrowsecurity from pg_class where oid='marketplace_private.connected_payout_observations'::regclass;`
      ),
      't'
    )
    const transferStateBeforePayout = sql(
      `select state from marketplace_private.order_transfer_operations where order_id='${sale.order}';`
    )
    const payoutRef = `po_Test${randomUUID().replaceAll('-', '')}`
    const payoutAccount = 'acct_ConnectedPayoutSeller'
    const payoutOwner = randomUUID()
    sql(`insert into public.profiles values('${payoutOwner}');
     insert into marketplace_private.stripe_bindings(user_id,kind,platform,mode,status,owner_ref)
     values('${payoutOwner}','payout_account','${platform}','test','ready','${payoutAccount}');`)
    const payoutObservation = ({
      connectedAccount = payoutAccount,
      amount = '14200',
      eventId,
      eventType,
      status,
      reconciliationStatus = 'in_progress',
    }) =>
      JSON.stringify({
        amount,
        arrivalAt: '2026-10-24T12:00:00.000Z',
        attributionStatus: 'unattributed',
        automatic: true,
        balanceTransactionRef: 'txn_PayoutDebit',
        connectedAccount,
        currency: 'cad',
        eventId,
        eventType,
        failureBalanceTransactionRef:
          status === 'failed' ? 'txn_PayoutFailure' : '',
        failureCode: status === 'failed' ? 'could_not_process' : '',
        method: 'standard',
        observedAt: new Date().toISOString(),
        payoutRef,
        providerCreatedAt: '2026-10-22T12:00:00.000Z',
        providerStatus: status,
        reconciliationStatus,
      }).replaceAll("'", "''")
    const applyPayout = (
      eventType,
      status,
      reconciliationStatus,
      connectedAccount = payoutAccount,
      amount = '14200'
    ) => {
      const eventId = `evt_${randomUUID().replaceAll('-', '')}`
      result(`select public.marketplace_connected_payout_events('enqueue','${platform}',null,
       '{"id":"${eventId}","providerReference":"${payoutRef}","scope":"${connectedAccount}","type":"${eventType}"}'::jsonb);`)
      const eventClaim = JSON.parse(
        result(
          `select public.marketplace_connected_payout_events('claim','${platform}',null,'{}'::jsonb);`
        )
      )
      return JSON.parse(
        result(
          `select public.marketplace_connected_payout_events('apply','${platform}','${
            eventClaim.lease
          }',
           '${payoutObservation({
             eventId,
             eventType,
             status,
             reconciliationStatus,
             connectedAccount,
             amount,
           })}'::jsonb);`
        )
      )
    }
    assert.equal(
      applyPayout('payout.created', 'pending').provider_status,
      'pending'
    )
    assert.equal(
      applyPayout('payout.updated', 'in_transit').provider_status,
      'in_transit'
    )
    assert.equal(
      applyPayout('payout.paid', 'paid', 'completed').provider_status,
      'paid'
    )
    assert.equal(
      applyPayout('payout.failed', 'failed', 'completed').provider_status,
      'failed'
    )
    assert.equal(
      sql(`select count(*) from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id
       where n.recipient_user_id='${payoutOwner}' and e.source_key like 'connected-payout:${platform}:test:${payoutRef}:%'
        and n.event_type in('connected_bank_payout_paid','connected_bank_payout_failed')
        and n.destination=jsonb_build_object('section','settings','panel','payments-payouts');`),
      '2'
    )
    assert.equal(
      sql(`select count(*) from marketplace_private.notification_events
       where source_key like 'connected-payout:${platform}:test:${payoutRef}:%';`),
      '2'
    )
    assert.equal(
      sql(`select attribution_status from marketplace_private.connected_payout_observations
       where payout_ref='${payoutRef}';`),
      'unattributed'
    )
    assert.equal(
      sql(`select count(*) from information_schema.columns where table_schema='marketplace_private'
       and table_name='connected_payout_observations' and column_name in('order_id','transfer_id');`),
      '0'
    )
    assert.equal(
      sql(
        `select state from marketplace_private.order_transfer_operations where order_id='${sale.order}';`
      ),
      transferStateBeforePayout
    )
    // A stale earlier state and an account conflict are recorded without
    // overwriting the trusted paid->failed result.
    assert.equal(
      applyPayout('payout.updated', 'paid', 'completed').result,
      'mismatch'
    )
    assert.equal(
      applyPayout(
        'payout.updated',
        'failed',
        'completed',
        'acct_OtherConnectedSeller'
      ).result,
      'mismatch'
    )
    assert.equal(
      applyPayout(
        'payout.updated',
        'failed',
        'completed',
        payoutAccount,
        '14201'
      ).result,
      'mismatch'
    )
    assert.equal(
      sql(`select provider_status from marketplace_private.connected_payout_observations
       where payout_ref='${payoutRef}';`),
      'failed'
    )
    assert(
      Number(
        sql(
          `select count(*) from marketplace_private.order_transfer_operations;`
        )
      ) > 1
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.connected_payout_observations where payout_ref='${payoutRef}';`
      ),
      '1'
    )

    const leaseEvent = `evt_${randomUUID().replaceAll('-', '')}`
    result(`select public.marketplace_connected_payout_events('enqueue','${platform}',null,
     '{"id":"${leaseEvent}","providerReference":"po_LeaseRecovery","scope":"${payoutAccount}","type":"payout.updated"}'::jsonb);`)
    const firstLease = JSON.parse(
      result(
        `select public.marketplace_connected_payout_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    sql(`update marketplace_private.stripe_webhook_inbox set lease_until=now()-interval '1 second',status='pending',next_attempt_at=now()
     where purpose='connected_payout' and event_id='${leaseEvent}';`)
    const secondLease = JSON.parse(
      result(
        `select public.marketplace_connected_payout_events('claim','${platform}',null,'{}'::jsonb);`
      )
    )
    assert.notEqual(firstLease.lease, secondLease.lease)
    assert.throws(() =>
      result(
        `select public.marketplace_connected_payout_events('retry','${platform}','${firstLease.lease}',
         '{"eventId":"${leaseEvent}"}'::jsonb);`
      )
    )

    // B25-B builds a private, idempotent case index without granting human
    // review or financial-transition authority.
    assert.equal(
      sql(`select has_table_privilege('anon','marketplace_private.operational_cases','select') or
       has_table_privilege('authenticated','marketplace_private.operational_cases','select') or
       has_table_privilege('service_role','marketplace_private.operational_cases','select') or
       has_table_privilege('anon','marketplace_private.operational_case_audit','select') or
       has_table_privilege('authenticated','marketplace_private.operational_case_evidence_refs','select');`),
      'f'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_operational_cases(text,uuid,text,uuid,integer,text,uuid)','execute') or
       has_function_privilege('authenticated','public.marketplace_operational_cases(text,uuid,text,uuid,integer,text,uuid)','execute');`),
      'f'
    )
    assert.equal(
      sql(`select bool_and(relrowsecurity) from pg_class where oid in(
       'marketplace_private.operational_cases'::regclass,
       'marketplace_private.operational_case_evidence_refs'::regclass,
       'marketplace_private.operational_case_audit'::regclass);`),
      't'
    )
    const disputedCase = sql(
      `select id from marketplace_private.operational_cases where source_kind='stripe_dispute'
       and order_id='${disputed.order}';`
    )
    assert.match(disputedCase, /^[0-9a-f-]{36}$/)
    const disputedSource = sql(
      `select id from marketplace_private.stripe_dispute_observations where order_id='${disputed.order}';`
    )
    const auditBeforeSync = sql(
      `select count(*) from marketplace_private.operational_case_audit where case_id='${disputedCase}';`
    )
    const repeatedSync = await Promise.all([
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_operational_cases('sync',null,'stripe_dispute','${disputedSource}',null,null,null);`
      ),
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_operational_cases('sync',null,'stripe_dispute','${disputedSource}',null,null,null);`
      ),
    ])
    assert(repeatedSync.every((output) => output.includes(disputedCase)))
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_cases where source_kind='stripe_dispute' and source_id='${disputedSource}';`
      ),
      '1'
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_case_audit where case_id='${disputedCase}';`
      ),
      auditBeforeSync
    )

    const combined = seed({ protectionCase: true })
    applyDispute({ ids: combined })
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_cases where order_id='${combined.order}'
         and source_kind in('uu_protection','stripe_dispute');`
      ),
      '2'
    )
    assert.equal(
      sql(
        `select string_agg(source_kind||':'||review_status,',' order by source_kind)
         from marketplace_private.operational_cases where order_id='${combined.order}';`
      ),
      'stripe_dispute:open,uu_protection:open'
    )
    const combinedCase = sql(
      `select id from marketplace_private.operational_cases where order_id='${combined.order}' and source_kind='stripe_dispute';`
    )
    const combinedVersion = Number(
      sql(
        `select version from marketplace_private.operational_cases where id='${combinedCase}';`
      )
    )
    assert.throws(() =>
      result(
        `select public.marketplace_operational_cases('review','${combinedCase}',null,null,${
          combinedVersion + 1
        },'resolved','${buyer}');`
      )
    )
    assert.throws(() =>
      result(
        `select public.marketplace_operational_cases('review','${combinedCase}',null,null,${combinedVersion},'resolved','${buyer}');`
      )
    )
    assert.equal(
      sql(
        `select review_status||':'||hold_projection||':'||release_projection from marketplace_private.operational_cases where id='${combinedCase}';`
      ),
      'open:active:blocked'
    )
    assert.throws(() =>
      sql(
        `update marketplace_private.operational_cases set review_status='resolved',version=version+1 where id='${combinedCase}';`
      )
    )
    assert.throws(() =>
      sql(
        `set role authenticated;
         select set_config('request.jwt.claims','{"sub":"${buyer}","role":"authenticated","isAdmin":true}',false);
         select public.marketplace_operational_cases('read','${combinedCase}',null,null,null,null,null);`
      )
    )
    assert.throws(() =>
      sql(
        `update marketplace_private.operational_case_audit set action_result='denied' where case_id='${combinedCase}';`
      )
    )
    assert.throws(() =>
      sql(
        `delete from marketplace_private.operational_case_evidence_refs where case_id='${combinedCase}';`
      )
    )
    const privateRead = JSON.parse(
      result(
        `select public.marketplace_operational_cases('read','${combinedCase}',null,null,null,null,null);`
      )
    )
    assert.equal(privateRead.review_status, 'open')
    assert(
      privateRead.evidence.some(
        (entry) =>
          entry.kind === 'order' && entry.referenceId === combined.order
      )
    )
    assert.equal(
      sql(`select count(*) from information_schema.columns where table_schema='marketplace_private'
       and table_name in('operational_cases','operational_case_evidence_refs','operational_case_audit')
       and column_name ~ '(message|address|payload|card|bank)';`),
      '0'
    )

    const paymentException = seed({
      reconcileState: 'exception',
      exceptionCode: 'terminal_conflict',
    })
    const refundException = seed({
      lifecycle: 'cancelled',
      refundState: 'exception',
    })
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_cases where
         (source_kind='payment_exception' and payment_attempt_id='${paymentException.attempt}')
         or(source_kind='refund_exception' and order_id='${refundException.order}')
         or(source_kind='transfer_exception' and order_id='${sale.order}')
         or(source_kind='payout_exception' and provider_object_ref='${payoutRef}');`
      ),
      '4'
    )
    assert.equal(
      sql(
        `select count(distinct source_kind) from marketplace_private.operational_cases where source_kind in(
         'payment_exception','refund_exception','transfer_exception','payout_exception');`
      ),
      '4'
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_cases where source_kind='stripe_dispute'
         and order_id is null and payment_attempt_id is null;`
      ),
      '1'
    )
    const refundExceptionCase = sql(
      `select id from marketplace_private.operational_cases where source_kind='refund_exception'
       and order_id='${refundException.order}';`
    )
    const refundCaseVersion = Number(
      sql(
        `select version from marketplace_private.operational_cases where id='${refundExceptionCase}';`
      )
    )
    sql(`update marketplace_private.order_refund_operations set
      state='succeeded',provider_status='succeeded',last_error_code=null,updated_at=clock_timestamp()
      where order_id='${refundException.order}';`)
    assert.equal(
      sql(
        `select review_status||':'||hold_projection||':'||release_projection||':'||source_status
         from marketplace_private.operational_cases where id='${refundExceptionCase}';`
      ),
      'open:unknown:existing_rules_only:succeeded:provider_state'
    )
    assert.equal(
      Number(
        sql(
          `select version from marketplace_private.operational_cases where id='${refundExceptionCase}';`
        )
      ),
      refundCaseVersion + 1
    )

    const stalePayment = seed({ paymentStatus: 'failed' })
    sql(`update marketplace_private.campus_payment_attempts set
      status='processing',finished_at=null,provider_reference=null,provider_bound_at=null,
      provider_status=null,provider_observed_at=null,provider_evidence_id=null,
      provider_reconcile_state='pending',provider_exception_code=null,
      provider_create_started_at=clock_timestamp()-interval '21 hours'
      where id='${stalePayment.attempt}';`)
    assert.equal(
      sql(
        `select source_status||':'||hold_projection||':'||release_projection
         from marketplace_private.operational_cases where source_kind='payment_exception'
          and source_id='${stalePayment.attempt}';`
      ),
      'recovery_exhausted:unbound:active:blocked'
    )

    // B25-C adds a global worker fence and append-only run audit without
    // creating a new financial worker or changing any source operation.
    assert.equal(
      sql(`select has_table_privilege('anon','marketplace_private.operational_recovery_runs','select') or
       has_table_privilege('authenticated','marketplace_private.operational_recovery_runs','select') or
       has_table_privilege('service_role','marketplace_private.operational_recovery_runs','select') or
       has_table_privilege('anon','marketplace_private.operational_provider_event_exceptions','select') or
       has_table_privilege('authenticated','marketplace_private.operational_provider_event_exceptions','select');`),
      'f'
    )
    assert.equal(
      sql(`select has_function_privilege('anon','public.marketplace_operational_recovery(text,text,uuid,jsonb)','execute') or
       has_function_privilege('authenticated','public.marketplace_operational_recovery(text,text,uuid,jsonb)','execute');`),
      'f'
    )
    assert.equal(
      sql(
        `select relrowsecurity from pg_class where oid='marketplace_private.operational_recovery_runs'::regclass;`
      ),
      't'
    )
    const starts = await Promise.all([
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_operational_recovery('start','${platform}',null,'{}'::jsonb);`
      ),
      runAsync(
        'psql',
        args,
        `${bounded}select public.marketplace_operational_recovery('start','${platform}',null,'{}'::jsonb);`
      ),
    ])
    const parsedStarts = starts.map((value) =>
      JSON.parse(value.trim().split(/\r?\n/).at(-1))
    )
    assert.equal(parsedStarts.filter((value) => value.acquired).length, 1)
    assert.equal(parsedStarts.filter((value) => !value.acquired).length, 1)
    const activeRun = parsedStarts.find((value) => value.acquired)
    assert.match(activeRun.runId, /^[0-9a-f-]{36}$/)
    assert.match(activeRun.token, /^[0-9a-f-]{36}$/)
    assert.throws(() =>
      result(
        `select public.marketplace_operational_recovery('finish','${platform}','${randomUUID()}',
         '{"status":"completed","steps":{},"errors":[]}'::jsonb);`
      )
    )
    const exhaustedEvent = `evt_Exhausted${randomUUID().replaceAll('-', '')}`
    const exhaustedDispute = `du_Exhausted${randomUUID().replaceAll('-', '')}`
    sql(`insert into marketplace_private.stripe_webhook_inbox(
      platform,mode,event_id,event_type,account_scope,purpose,provider_ref,status,attempts,next_attempt_at,error_code)
      values('${platform}','test','${exhaustedEvent}','charge.dispute.updated','${platform}',
       'marketplace_dispute','${exhaustedDispute}','pending',10,clock_timestamp()-interval '1 minute','reconcile_failed');`)
    const casesBeforeSweep = sql(
      `select count(*) from marketplace_private.operational_cases;`
    )
    const sweep = JSON.parse(
      result(
        `select public.marketplace_operational_recovery('sweep','${platform}','${activeRun.token}',
         '{"limit":20}'::jsonb);`
      )
    )
    assert(sweep.synced > 0 && sweep.synced <= 20)
    assert.equal(sweep.captured, 1)
    assert.equal(
      sql(`select count(*) from marketplace_private.operational_cases;`),
      String(Number(casesBeforeSweep) + 1)
    )
    assert.equal(
      sql(
        `select status||':'||error_code from marketplace_private.stripe_webhook_inbox
         where platform='${platform}' and account_scope='${platform}' and event_id='${exhaustedEvent}';`
      ),
      'done:retry_exhausted'
    )
    assert.equal(
      sql(
        `select c.source_kind||':'||(c.order_id is null)::text from marketplace_private.operational_cases c
         join marketplace_private.operational_provider_event_exceptions x on x.id=c.source_id
         where x.event_id='${exhaustedEvent}';`
      ),
      'provider_event_exception:true'
    )
    const repeatedSweep = JSON.parse(
      result(
        `select public.marketplace_operational_recovery('sweep','${platform}','${activeRun.token}',
         '{"limit":20}'::jsonb);`
      )
    )
    assert.equal(repeatedSweep.captured, 0)
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_provider_event_exceptions where event_id='${exhaustedEvent}';`
      ),
      '1'
    )
    const summary = JSON.parse(
      result(
        `select public.marketplace_operational_recovery('summary','${platform}',null,'{}'::jsonb);`
      )
    )
    assert(summary.unresolvedCases >= 1)
    assert(summary.manualReviewCases >= 1)
    assert(summary.blockedOrders >= 1)
    result(
      `select public.marketplace_operational_recovery('finish','${platform}','${activeRun.token}',
       '{"status":"completed","steps":{"caseSweep":{"synced":1}},"errors":[]}'::jsonb);`
    )
    assert.throws(() =>
      sql(
        `update marketplace_private.operational_recovery_runs set status='degraded' where id='${activeRun.runId}';`
      )
    )
    assert.throws(() =>
      sql(
        `delete from marketplace_private.operational_recovery_runs where id='${activeRun.runId}';`
      )
    )

    const expiring = JSON.parse(
      result(
        `select public.marketplace_operational_recovery('start','${platform}',null,'{}'::jsonb);`
      )
    )
    sql(`update marketplace_private.operational_recovery_runs set
      lease_until=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()
      where id='${expiring.runId}';`)
    const replacement = JSON.parse(
      result(
        `select public.marketplace_operational_recovery('start','${platform}',null,'{}'::jsonb);`
      )
    )
    assert.equal(replacement.acquired, true)
    assert.equal(
      sql(
        `select status||':'||error_codes[1] from marketplace_private.operational_recovery_runs where id='${expiring.runId}';`
      ),
      'crashed:lease_expired'
    )
    assert.throws(() =>
      result(
        `select public.marketplace_operational_recovery('finish','${platform}','${expiring.token}',
         '{"status":"completed","steps":{},"errors":[]}'::jsonb);`
      )
    )
    result(
      `select public.marketplace_operational_recovery('finish','${platform}','${replacement.token}',
       '{"status":"degraded","steps":{},"errors":["case_sweep_failed"]}'::jsonb);`
    )
    assert.equal(
      sql(
        `select count(*) from marketplace_private.operational_recovery_runs where provider_platform='${platform}' and status='running';`
      ),
      '0'
    )
    console.log(
      'PASS B24-A/B/C and B25-A/B/C isolated PostgreSQL authority, financial evidence separation, dispute holds, operational recovery fencing, ACL/RLS, immutable audit and concurrency'
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

-- B25-A: trusted Stripe payment-dispute evidence and Transfer hold foundation.
-- No dispute response, refund, reversal, transfer or liability decision is made here.
begin;

create table marketplace_private.stripe_dispute_observations (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 dispute_ref text not null check(dispute_ref ~ '^du_[A-Za-z0-9]+$'),
 charge_ref text not null check(charge_ref ~ '^ch_[A-Za-z0-9]+$'),
 payment_intent_ref text not null check(payment_intent_ref ~ '^pi_[A-Za-z0-9]+$'),
 payment_attempt_id uuid references marketplace_private.campus_payment_attempts(id) on delete restrict,
 order_id uuid references public.orders(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 1 and 99999999),
 charge_amount_cents bigint not null check(charge_amount_cents between 1 and 99999999),
 charge_refunded_cents bigint not null check(charge_refunded_cents between 0 and charge_amount_cents),
 currency text not null check(currency='CAD'),
 reason text not null check(length(reason) between 1 and 80 and reason ~ '^[a-z0-9_]+$'),
 provider_status text not null check(provider_status in(
  'warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
 response_due_at timestamptz,
 has_evidence boolean not null,
 evidence_past_due boolean not null,
 evidence_submission_count integer not null check(evidence_submission_count between 0 and 1000),
 balance_transactions jsonb not null check(jsonb_typeof(balance_transactions)='array' and jsonb_array_length(balance_transactions)<=4),
 funds_withdrawn_cents bigint not null check(funds_withdrawn_cents>=0),
 funds_reinstated_cents bigint not null check(funds_reinstated_cents>=0),
 reconciliation_state text not null check(reconciliation_state in('attributed','unattributed','conflict')),
 blocks_new_financial_operations boolean not null,
 requires_manual_review boolean not null default true check(requires_manual_review),
 retry_safe boolean not null,
 transfer_state_at_observation text,
 transfer_ref_at_observation text check(transfer_ref_at_observation is null or transfer_ref_at_observation ~ '^tr_[A-Za-z0-9]+$'),
 transfer_amount_cents bigint check(transfer_amount_cents is null or transfer_amount_cents>0),
 transfer_reversed_cents bigint check(transfer_reversed_cents is null or transfer_reversed_cents>=0),
 provider_created_at timestamptz not null,
 provider_observed_at timestamptz not null,
 last_event_id text not null check(last_event_id ~ '^evt_[A-Za-z0-9]+$'),
 last_event_type text not null check(last_event_type in(
  'charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
  'charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(provider_platform,provider_mode,dispute_ref),
 check((payment_attempt_id is null)=(order_id is null)),
 check((order_id is not null) or not blocks_new_financial_operations),
 check(updated_at>=created_at)
);
alter table marketplace_private.stripe_dispute_observations enable row level security;
revoke all on marketplace_private.stripe_dispute_observations from public,anon,authenticated,service_role;
create index stripe_dispute_order_hold_idx on marketplace_private.stripe_dispute_observations(order_id)
 where blocks_new_financial_operations;

create function marketplace_private.protect_stripe_dispute_observation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['provider_status','response_due_at','has_evidence','evidence_past_due','evidence_submission_count',
   'balance_transactions','funds_withdrawn_cents','funds_reinstated_cents','blocks_new_financial_operations',
   'requires_manual_review','retry_safe','transfer_state_at_observation','transfer_ref_at_observation',
   'transfer_amount_cents','transfer_reversed_cents','provider_observed_at','last_event_id','last_event_type','updated_at'])
   is distinct from
  (to_jsonb(old)-array['provider_status','response_due_at','has_evidence','evidence_past_due','evidence_submission_count',
   'balance_transactions','funds_withdrawn_cents','funds_reinstated_cents','blocks_new_financial_operations',
   'requires_manual_review','retry_safe','transfer_state_at_observation','transfer_ref_at_observation',
   'transfer_amount_cents','transfer_reversed_cents','provider_observed_at','last_event_id','last_event_type','updated_at']) then
  raise exception 'Stripe Dispute binding is immutable.' using errcode='23514';end if;
 return new;
end;$$;
create trigger stripe_dispute_observation_immutable before update or delete
 on marketplace_private.stripe_dispute_observations for each row
 execute function marketplace_private.protect_stripe_dispute_observation();

-- Existing operation-specific exception fields remain authoritative. This trigger
-- adds only a sticky, provider-evidence hold for new Transfer preparation/claims.
create function marketplace_private.block_transfer_for_stripe_dispute() returns trigger
language plpgsql set search_path='' as $$
begin
 if (tg_op='INSERT' or(new.lease is not null and new.lease is distinct from old.lease))
  and exists(select 1 from marketplace_private.stripe_dispute_observations d
   where d.order_id=new.order_id and d.blocks_new_financial_operations) then
  raise exception 'Stripe Dispute blocks Seller Transfer.' using errcode='23514';end if;
 return new;
end;$$;
create trigger order_transfer_stripe_dispute_hold before insert or update
 on marketplace_private.order_transfer_operations for each row
 execute function marketplace_private.block_transfer_for_stripe_dispute();

alter table marketplace_private.stripe_webhook_inbox
 drop constraint stripe_webhook_inbox_purpose_check,
 drop constraint stripe_webhook_inbox_provider_check;
alter table marketplace_private.stripe_webhook_inbox
 add constraint stripe_webhook_inbox_purpose_check check(purpose in(
  'account_setup','marketplace_order','marketplace_order_refund','marketplace_order_transfer','connected_payout','marketplace_dispute')),
 add constraint stripe_webhook_inbox_provider_check check(
  (purpose='account_setup' and provider_ref is null)
  or(purpose='marketplace_order' and account_scope=platform and provider_ref ~ '^pi_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_refund' and account_scope=platform and provider_ref ~ '^re_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_transfer' and account_scope=platform and provider_ref ~ '^tr_[A-Za-z0-9]+$')
  or(purpose='connected_payout' and account_scope<>platform and account_scope ~ '^acct_[A-Za-z0-9]+$' and provider_ref ~ '^po_[A-Za-z0-9]+$')
  or(purpose='marketplace_dispute' and account_scope=platform and provider_ref ~ '^du_[A-Za-z0-9]+$'));
create index stripe_webhook_dispute_claim_idx on marketplace_private.stripe_webhook_inbox
 (platform,mode,next_attempt_at,received_at,event_id) where purpose='marketplace_dispute' and status<>'done';

create function public.marketplace_stripe_dispute_events(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;d marketplace_private.stripe_dispute_observations;
 a marketplace_private.campus_payment_attempts;o public.orders;tr marketplace_private.order_transfer_operations;
 listing_key uuid;t timestamptz:=clock_timestamp();keys text[];state text;terminal boolean;
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$' or p_action not in('enqueue','claim','apply','retry','done_mismatch') then
  raise exception 'Invalid Stripe Dispute event request.' using errcode='23514';end if;
 if p_action='enqueue' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from (select array_agg(x order by x) from unnest(array['id','providerReference','scope','type']::text[]) x)
   or p_value->>'id' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'providerReference' !~ '^du_[A-Za-z0-9]+$'
   or p_value->>'scope' is distinct from p_platform or p_value->>'type' not in(
    'charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
    'charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated') then
   raise exception 'Invalid Stripe Dispute event.' using errcode='23514';end if;
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
   values(p_platform,'test',p_value->>'id',p_value->>'type',p_platform,'marketplace_dispute',p_value->>'providerReference')
   on conflict(platform,mode,account_scope,event_id) do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test'
   and purpose='marketplace_dispute' and status in('pending','processing') and next_attempt_at<=t
   and(lease_until is null or lease_until<t)
   order by next_attempt_at,received_at,event_id limit 1 for update skip locked;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),lease_until=t+interval '180 seconds',
   attempts=attempts+1 where platform=e.platform and mode=e.mode and account_scope=e.account_scope and event_id=e.event_id returning * into e;
  return jsonb_build_object('eventId',e.event_id,'eventType',e.event_type,'providerReference',e.provider_ref,'lease',e.lease);
 elsif p_action in('retry','done_mismatch') then
  update marketplace_private.stripe_webhook_inbox set status=case when p_action='retry' then 'pending' else 'done' end,
   next_attempt_at=case when p_action='retry' then t+least(interval '30 minutes',interval '30 seconds'*greatest(attempts,1)) else next_attempt_at end,
   processed_at=case when p_action='done_mismatch' then t else null end,lease=null,lease_until=null,
   error_code=case when p_action='retry' then 'reconcile_failed' else 'provider_mismatch' end
   where platform=p_platform and mode='test' and purpose='marketplace_dispute' and event_id=p_value->>'eventId'
    and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale Stripe Dispute event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from (select array_agg(x order by x) from unnest(array[
   'amount','balanceTransactions','chargeAmount','chargeRef','chargeRefunded','currency','disputeRef',
   'eventId','eventType','evidencePastDue','evidenceSubmissionCount','fundsReinstated','fundsWithdrawn',
   'hasEvidence','metadataAttempt','metadataOrder','observedAt','paymentIntentRef','providerCreatedAt',
   'providerStatus','reason','responseDueAt']::text[]) x)
  or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$'
  or p_value->>'disputeRef' !~ '^du_[A-Za-z0-9]+$'
  or p_value->>'chargeRef' !~ '^ch_[A-Za-z0-9]+$'
  or p_value->>'paymentIntentRef' !~ '^pi_[A-Za-z0-9]+$'
  or p_value->>'eventType' not in('charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
   'charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')
  or p_value->>'providerStatus' not in('warning_needs_response','warning_under_review','warning_closed',
   'needs_response','under_review','won','lost','prevented')
  or p_value->>'currency' is distinct from 'cad'
  or p_value->>'reason' !~ '^[a-z0-9_]{1,80}$'
  or p_value->>'amount' !~ '^[1-9][0-9]{0,7}$'
  or p_value->>'chargeAmount' !~ '^[1-9][0-9]{0,7}$'
  or p_value->>'chargeRefunded' !~ '^[0-9]{1,8}$'
  or p_value->>'fundsWithdrawn' !~ '^[0-9]{1,8}$'
  or p_value->>'fundsReinstated' !~ '^[0-9]{1,8}$'
  or (p_value->>'amount')::bigint>(p_value->>'chargeAmount')::bigint
  or (p_value->>'chargeRefunded')::bigint>(p_value->>'chargeAmount')::bigint
  or jsonb_typeof(p_value->'hasEvidence')<>'boolean'
  or jsonb_typeof(p_value->'evidencePastDue')<>'boolean'
  or p_value->>'evidenceSubmissionCount' !~ '^[0-9]{1,4}$'
  or (p_value->>'evidenceSubmissionCount')::integer>1000
  or jsonb_typeof(p_value->'balanceTransactions')<>'array'
  or jsonb_array_length(p_value->'balanceTransactions')>4
  or p_value->>'metadataOrder' !~ '^$|^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or p_value->>'metadataAttempt' !~ '^$|^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or (p_value->>'providerCreatedAt')::timestamptz is null
  or (p_value->>'observedAt')::timestamptz is null
  or ((p_value->>'responseDueAt')<>'' and (p_value->>'responseDueAt')::timestamptz is null) then
  raise exception 'Invalid Stripe Dispute observation.' using errcode='23514';end if;

 select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test'
  and purpose='marketplace_dispute' and event_id=p_value->>'eventId' for update;
 if e.event_id is null or e.lease is distinct from p_token or e.lease_until<=t
  or e.provider_ref is distinct from p_value->>'disputeRef' or e.event_type is distinct from p_value->>'eventType' then
  raise exception 'Stale Stripe Dispute event lease.' using errcode='40001';end if;
 select * into a from marketplace_private.campus_payment_attempts where provider='stripe' and provider_mode='test'
  and provider_platform=p_platform and provider_purpose='marketplace_order'
  and provider_reference=p_value->>'paymentIntentRef' and status='paid' and provider_status='succeeded'
  and provider_observed_at is not null and provider_evidence_id is not null
  and((provider_reconcile_state='applied' and provider_exception_code is null)
   or(provider_reconcile_state='exception' and provider_exception_code='paid_after_cancellation_requested'));
 if a.id is not null then
  select * into o from public.orders where id=a.order_id;listing_key:=o.listing_id;
  perform 1 from public.listings where id=listing_key for update;
  select * into o from public.orders where id=a.order_id for update;
  select * into a from marketplace_private.campus_payment_attempts where id=a.id for update;
  select * into tr from marketplace_private.order_transfer_operations where order_id=o.id for update;
  if o.id is null or a.id is null or a.order_id is distinct from o.id or a.status<>'paid'
   or a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform is distinct from p_platform
   or a.provider_purpose<>'marketplace_order' or a.provider_reference is distinct from p_value->>'paymentIntentRef'
   or a.provider_status<>'succeeded' or a.provider_observed_at is null or a.provider_evidence_id is null
   or not((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
    or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested')) then
   raise exception 'Trusted paid Stripe attempt changed.' using errcode='23514';end if;
 end if;
 state:=case when a.id is null then 'unattributed'
  when p_value->>'metadataOrder' is distinct from o.id::text or p_value->>'metadataAttempt' is distinct from a.id::text
   or p_value->>'paymentIntentRef' is distinct from a.provider_reference
   or (p_value->>'chargeAmount')::bigint is distinct from a.provider_amount_cents
   or upper(p_value->>'currency') is distinct from a.provider_currency then 'conflict' else 'attributed' end;
 select * into d from marketplace_private.stripe_dispute_observations
  where provider_platform=p_platform and provider_mode='test' and dispute_ref=e.provider_ref for update;
 if d.id is not null and(d.charge_ref is distinct from p_value->>'chargeRef'
  or d.payment_intent_ref is distinct from p_value->>'paymentIntentRef'
  or d.amount_cents is distinct from (p_value->>'amount')::bigint or d.currency is distinct from upper(p_value->>'currency')
  or d.reconciliation_state is distinct from state) then
  update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code='provider_mismatch'
   where platform=p_platform and mode='test' and purpose='marketplace_dispute' and event_id=e.event_id and lease=p_token;
  return jsonb_build_object('result','mismatch');end if;
 terminal:=d.id is not null and d.provider_status in('won','lost','warning_closed','prevented');
 if terminal and d.provider_status is distinct from p_value->>'providerStatus' then
  update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code='provider_mismatch'
   where platform=p_platform and mode='test' and purpose='marketplace_dispute' and event_id=e.event_id and lease=p_token;
  return jsonb_build_object('result','mismatch');end if;
 insert into marketplace_private.stripe_dispute_observations(provider,provider_mode,provider_platform,dispute_ref,charge_ref,
  payment_intent_ref,payment_attempt_id,order_id,amount_cents,charge_amount_cents,charge_refunded_cents,currency,reason,
  provider_status,response_due_at,has_evidence,evidence_past_due,evidence_submission_count,balance_transactions,
  funds_withdrawn_cents,funds_reinstated_cents,reconciliation_state,blocks_new_financial_operations,retry_safe,
  transfer_state_at_observation,transfer_ref_at_observation,transfer_amount_cents,transfer_reversed_cents,
  provider_created_at,provider_observed_at,last_event_id,last_event_type)
 values('stripe','test',p_platform,e.provider_ref,p_value->>'chargeRef',p_value->>'paymentIntentRef',a.id,o.id,
  (p_value->>'amount')::bigint,(p_value->>'chargeAmount')::bigint,(p_value->>'chargeRefunded')::bigint,upper(p_value->>'currency'),
  p_value->>'reason',p_value->>'providerStatus',nullif(p_value->>'responseDueAt','')::timestamptz,
  (p_value->>'hasEvidence')::boolean,(p_value->>'evidencePastDue')::boolean,(p_value->>'evidenceSubmissionCount')::integer,
  p_value->'balanceTransactions',(p_value->>'fundsWithdrawn')::bigint,(p_value->>'fundsReinstated')::bigint,state,
  a.id is not null,state='unattributed',tr.state,tr.transfer_ref,tr.amount_cents,
  case when tr.provider_status='reversed' then tr.amount_cents when tr.provider_status='partially_reversed' then null
   when tr.id is not null then 0 end,
  (p_value->>'providerCreatedAt')::timestamptz,(p_value->>'observedAt')::timestamptz,e.event_id,e.event_type)
 on conflict(provider_platform,provider_mode,dispute_ref) do update set
  provider_status=excluded.provider_status,response_due_at=excluded.response_due_at,has_evidence=excluded.has_evidence,
  evidence_past_due=excluded.evidence_past_due,evidence_submission_count=excluded.evidence_submission_count,
  balance_transactions=excluded.balance_transactions,funds_withdrawn_cents=excluded.funds_withdrawn_cents,
  funds_reinstated_cents=excluded.funds_reinstated_cents,
  blocks_new_financial_operations=excluded.blocks_new_financial_operations,
  retry_safe=excluded.retry_safe,transfer_state_at_observation=excluded.transfer_state_at_observation,
  transfer_ref_at_observation=excluded.transfer_ref_at_observation,transfer_amount_cents=excluded.transfer_amount_cents,
  transfer_reversed_cents=excluded.transfer_reversed_cents,provider_observed_at=excluded.provider_observed_at,
  last_event_id=excluded.last_event_id,last_event_type=excluded.last_event_type,updated_at=t returning * into d;
 update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code=null
  where platform=p_platform and mode='test' and purpose='marketplace_dispute' and event_id=e.event_id and lease=p_token;
 return to_jsonb(d)||jsonb_build_object('result','applied');
end;$$;

revoke all on function marketplace_private.protect_stripe_dispute_observation() from public,anon,authenticated,service_role;
revoke all on function marketplace_private.block_transfer_for_stripe_dispute() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_stripe_dispute_events(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_stripe_dispute_events(text,text,uuid,jsonb) to service_role;

commit;

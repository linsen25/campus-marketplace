-- B24-C: connected-account bank Payout observations only.
-- This migration cannot create, cancel, reverse or assign a Payout to an Order.
begin;

create table marketplace_private.connected_payout_observations (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 connected_account_ref text not null check(connected_account_ref ~ '^acct_[A-Za-z0-9]+$'),
 payout_ref text not null check(payout_ref ~ '^po_[A-Za-z0-9]+$'),
 amount_cents bigint not null check(amount_cents between 1 and 99999999),
 currency text not null check(currency='CAD'),
 automatic boolean not null,
 payout_method text not null check(payout_method in('standard','instant')),
 provider_status text not null check(provider_status in('pending','in_transit','paid','failed','canceled')),
 provider_created_at timestamptz not null,
 arrival_at timestamptz not null,
 balance_transaction_ref text check(balance_transaction_ref is null or balance_transaction_ref ~ '^txn_[A-Za-z0-9]+$'),
 failure_balance_transaction_ref text check(failure_balance_transaction_ref is null or failure_balance_transaction_ref ~ '^txn_[A-Za-z0-9]+$'),
 failure_code text check(failure_code is null or(length(failure_code) between 1 and 100 and failure_code ~ '^[a-z0-9_]+$')),
 provider_reconciliation_status text not null check(provider_reconciliation_status in('not_applicable','in_progress','completed')),
 reconciliation_completed_at timestamptz,
 attribution_status text not null check(attribution_status in('unknown','unattributed')),
 last_event_id text not null check(last_event_id ~ '^evt_[A-Za-z0-9]+$'),
 last_event_type text not null check(last_event_type in('payout.created','payout.updated','payout.paid','payout.failed','payout.canceled','payout.reconciliation_completed')),
 provider_observed_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(provider_platform,provider_mode,connected_account_ref,payout_ref),
 unique(provider_platform,provider_mode,payout_ref),
 check(connected_account_ref<>provider_platform),
 check(reconciliation_completed_at is null or provider_reconciliation_status='completed'),
 check(updated_at>=created_at)
);
alter table marketplace_private.connected_payout_observations enable row level security;
revoke all on marketplace_private.connected_payout_observations from public,anon,authenticated,service_role;

create index connected_payout_account_observed_idx
 on marketplace_private.connected_payout_observations(provider_platform,provider_mode,connected_account_ref,provider_observed_at desc);

create function marketplace_private.protect_connected_payout_observation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['provider_status','arrival_at','balance_transaction_ref','failure_balance_transaction_ref','failure_code',
   'provider_reconciliation_status','reconciliation_completed_at','attribution_status','last_event_id','last_event_type',
   'provider_observed_at','updated_at']) is distinct from
  (to_jsonb(old)-array['provider_status','arrival_at','balance_transaction_ref','failure_balance_transaction_ref','failure_code',
   'provider_reconciliation_status','reconciliation_completed_at','attribution_status','last_event_id','last_event_type',
   'provider_observed_at','updated_at']) then
  raise exception 'Connected Payout binding is immutable.' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger connected_payout_observation_immutable before update or delete
 on marketplace_private.connected_payout_observations for each row
 execute function marketplace_private.protect_connected_payout_observation();

alter table marketplace_private.stripe_webhook_inbox
 drop constraint stripe_webhook_inbox_purpose_check,
 drop constraint stripe_webhook_inbox_provider_check;
alter table marketplace_private.stripe_webhook_inbox
 add constraint stripe_webhook_inbox_purpose_check
  check(purpose in('account_setup','marketplace_order','marketplace_order_refund','marketplace_order_transfer','connected_payout')),
 add constraint stripe_webhook_inbox_provider_check check(
  (purpose='account_setup' and provider_ref is null)
  or(purpose='marketplace_order' and account_scope=platform and provider_ref ~ '^pi_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_refund' and account_scope=platform and provider_ref ~ '^re_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_transfer' and account_scope=platform and provider_ref ~ '^tr_[A-Za-z0-9]+$')
  or(purpose='connected_payout' and account_scope<>platform and account_scope ~ '^acct_[A-Za-z0-9]+$'
   and provider_ref ~ '^po_[A-Za-z0-9]+$'));
create index stripe_webhook_connected_payout_claim_idx on marketplace_private.stripe_webhook_inbox
 (platform,mode,next_attempt_at,received_at,event_id)
 where purpose='connected_payout' and status='pending';

create function public.marketplace_connected_payout_events(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;r marketplace_private.connected_payout_observations;
 t timestamptz:=clock_timestamp();keys text[];incoming text;allowed boolean;
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$'
  or p_action is null or p_action not in('enqueue','claim','apply','retry','done_mismatch') then
  raise exception 'Invalid connected Payout event request.' using errcode='23514';end if;
 if p_action='enqueue' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from (select array_agg(x order by x) from unnest(array['id','providerReference','scope','type']::text[]) x)
   or p_value->>'id' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'providerReference' !~ '^po_[A-Za-z0-9]+$'
   or p_value->>'scope' !~ '^acct_[A-Za-z0-9]+$' or p_value->>'scope'=p_platform
   or p_value->>'type' not in('payout.created','payout.updated','payout.paid','payout.failed','payout.canceled','payout.reconciliation_completed') then
   raise exception 'Invalid connected Payout event.' using errcode='23514';end if;
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
   values(p_platform,'test',p_value->>'id',p_value->>'type',p_value->>'scope','connected_payout',p_value->>'providerReference')
   on conflict(platform,mode,account_scope,event_id) do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  if p_token is not null or p_value<>'{}'::jsonb then raise exception 'Unexpected claim input.' using errcode='23514';end if;
  select * into e from marketplace_private.stripe_webhook_inbox
   where platform=p_platform and mode='test' and purpose='connected_payout' and status='pending'
    and next_attempt_at<=t and(lease_until is null or lease_until<t)
   order by next_attempt_at,received_at,event_id limit 1 for update skip locked;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),
   lease_until=t+interval '180 seconds',attempts=attempts+1
   where platform=e.platform and mode=e.mode and account_scope=e.account_scope and event_id=e.event_id returning * into e;
  return jsonb_build_object('eventId',e.event_id,'eventType',e.event_type,'providerReference',e.provider_ref,
   'connectedAccount',e.account_scope,'lease',e.lease);
 elsif p_action in('retry','done_mismatch') then
  if p_token is null or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$' then
   raise exception 'Invalid connected Payout event result.' using errcode='23514';end if;
  update marketplace_private.stripe_webhook_inbox set
   status=case when p_action='retry' then 'pending' else 'done' end,
   next_attempt_at=case when p_action='retry' then t+least(interval '30 minutes',interval '30 seconds'*greatest(attempts,1)) else next_attempt_at end,
   processed_at=case when p_action='done_mismatch' then t else null end,lease=null,lease_until=null,
   error_code=case when p_action='retry' then 'reconcile_failed' else 'provider_mismatch' end
   where platform=p_platform and mode='test' and purpose='connected_payout' and event_id=p_value->>'eventId'
    and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale connected Payout event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if p_token is null or keys is distinct from (select array_agg(x order by x) from unnest(array[
  'amount','arrivalAt','attributionStatus','automatic','balanceTransactionRef','connectedAccount','currency',
  'eventId','eventType','failureBalanceTransactionRef','failureCode','method','observedAt','payoutRef',
  'providerCreatedAt','providerStatus','reconciliationStatus']::text[]) x) then
  raise exception 'Invalid connected Payout observation.' using errcode='23514';end if;
 select * into e from marketplace_private.stripe_webhook_inbox
  where platform=p_platform and mode='test' and purpose='connected_payout' and event_id=p_value->>'eventId' for update;
 if e.event_id is null or e.lease is distinct from p_token or e.lease_until<=t
  or e.account_scope is distinct from p_value->>'connectedAccount'
  or e.provider_ref is distinct from p_value->>'payoutRef' or e.event_type is distinct from p_value->>'eventType' then
  raise exception 'Stale connected Payout event lease.' using errcode='40001';end if;
 if p_value->>'amount' !~ '^[1-9][0-9]{0,7}$' or upper(p_value->>'currency')<>'CAD'
  or p_value->>'connectedAccount' !~ '^acct_[A-Za-z0-9]+$' or p_value->>'connectedAccount'=p_platform
  or p_value->>'payoutRef' !~ '^po_[A-Za-z0-9]+$'
  or p_value->>'method' not in('standard','instant') or p_value->>'automatic' not in('true','false')
  or p_value->>'attributionStatus' not in('unknown','unattributed')
  or p_value->>'reconciliationStatus' not in('not_applicable','in_progress','completed')
  or p_value->>'observedAt' is null or p_value->>'providerCreatedAt' is null or p_value->>'arrivalAt' is null then
  raise exception 'Invalid connected Payout binding.' using errcode='23514';end if;
 incoming:=case e.event_type when 'payout.paid' then 'paid' when 'payout.failed' then 'failed'
  when 'payout.canceled' then 'canceled' else null end;
 -- The retrieved object, not the event name, is authoritative. The event name is retained only as evidence.
 incoming:=coalesce(p_value->>'providerStatus',incoming);
 if incoming not in('pending','in_transit','paid','failed','canceled') then
  raise exception 'Invalid connected Payout status.' using errcode='23514';end if;
 select * into r from marketplace_private.connected_payout_observations
  where provider_platform=p_platform and provider_mode='test' and payout_ref=e.provider_ref for update;
 if r.id is null then
  insert into marketplace_private.connected_payout_observations(provider,provider_mode,provider_platform,
   connected_account_ref,payout_ref,amount_cents,currency,automatic,payout_method,provider_status,
   provider_created_at,arrival_at,balance_transaction_ref,failure_balance_transaction_ref,failure_code,
   provider_reconciliation_status,reconciliation_completed_at,attribution_status,last_event_id,last_event_type,
   provider_observed_at)
  values('stripe','test',p_platform,e.account_scope,e.provider_ref,(p_value->>'amount')::bigint,
   upper(p_value->>'currency'),(p_value->>'automatic')::boolean,p_value->>'method',incoming,
   (p_value->>'providerCreatedAt')::timestamptz,(p_value->>'arrivalAt')::timestamptz,
   nullif(p_value->>'balanceTransactionRef',''),nullif(p_value->>'failureBalanceTransactionRef',''),
   nullif(p_value->>'failureCode',''),p_value->>'reconciliationStatus',
   case when p_value->>'reconciliationStatus'='completed' then (p_value->>'observedAt')::timestamptz end,
   p_value->>'attributionStatus',e.event_id,e.event_type,(p_value->>'observedAt')::timestamptz) returning * into r;
 else
  if r.connected_account_ref is distinct from e.account_scope
   or r.amount_cents is distinct from (p_value->>'amount')::bigint or r.currency is distinct from upper(p_value->>'currency')
   or r.automatic is distinct from (p_value->>'automatic')::boolean or r.payout_method is distinct from p_value->>'method'
   or r.provider_created_at is distinct from (p_value->>'providerCreatedAt')::timestamptz
   or(r.balance_transaction_ref is not null and nullif(p_value->>'balanceTransactionRef','') is not null
    and r.balance_transaction_ref is distinct from p_value->>'balanceTransactionRef')
   or(r.failure_balance_transaction_ref is not null and nullif(p_value->>'failureBalanceTransactionRef','') is not null
    and r.failure_balance_transaction_ref is distinct from p_value->>'failureBalanceTransactionRef')
   or(r.provider_reconciliation_status='completed' and p_value->>'reconciliationStatus'<>'completed') then
   update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,
    error_code='provider_mismatch' where platform=p_platform and mode='test' and purpose='connected_payout'
     and account_scope=e.account_scope and event_id=e.event_id and lease=p_token;
   return jsonb_build_object('result','mismatch');end if;
  allowed:=case r.provider_status
   when 'pending' then incoming in('pending','in_transit','paid','failed','canceled')
   when 'in_transit' then incoming in('in_transit','paid','failed','canceled')
   when 'paid' then incoming in('paid','failed')
   when 'failed' then incoming='failed'
   when 'canceled' then incoming='canceled' else false end;
  if not allowed then
   update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,
    error_code='provider_mismatch' where platform=p_platform and mode='test' and purpose='connected_payout'
     and account_scope=e.account_scope and event_id=e.event_id and lease=p_token;
   return jsonb_build_object('result','mismatch');end if;
  update marketplace_private.connected_payout_observations set provider_status=incoming,
   arrival_at=(p_value->>'arrivalAt')::timestamptz,
   balance_transaction_ref=coalesce(nullif(p_value->>'balanceTransactionRef',''),balance_transaction_ref),
   failure_balance_transaction_ref=coalesce(nullif(p_value->>'failureBalanceTransactionRef',''),failure_balance_transaction_ref),
   failure_code=coalesce(nullif(p_value->>'failureCode',''),failure_code),
   provider_reconciliation_status=p_value->>'reconciliationStatus',
   reconciliation_completed_at=case when p_value->>'reconciliationStatus'='completed'
    then coalesce(reconciliation_completed_at,(p_value->>'observedAt')::timestamptz) else reconciliation_completed_at end,
   attribution_status=p_value->>'attributionStatus',last_event_id=e.event_id,last_event_type=e.event_type,
   provider_observed_at=(p_value->>'observedAt')::timestamptz,updated_at=t where id=r.id returning * into r;
 end if;
 update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code=null
  where platform=p_platform and mode='test' and purpose='connected_payout' and account_scope=e.account_scope
   and event_id=e.event_id and lease=p_token;
 return to_jsonb(r);
end;$$;

revoke all on function marketplace_private.protect_connected_payout_observation() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_connected_payout_events(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_connected_payout_events(text,text,uuid,jsonb) to service_role;

commit;

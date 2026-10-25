-- B24-B: fenced persistence for verified Stripe Transfer observations and notices.
-- Provider HTTP calls remain outside PostgreSQL; this migration creates no Transfer or Payout.
begin;

alter table marketplace_private.order_transfer_operations
 drop constraint order_transfer_operations_last_error_code_check;
alter table marketplace_private.order_transfer_operations
 add column source_charge_ref text,
 add column provider_observed_at timestamptz,
 add column provider_evidence_id text,
 add constraint order_transfer_source_charge_check
  check(source_charge_ref is null or source_charge_ref ~ '^ch_[A-Za-z0-9]+$'),
 add constraint order_transfer_evidence_check
  check(provider_evidence_id is null or provider_evidence_id ~ '^(evt_|reconcile:)[A-Za-z0-9-]+$'),
 add constraint order_transfer_operations_last_error_code_check check(last_error_code is null or last_error_code in(
  'provider_unavailable','provider_mismatch','unknown_outcome','stale_lease','terminal_conflict',
  'recipient_not_ready','insufficient_funds'));

create or replace function marketplace_private.protect_order_transfer_operation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['transfer_ref','source_charge_ref','state','provider_status','provider_observed_at',
   'provider_evidence_id','request_started_at','lease','lease_until','next_reconcile_at','attempts',
   'last_error_code','updated_at']) is distinct from
  (to_jsonb(old)-array['transfer_ref','source_charge_ref','state','provider_status','provider_observed_at',
   'provider_evidence_id','request_started_at','lease','lease_until','next_reconcile_at','attempts',
   'last_error_code','updated_at'])
  or(old.transfer_ref is not null and new.transfer_ref is distinct from old.transfer_ref)
  or(old.source_charge_ref is not null and new.source_charge_ref is distinct from old.source_charge_ref) then
  raise exception 'Transfer operation financial binding is immutable.' using errcode='23514';
 end if;
 return new;
end;$$;

create function public.marketplace_order_transfer_result(
 p_action text,p_order uuid,p_platform text,p_token uuid,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r marketplace_private.order_transfer_operations;listing_key uuid;
 t timestamptz:=clock_timestamp();keys text[];err text;next_state text;next_status text;result text;
 validated jsonb;reversed_amount bigint;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_order is null or p_platform is null or p_token is null
  or p_action not in('apply','defer') or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid transfer result operation.' using errcode='23514';end if;
 select o.listing_id into listing_key from marketplace_private.order_transfer_operations tr
  join public.orders o on o.id=tr.order_id
  where tr.order_id=p_order and tr.provider_platform=p_platform and tr.provider_mode='test';
 if listing_key is null then raise exception 'Transfer operation unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=listing_key for update;
 validated:=public.marketplace_order_transfer_operation('prepare',p_order,p_platform,null);
 select * into r from marketplace_private.order_transfer_operations
  where order_id=p_order and provider_platform=p_platform and provider_mode='test' for update;
 if r.id is null or r.lease is distinct from p_token or r.lease_until<=t then
  raise exception 'Stale transfer lease.' using errcode='40001';end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if p_action='defer' then
  if keys is distinct from array['errorCode']::text[]
   or p_value->>'errorCode' not in('provider_unavailable','provider_mismatch','unknown_outcome','recipient_not_ready','insufficient_funds') then
   raise exception 'Invalid transfer deferral.' using errcode='23514';end if;
  if r.state in('succeeded','failed','exception') then
   raise exception 'Terminal transfer operation cannot be deferred.' using errcode='23505';end if;
  err:=p_value->>'errorCode';
  next_state:=case when err in('provider_mismatch','recipient_not_ready','insufficient_funds')
    or(err='unknown_outcome' and r.attempts>=5) or(err='provider_unavailable' and r.attempts>=10)
   then 'exception' else 'reconciling' end;
  update marketplace_private.order_transfer_operations set state=next_state,lease=null,lease_until=null,
   next_reconcile_at=case when next_state='reconciling'
    then t+least(interval '10 minutes',interval '15 seconds'*greatest(1,attempts)) else t end,
   last_error_code=err,updated_at=t where id=r.id returning * into r;
  return to_jsonb(r)||jsonb_build_object('result',case when next_state='exception' then 'exception' else 'deferred' end);
 end if;

 if keys is distinct from (select array_agg(x order by x) from unnest(array[
  'amount','amountReversed','currency','destination','evidenceId','livemode','metadataAttempt',
  'metadataEnvironment','metadataKind','metadataOperation','metadataOrder','operationId','paymentIntentRef',
  'providerMode','providerPlatform','reversed','sourceChargeRef','transferGroup','transferRef']::text[]) x)
  or jsonb_typeof(p_value->'livemode') is distinct from 'boolean' or(p_value->>'livemode')::boolean
  or jsonb_typeof(p_value->'reversed') is distinct from 'boolean'
  or p_value->>'transferRef' !~ '^tr_[A-Za-z0-9]+$' or p_value->>'sourceChargeRef' !~ '^ch_[A-Za-z0-9]+$'
  or p_value->>'evidenceId' !~ '^(evt_|reconcile:)[A-Za-z0-9-]+$'
  or p_value->>'amount' !~ '^[0-9]+$' or p_value->>'amountReversed' !~ '^[0-9]+$' then
  raise exception 'Invalid transfer observation.' using errcode='23514';end if;
 if p_value->>'operationId' is distinct from r.operation_id::text
  or p_value->>'paymentIntentRef' is distinct from r.payment_intent_ref
  or p_value->>'providerPlatform' is distinct from r.provider_platform
  or p_value->>'providerMode' is distinct from r.provider_mode
  or(p_value->>'amount')::bigint is distinct from r.amount_cents
  or upper(p_value->>'currency') is distinct from r.currency
  or p_value->>'destination' is distinct from r.destination_account_ref
  or p_value->>'transferGroup' is distinct from r.transfer_group
  or p_value->>'metadataKind' is distinct from 'marketplace_order_transfer'
  or p_value->>'metadataOrder' is distinct from r.order_id::text
  or p_value->>'metadataAttempt' is distinct from r.payment_attempt_id::text
  or p_value->>'metadataOperation' is distinct from r.operation_id::text
  or p_value->>'metadataEnvironment' is distinct from 'staging'
  or(r.transfer_ref is not null and r.transfer_ref is distinct from p_value->>'transferRef')
  or(r.source_charge_ref is not null and r.source_charge_ref is distinct from p_value->>'sourceChargeRef') then
  raise exception 'Transfer provider binding mismatch.' using errcode='23514';end if;
 reversed_amount:=(p_value->>'amountReversed')::bigint;
 if reversed_amount<0 or reversed_amount>r.amount_cents
  or((p_value->>'reversed')::boolean and reversed_amount<>r.amount_cents)
  or(not(p_value->>'reversed')::boolean and reversed_amount=r.amount_cents) then
  raise exception 'Invalid Transfer reversal observation.' using errcode='23514';end if;
 next_status:=case when reversed_amount=0 then 'succeeded'
  when reversed_amount=r.amount_cents then 'reversed' else 'partially_reversed' end;
 next_state:=case when next_status='succeeded' then 'succeeded' else 'exception' end;
 err:=case when next_state='exception' then 'terminal_conflict' end;
 if r.state in('failed','exception') then
  if r.transfer_ref is not distinct from p_value->>'transferRef'
   and r.source_charge_ref is not distinct from p_value->>'sourceChargeRef'
   and r.provider_status is not distinct from next_status then
   return to_jsonb(r)||jsonb_build_object('result','duplicate');end if;
  raise exception 'Conflicting terminal transfer observation.' using errcode='23505';
 end if;
 if r.state='succeeded' and next_status='succeeded' then
  if r.transfer_ref is not distinct from p_value->>'transferRef'
   and r.source_charge_ref is not distinct from p_value->>'sourceChargeRef' then
   return to_jsonb(r)||jsonb_build_object('result','duplicate');end if;
  raise exception 'Conflicting successful transfer observation.' using errcode='23505';
 end if;
 update marketplace_private.order_transfer_operations set
  transfer_ref=coalesce(transfer_ref,p_value->>'transferRef'),
  source_charge_ref=coalesce(source_charge_ref,p_value->>'sourceChargeRef'),state=next_state,
  provider_status=next_status,provider_observed_at=t,provider_evidence_id=p_value->>'evidenceId',
  lease=null,lease_until=null,next_reconcile_at=t,last_error_code=err,updated_at=t
  where id=r.id returning * into r;
 result:=case when next_state='succeeded' then 'applied' else 'exception' end;
 return to_jsonb(r)||jsonb_build_object('result',result);
end;$$;

alter table marketplace_private.stripe_webhook_inbox
 drop constraint stripe_webhook_inbox_purpose_check,
 drop constraint stripe_webhook_inbox_provider_check;
alter table marketplace_private.stripe_webhook_inbox
 add constraint stripe_webhook_inbox_purpose_check
  check(purpose in('account_setup','marketplace_order','marketplace_order_refund','marketplace_order_transfer')),
 add constraint stripe_webhook_inbox_provider_check check(
  (purpose='account_setup' and provider_ref is null)
  or(purpose='marketplace_order' and account_scope=platform and provider_ref ~ '^pi_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_refund' and account_scope=platform and provider_ref ~ '^re_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_transfer' and account_scope=platform and provider_ref ~ '^tr_[A-Za-z0-9]+$'));
create index stripe_webhook_transfer_claim_idx on marketplace_private.stripe_webhook_inbox
 (platform,mode,purpose,status,next_attempt_at,received_at)
 where purpose='marketplace_order_transfer' and status<>'done';

create function public.marketplace_order_transfer_events(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;r marketplace_private.order_transfer_operations;
 t timestamptz:=clock_timestamp();keys text[];listing_key uuid;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid transfer event action.' using errcode='23514';end if;
 if p_action='enqueue' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from (select array_agg(x order by x) from unnest(array['id','providerReference','scope','type']::text[]) x)
   or p_value->>'type' not in('transfer.created','transfer.updated','transfer.reversed')
   or p_value->>'id' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'providerReference' !~ '^tr_[A-Za-z0-9]+$'
   or p_value->>'scope' is distinct from p_platform then
   raise exception 'Invalid Order transfer event.' using errcode='23514';end if;
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
  values(p_platform,'test',p_value->>'id',p_value->>'type',p_platform,'marketplace_order_transfer',p_value->>'providerReference')
  on conflict do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  if p_token is not null or p_value<>'{}'::jsonb then raise exception 'Unexpected claim input.' using errcode='23514';end if;
  select * into e from marketplace_private.stripe_webhook_inbox
   where platform=p_platform and mode='test' and purpose='marketplace_order_transfer'
    and status<>'done' and next_attempt_at<=t and(lease_until is null or lease_until<t)
   order by received_at,event_id for update skip locked limit 1;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),
   lease_until=t+interval '180 seconds',attempts=attempts+1
   where platform=e.platform and mode=e.mode and purpose=e.purpose and account_scope=e.account_scope
    and event_id=e.event_id returning * into e;
  return jsonb_build_object('eventId',e.event_id,'eventType',e.event_type,
   'providerReference',e.provider_ref,'lease',e.lease);
 elsif p_action='retry' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from array['eventId','reason']::text[] or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$'
   or p_value->>'reason' not in('provider_unavailable','operation_unavailable') then
   raise exception 'Invalid transfer event retry.' using errcode='23514';end if;
  update marketplace_private.stripe_webhook_inbox set
   status=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then 'done' else 'pending' end,
   processed_at=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then t else null end,
   lease=null,lease_until=null,next_attempt_at=t+least(interval '10 minutes',interval '15 seconds'*greatest(1,attempts)),
   error_code=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then 'binding_not_ready' else 'reconcile_failed' end
   where platform=p_platform and mode='test' and purpose='marketplace_order_transfer' and account_scope=p_platform
    and event_id=p_value->>'eventId' and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale transfer event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 elsif p_action='done_mismatch' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from array['eventId']::text[] or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$' then
   raise exception 'Invalid transfer event completion.' using errcode='23514';end if;
  update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,
   error_code='provider_mismatch'
   where platform=p_platform and mode='test' and purpose='marketplace_order_transfer' and account_scope=p_platform
    and event_id=p_value->>'eventId' and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale transfer event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 elsif p_action<>'done' then raise exception 'Unknown transfer event action.' using errcode='23514';end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from (select array_agg(x order by x) from unnest(array[
  'amount','currency','destination','eventId','metadataOperation','metadataOrder','transferRef']::text[]) x)
  or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'transferRef' !~ '^tr_[A-Za-z0-9]+$'
  or p_value->>'metadataOperation' !~ '^[0-9a-f-]{36}$' or p_value->>'metadataOrder' !~ '^[0-9a-f-]{36}$'
  or p_value->>'amount' !~ '^[0-9]+$' or upper(p_value->>'currency')<>'CAD'
  or p_value->>'destination' !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid transfer event observation.' using errcode='23514';end if;
 select * into e from marketplace_private.stripe_webhook_inbox
  where platform=p_platform and mode='test' and purpose='marketplace_order_transfer' and account_scope=p_platform
   and event_id=p_value->>'eventId' for update;
 if e.event_id is null or e.lease is distinct from p_token or e.lease_until<=t
  or e.provider_ref is distinct from p_value->>'transferRef' then
  raise exception 'Stale transfer event lease.' using errcode='40001';end if;
 select o.listing_id into listing_key from marketplace_private.order_transfer_operations tr
  join public.orders o on o.id=tr.order_id
  where tr.order_id=(p_value->>'metadataOrder')::uuid and tr.operation_id=(p_value->>'metadataOperation')::uuid;
 if listing_key is null then raise exception 'Transfer operation unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=listing_key for update;
 select * into r from marketplace_private.order_transfer_operations
  where order_id=(p_value->>'metadataOrder')::uuid and operation_id=(p_value->>'metadataOperation')::uuid for update;
 if r.id is null or r.provider_platform is distinct from p_platform or r.provider_mode<>'test'
  or r.amount_cents is distinct from (p_value->>'amount')::bigint or r.currency is distinct from upper(p_value->>'currency')
  or r.destination_account_ref is distinct from p_value->>'destination'
  or(r.transfer_ref is not null and r.transfer_ref is distinct from p_value->>'transferRef') then
  raise exception 'Transfer event binding mismatch.' using errcode='23514';end if;
 if r.state in('prepared','in_flight','reconciling','succeeded') and(r.lease_until is null or r.lease_until<=t) then
  update marketplace_private.order_transfer_operations set
   state=case when r.state='succeeded' then 'reconciling' else r.state end,
   next_reconcile_at=t,updated_at=t where id=r.id;
 end if;
 update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code=null
  where platform=p_platform and mode='test' and purpose='marketplace_order_transfer' and account_scope=p_platform
   and event_id=e.event_id;
 return jsonb_build_object('orderId',r.order_id,'operationId',r.operation_id,'result','scheduled');
end;$$;

create function public.marketplace_order_transfer_candidates(p_platform text,p_limit integer default 20)
returns table(order_id uuid) language plpgsql security definer set search_path='' as $$
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$' or p_limit is null or p_limit<1 or p_limit>20 then
  raise exception 'Invalid transfer candidate request.' using errcode='23514';end if;
 return query
  select o.id from public.orders o
  join marketplace_private.campus_payment_attempts a on a.order_id=o.id and a.status='paid'
   and a.provider='stripe' and a.provider_mode='test' and a.provider_platform=p_platform
   and a.provider_purpose='marketplace_order' and a.provider_status='succeeded'
  where o.order_protocol_version=2 and marketplace_private.payment_mode(o.terms_snapshot->'terms')='uu_pay'
   and o.payment_status='paid' and not o.holds_listing
   and((o.lifecycle_status='completed' and o.payout_status='eligible')
    or(o.lifecycle_status='cancelled' and exists(select 1 from marketplace_private.order_settlement_authorizations s
      where s.order_id=o.id and s.disposition='delivery_compensation' and s.seller_delivery_compensation_cents>0)))
   and not exists(select 1 from marketplace_private.order_transfer_operations tr where tr.order_id=o.id)
  order by coalesce(o.reservation_ended_at,o.updated_at),o.id limit p_limit;
end;$$;

revoke all on function public.marketplace_order_transfer_result(text,uuid,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_transfer_result(text,uuid,text,uuid,jsonb) to service_role;
revoke all on function public.marketplace_order_transfer_events(text,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_transfer_events(text,text,uuid,jsonb) to service_role;
revoke all on function public.marketplace_order_transfer_candidates(text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_transfer_candidates(text,integer) to service_role;

commit;

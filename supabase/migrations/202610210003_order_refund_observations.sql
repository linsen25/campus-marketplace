-- B23-B: fenced persistence of server-verified Stripe Refund observations.
-- Stripe HTTP calls remain outside PostgreSQL; this migration moves no money.
begin;

alter table marketplace_private.order_refund_operations
 drop constraint order_refund_operations_last_error_code_check;
alter table marketplace_private.order_refund_operations
 add constraint order_refund_operations_last_error_code_check check(last_error_code is null or last_error_code in(
  'provider_unavailable','provider_mismatch','unknown_outcome','stale_lease','terminal_conflict','requires_action'));

create function public.marketplace_order_refund_result(
 p_action text,p_order uuid,p_platform text,p_token uuid,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.campus_payment_attempts;
 i marketplace_private.order_cancellation_intents;s marketplace_private.order_settlement_authorizations;
 e marketplace_private.v2_order_economics;r marketplace_private.order_refund_operations;
 listing_key uuid;t timestamptz:=clock_timestamp();keys text[];next_state text;err text;result text;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_order is null or p_platform is null or p_token is null
  or p_action not in('apply','defer') or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid refund result operation.' using errcode='23514';
 end if;
 select * into r from marketplace_private.order_refund_operations
  where order_id=p_order and provider_platform=p_platform and provider_mode='test';
 if r.id is null then raise exception 'Refund operation unavailable.' using errcode='P0002';end if;
 select listing_id into listing_key from public.orders where id=r.order_id;
 perform 1 from public.listings where id=listing_key for update;
 select * into o from public.orders where id=r.order_id for update;
 select * into a from marketplace_private.campus_payment_attempts where id=r.payment_attempt_id for update;
 select * into s from marketplace_private.order_settlement_authorizations where order_id=o.id for update;
 select * into r from marketplace_private.order_refund_operations where id=r.id for update;
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
 select * into e from marketplace_private.v2_order_economics where order_id=o.id;
 if r.lease is distinct from p_token or r.lease_until<=t then
  raise exception 'Stale refund lease.' using errcode='40001';
 end if;
 if i.state is distinct from 'finalized' or o.order_protocol_version<>2
  or marketplace_private.payment_mode(o.terms_snapshot->'terms') is distinct from 'uu_pay'
  or o.lifecycle_status<>'cancelled' or o.holds_listing or o.payment_status<>'paid'
  or a.order_id is distinct from o.id or a.status<>'paid' or a.finished_at is distinct from o.payment_paid_at
  or a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform is distinct from p_platform
  or a.provider_purpose<>'marketplace_order' or a.provider_reference is distinct from r.payment_intent_ref
  or a.provider_amount_cents is distinct from e.buyer_total_cents or a.provider_currency<>'CAD'
  or a.provider_status<>'succeeded' or a.provider_observed_at is null or a.provider_evidence_id is null
  or not((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
   or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested'))
  or s.secured_cents is distinct from e.buyer_total_cents or s.buyer_release_cents is distinct from r.amount_cents
  or r.amount_cents>a.provider_amount_cents then
  raise exception 'Refund authority changed.' using errcode='23514';
 end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if p_action='defer' then
  if keys is distinct from array['errorCode']::text[]
   or p_value->>'errorCode' not in('provider_unavailable','provider_mismatch','unknown_outcome') then
   raise exception 'Invalid refund deferral.' using errcode='23514';end if;
  if r.state in('succeeded','failed','exception') then
   raise exception 'Terminal refund operation cannot be deferred.' using errcode='23505';end if;
  err:=p_value->>'errorCode';
  next_state:=case when err='provider_mismatch' or(err='unknown_outcome' and r.attempts>=5)
    or(err='provider_unavailable' and r.attempts>=10) then 'exception' else 'reconciling' end;
  update marketplace_private.order_refund_operations set state=next_state,lease=null,lease_until=null,
   next_reconcile_at=case when next_state='reconciling' then t+least(interval '10 minutes',interval '15 seconds'*greatest(1,attempts)) else t end,
   last_error_code=err,updated_at=t where id=r.id returning * into r;
  return to_jsonb(r)||jsonb_build_object('result',case when next_state='exception' then 'exception' else 'deferred' end);
 end if;

 if keys is distinct from (select array_agg(x order by x) from unnest(array[
  'amount','currency','livemode','metadataAttempt','metadataEnvironment','metadataKind','metadataOperation','metadataOrder',
  'operationId','paymentIntentRef','providerMode','providerPlatform','providerStatus','refundRef']::text[]) x)
  or jsonb_typeof(p_value->'livemode') is distinct from 'boolean' or(p_value->>'livemode')::boolean
  or p_value->>'refundRef' !~ '^re_[A-Za-z0-9]+$'
  or p_value->>'providerStatus' not in('pending','requires_action','succeeded','failed','canceled')
  or p_value->>'amount' !~ '^[0-9]+$' then
  raise exception 'Invalid refund observation.' using errcode='23514';end if;
 if p_value->>'operationId' is distinct from r.operation_id::text
  or p_value->>'paymentIntentRef' is distinct from r.payment_intent_ref
  or p_value->>'providerPlatform' is distinct from r.provider_platform
  or p_value->>'providerMode' is distinct from r.provider_mode
  or(p_value->>'amount')::bigint is distinct from r.amount_cents
  or upper(p_value->>'currency') is distinct from r.currency
  or p_value->>'metadataKind' is distinct from 'marketplace_order_refund'
  or p_value->>'metadataOrder' is distinct from r.order_id::text
  or p_value->>'metadataAttempt' is distinct from r.payment_attempt_id::text
  or p_value->>'metadataOperation' is distinct from r.operation_id::text
  or p_value->>'metadataEnvironment' is distinct from 'staging'
  or(r.refund_ref is not null and r.refund_ref is distinct from p_value->>'refundRef') then
  raise exception 'Refund provider binding mismatch.' using errcode='23514';end if;
 if r.state in('succeeded','failed','exception') then
  if r.refund_ref is not distinct from p_value->>'refundRef'
   and r.provider_status is not distinct from p_value->>'providerStatus' then
   return to_jsonb(r)||jsonb_build_object('result','duplicate');
  end if;
  raise exception 'Conflicting terminal refund observation.' using errcode='23505';
 end if;
 next_state:=case p_value->>'providerStatus'
  when 'pending' then 'reconciling'
  when 'succeeded' then 'succeeded'
  when 'failed' then 'failed'
  when 'canceled' then 'failed'
  else 'exception' end;
 err:=case when p_value->>'providerStatus'='requires_action' then 'requires_action' end;
 update marketplace_private.order_refund_operations set refund_ref=coalesce(refund_ref,p_value->>'refundRef'),
  state=next_state,provider_status=p_value->>'providerStatus',
  next_reconcile_at=case when next_state='reconciling' then t+interval '1 minute' else t end,
  last_error_code=err,updated_at=t where id=r.id returning * into r;
 result:=case when next_state='succeeded' then 'applied' when next_state='failed' then 'applied'
  when next_state='exception' then 'exception' else 'pending' end;
 return to_jsonb(r)||jsonb_build_object('result',result);
end;$$;

revoke all on function public.marketplace_order_refund_result(text,uuid,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_refund_result(text,uuid,text,uuid,jsonb) to service_role;

commit;

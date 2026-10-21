-- B23-C: durable Refund event notices and bounded refund authorization discovery.
-- Webhooks only wake an existing operation; B23-B remains the sole provider
-- observation and Stripe Refund execution authority.
begin;

alter table marketplace_private.stripe_webhook_inbox
 drop constraint stripe_webhook_inbox_purpose_check,
 drop constraint stripe_webhook_inbox_provider_check;
alter table marketplace_private.stripe_webhook_inbox
 add constraint stripe_webhook_inbox_purpose_check
  check(purpose in('account_setup','marketplace_order','marketplace_order_refund')),
 add constraint stripe_webhook_inbox_provider_check check(
  (purpose='account_setup' and provider_ref is null)
  or(purpose='marketplace_order' and account_scope=platform and provider_ref ~ '^pi_[A-Za-z0-9]+$')
  or(purpose='marketplace_order_refund' and account_scope=platform and provider_ref ~ '^re_[A-Za-z0-9]+$')
 );
create index stripe_webhook_refund_claim_idx on marketplace_private.stripe_webhook_inbox
 (platform,mode,purpose,status,next_attempt_at,received_at)
 where purpose='marketplace_order_refund' and status<>'done';

create function public.marketplace_order_refund_events(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;r marketplace_private.order_refund_operations;
 t timestamptz:=clock_timestamp();keys text[];listing_key uuid;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid refund event action.' using errcode='23514';
 end if;
 if p_action='enqueue' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from (select array_agg(x order by x) from unnest(array['id','providerReference','scope','type']::text[]) x)
   or p_value->>'type' not in('refund.created','refund.updated','refund.failed')
   or p_value->>'id' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'providerReference' !~ '^re_[A-Za-z0-9]+$'
   or p_value->>'scope' is distinct from p_platform then
   raise exception 'Invalid Order refund event.' using errcode='23514';
  end if;
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
  values(p_platform,'test',p_value->>'id',p_value->>'type',p_platform,'marketplace_order_refund',p_value->>'providerReference')
  on conflict do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  if p_token is not null or p_value<>'{}'::jsonb then raise exception 'Unexpected claim input.' using errcode='23514';end if;
  select * into e from marketplace_private.stripe_webhook_inbox
   where platform=p_platform and mode='test' and purpose='marketplace_order_refund'
    and status<>'done' and next_attempt_at<=t and (lease_until is null or lease_until<t)
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
   raise exception 'Invalid refund event retry.' using errcode='23514';end if;
  update marketplace_private.stripe_webhook_inbox set
   status=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then 'done' else 'pending' end,
   processed_at=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then t else null end,
   lease=null,lease_until=null,
   next_attempt_at=t+least(interval '10 minutes',interval '15 seconds'*greatest(1,attempts)),
   error_code=case when p_value->>'reason'='operation_unavailable' and attempts>=10 then 'binding_not_ready' else 'reconcile_failed' end
   where platform=p_platform and mode='test' and purpose='marketplace_order_refund' and account_scope=p_platform
    and event_id=p_value->>'eventId' and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale refund event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 elsif p_action='done_mismatch' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from array['eventId']::text[] or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$' then
   raise exception 'Invalid refund event completion.' using errcode='23514';end if;
  update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,
   error_code='provider_mismatch'
   where platform=p_platform and mode='test' and purpose='marketplace_order_refund' and account_scope=p_platform
    and event_id=p_value->>'eventId' and lease=p_token and lease_until>t;
  if not found then raise exception 'Stale refund event lease.' using errcode='40001';end if;
  return '{}'::jsonb;
 elsif p_action<>'done' then
  raise exception 'Unknown refund event action.' using errcode='23514';
 end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from (select array_agg(x order by x) from unnest(array['amount','currency','eventId','metadataOperation',
  'metadataOrder','paymentIntentRef','refundRef']::text[]) x)
  or p_value->>'eventId' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'refundRef' !~ '^re_[A-Za-z0-9]+$'
  or p_value->>'paymentIntentRef' !~ '^pi_[A-Za-z0-9]+$' or p_value->>'metadataOperation' !~ '^[0-9a-f-]{36}$'
  or p_value->>'metadataOrder' !~ '^[0-9a-f-]{36}$' or p_value->>'amount' !~ '^[0-9]+$'
  or upper(p_value->>'currency')<>'CAD' then
  raise exception 'Invalid refund event observation.' using errcode='23514';end if;
 select * into e from marketplace_private.stripe_webhook_inbox
  where platform=p_platform and mode='test' and purpose='marketplace_order_refund' and account_scope=p_platform
   and event_id=p_value->>'eventId' for update;
 if e.event_id is null or e.lease is distinct from p_token or e.lease_until<=t
  or e.provider_ref is distinct from p_value->>'refundRef' then
  raise exception 'Stale refund event lease.' using errcode='40001';end if;
 select o.listing_id into listing_key from marketplace_private.order_refund_operations ro
  join public.orders o on o.id=ro.order_id
  where ro.order_id=(p_value->>'metadataOrder')::uuid and ro.operation_id=(p_value->>'metadataOperation')::uuid;
 if listing_key is null then raise exception 'Refund operation unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=listing_key for update;
 perform 1 from public.orders where id=(p_value->>'metadataOrder')::uuid for update;
 select * into r from marketplace_private.order_refund_operations
  where order_id=(p_value->>'metadataOrder')::uuid and operation_id=(p_value->>'metadataOperation')::uuid for update;
 if r.id is null or r.provider_platform is distinct from p_platform or r.provider_mode<>'test'
  or r.payment_intent_ref is distinct from p_value->>'paymentIntentRef'
  or r.amount_cents is distinct from (p_value->>'amount')::bigint or r.currency is distinct from upper(p_value->>'currency')
  or (r.refund_ref is not null and r.refund_ref is distinct from p_value->>'refundRef') then
  raise exception 'Refund event binding mismatch.' using errcode='23514';end if;
 if r.state in('prepared','in_flight','reconciling') and (r.lease_until is null or r.lease_until<=t) then
  update marketplace_private.order_refund_operations set next_reconcile_at=t,updated_at=t where id=r.id;
 end if;
 update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,error_code=null
  where platform=p_platform and mode='test' and purpose='marketplace_order_refund' and account_scope=p_platform
   and event_id=e.event_id;
 return jsonb_build_object('orderId',r.order_id,'operationId',r.operation_id,'result','scheduled');
end;$$;

create function public.marketplace_order_refund_candidates(p_platform text,p_limit integer default 20)
returns table(order_id uuid) language plpgsql security definer set search_path='' as $$
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform is null or p_platform !~ '^acct_[A-Za-z0-9]+$' or p_limit is null or p_limit<1 or p_limit>20 then
  raise exception 'Invalid refund candidate request.' using errcode='23514';end if;
 return query
  select o.id from public.orders o
  join marketplace_private.order_cancellation_intents i on i.order_id=o.id and i.state='finalized'
  join marketplace_private.order_settlement_authorizations s on s.order_id=o.id and s.buyer_release_cents>0
  join marketplace_private.campus_payment_attempts a on a.order_id=o.id and a.status='paid'
   and a.provider='stripe' and a.provider_mode='test' and a.provider_platform=p_platform
   and a.provider_purpose='marketplace_order' and a.provider_status='succeeded'
   and a.provider_reference is not null and a.provider_observed_at is not null and a.provider_evidence_id is not null
   and ((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
    or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested'))
  where o.order_protocol_version=2 and marketplace_private.payment_mode(o.terms_snapshot->'terms')='uu_pay'
   and o.lifecycle_status='cancelled' and not o.holds_listing and o.payment_status='paid'
   and o.payment_paid_at is not null and o.cancelled_at is not null and o.reservation_ended_at=o.cancelled_at
   and not exists(select 1 from marketplace_private.order_refund_operations r where r.order_id=o.id)
  order by o.cancelled_at,o.id limit p_limit;
end;$$;

revoke all on function public.marketplace_order_refund_events(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_refund_events(text,text,uuid,jsonb) to service_role;
revoke all on function public.marketplace_order_refund_candidates(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_refund_candidates(text,integer) to service_role;

commit;

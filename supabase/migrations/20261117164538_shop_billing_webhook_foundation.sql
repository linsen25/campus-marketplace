-- Phase 4A: verified Stripe Test webhook inbox and provider-state projection.
-- This migration never calls shop_membership_command or changes entitlements.
begin;

alter table marketplace_private.shop_billing_events
  add column provider_object_id text,
  add column provider_customer_id text,
  add column provider_subscription_id text,
  add column lease_token uuid,
  add column lease_until timestamptz;
create index shop_billing_events_lease_idx on marketplace_private.shop_billing_events(processing_status, lease_until);
create unique index shop_billing_audit_event_action_unique
  on marketplace_private.shop_billing_audit_log(billing_event_id, action)
  where billing_event_id is not null;

create function public.marketplace_shop_billing_event_command(
  p_action text,
  p_platform text,
  p_event_id text,
  p_value jsonb default '{}'::jsonb,
  p_lease uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event marketplace_private.shop_billing_events; v_now timestamptz:=clock_timestamp(); v_delay interval;
begin
  if p_action not in ('ingest','claim','complete','retry','fail') or p_platform !~ '^acct_[A-Za-z0-9]+$'
     or p_event_id !~ '^evt_[A-Za-z0-9]+$' or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Invalid Billing event command.' using errcode='23514';
  end if;
  if p_action='ingest' then
    if exists(select 1 from jsonb_object_keys(p_value) k where k not in ('eventType','objectId','customerId','subscriptionId','payloadSha256','providerCreatedAt'))
       or coalesce(length(p_value->>'eventType'),0) not between 3 and 255
       or (p_value->>'payloadSha256') !~ '^[0-9a-f]{64}$'
       or coalesce(length(p_value->>'objectId'),0)>255 or coalesce(length(p_value->>'customerId'),0)>255 or coalesce(length(p_value->>'subscriptionId'),0)>255 then
      raise exception 'Invalid Billing event payload.' using errcode='23514';
    end if;
    insert into marketplace_private.shop_billing_events(provider_account_id,provider_event_id,event_type,provider_object_id,provider_customer_id,provider_subscription_id,payload_sha256,provider_created_at)
      values(p_platform,p_event_id,p_value->>'eventType',nullif(p_value->>'objectId',''),nullif(p_value->>'customerId',''),nullif(p_value->>'subscriptionId',''),p_value->>'payloadSha256',nullif(p_value->>'providerCreatedAt','')::timestamptz)
      on conflict(provider,provider_account_id,provider_event_id) do nothing;
    select * into v_event from marketplace_private.shop_billing_events e where e.provider='stripe' and e.provider_account_id=p_platform and e.provider_event_id=p_event_id;
    return jsonb_build_object('state',v_event.processing_status,'eventId',v_event.id);
  end if;

  select * into v_event from marketplace_private.shop_billing_events e
    where e.provider='stripe' and e.provider_account_id=p_platform and e.provider_event_id=p_event_id for update;
  if not found then raise exception 'Billing event was not found.' using errcode='23514'; end if;
  if p_action='claim' then
    if v_event.processing_status='processed' or v_event.processing_status='failed'
       or (v_event.processing_status='processing' and v_event.lease_until>v_now)
       or (v_event.processing_status='retryable' and v_event.next_retry_at>v_now) then
      return jsonb_build_object('claimed',false,'state',v_event.processing_status);
    end if;
    update marketplace_private.shop_billing_events set processing_status='processing',retry_count=retry_count+1,
      processing_started_at=v_now,lease_token=gen_random_uuid(),lease_until=v_now+interval '5 minutes',updated_at=v_now
      where id=v_event.id returning * into v_event;
    return jsonb_build_object('claimed',true,'lease',v_event.lease_token,'eventId',v_event.id,
      'eventType',v_event.event_type,'objectId',v_event.provider_object_id,'customerId',v_event.provider_customer_id,'subscriptionId',v_event.provider_subscription_id,'providerCreatedAt',v_event.provider_created_at);
  end if;
  if p_lease is null or v_event.processing_status<>'processing' or v_event.lease_token is distinct from p_lease then
    raise exception 'Billing event lease is invalid.' using errcode='40001';
  end if;
  if p_action='complete' then
    update marketplace_private.shop_billing_events set processing_status='processed',processed_at=v_now,lease_token=null,lease_until=null,error_summary=null,updated_at=v_now where id=v_event.id;
  elsif p_action='retry' then
    if coalesce(length(p_value->>'error'),0)>1000 then raise exception 'Billing event error is invalid.' using errcode='23514'; end if;
    v_delay:=make_interval(secs=>least(3600,30*(2^least(v_event.retry_count,6))));
    update marketplace_private.shop_billing_events set processing_status='retryable',next_retry_at=v_now+v_delay,
      lease_token=null,lease_until=null,error_summary=coalesce(nullif(p_value->>'error',''),'Provider synchronization failed.'),updated_at=v_now where id=v_event.id;
  else
    if coalesce(length(p_value->>'error'),0)>1000 then raise exception 'Billing event error is invalid.' using errcode='23514'; end if;
    update marketplace_private.shop_billing_events set processing_status='failed',lease_token=null,lease_until=null,error_summary=coalesce(nullif(p_value->>'error',''),'Provider synchronization was rejected.'),updated_at=v_now where id=v_event.id;
  end if;
  return jsonb_build_object('state',case when p_action='complete' then 'processed' when p_action='retry' then 'retryable' else 'failed' end);
end;$$;

create function public.marketplace_shop_billing_sync_subscription(
  p_platform text,
  p_event_id text,
  p_lease uuid,
  p_value jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event marketplace_private.shop_billing_events; v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions; v_owner uuid; v_updated timestamptz; v_applied boolean:=false;
begin
  if p_platform !~ '^acct_[A-Za-z0-9]+$' or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_lease is null
     or jsonb_typeof(p_value) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('subscriptionId','customerId','status','tier','priceId','periodStart','periodEnd','cancelAtPeriodEnd','canceledAt','endedAt','providerUpdatedAt'))
     or (p_value->>'subscriptionId') !~ '^sub_[A-Za-z0-9]+$' or (p_value->>'customerId') !~ '^cus_[A-Za-z0-9]+$'
     or (p_value->>'status') not in ('incomplete','incomplete_expired','trialing','active','past_due','unpaid','paused','canceled')
     or (p_value->>'tier') not in ('plus','pro') or coalesce(length(p_value->>'priceId'),0)>255
     or (p_value->>'periodStart') is null or (p_value->>'periodEnd') is null or (p_value->>'providerUpdatedAt') is null then
    raise exception 'Invalid provider subscription state.' using errcode='23514';
  end if;
  select * into v_event from marketplace_private.shop_billing_events e where e.provider='stripe' and e.provider_account_id=p_platform and e.provider_event_id=p_event_id for update;
  if not found or v_event.processing_status<>'processing' or v_event.lease_token is distinct from p_lease then raise exception 'Billing event lease is invalid.' using errcode='40001'; end if;
  select * into v_customer from marketplace_private.shop_billing_customers c where c.provider='stripe' and c.provider_account_id=p_platform and c.provider_customer_id=p_value->>'customerId' for update;
  if not found then raise exception 'Verified Billing customer binding was not found.' using errcode='23514'; end if;
  v_owner:=v_customer.owner_id; v_updated:=(p_value->>'providerUpdatedAt')::timestamptz;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.provider='stripe' and s.provider_account_id=p_platform and s.provider_subscription_id=p_value->>'subscriptionId' for update;
  if found and (v_subscription.owner_id<>v_owner or v_subscription.billing_customer_id<>v_customer.id) then raise exception 'Billing subscription binding mismatch.' using errcode='23514'; end if;
  if not found then
    insert into marketplace_private.shop_billing_subscriptions(owner_id,billing_customer_id,provider_account_id,provider_subscription_id,provider_price_id,tier,status,current_period_start,current_period_end,cancel_at_period_end,canceled_at,ended_at,provider_updated_at)
      values(v_owner,v_customer.id,p_platform,p_value->>'subscriptionId',nullif(p_value->>'priceId',''),p_value->>'tier',p_value->>'status',(p_value->>'periodStart')::timestamptz,(p_value->>'periodEnd')::timestamptz,coalesce((p_value->>'cancelAtPeriodEnd')::boolean,false),nullif(p_value->>'canceledAt','')::timestamptz,nullif(p_value->>'endedAt','')::timestamptz,v_updated)
      returning * into v_subscription; v_applied:=true;
  elsif v_subscription.provider_updated_at is null or v_updated>=v_subscription.provider_updated_at then
    update marketplace_private.shop_billing_subscriptions set provider_price_id=nullif(p_value->>'priceId',''),tier=p_value->>'tier',status=p_value->>'status',current_period_start=(p_value->>'periodStart')::timestamptz,current_period_end=(p_value->>'periodEnd')::timestamptz,cancel_at_period_end=coalesce((p_value->>'cancelAtPeriodEnd')::boolean,false),canceled_at=nullif(p_value->>'canceledAt','')::timestamptz,ended_at=nullif(p_value->>'endedAt','')::timestamptz,provider_updated_at=v_updated,revision=revision+1,updated_at=clock_timestamp() where id=v_subscription.id returning * into v_subscription; v_applied:=true;
  end if;
  if v_applied then
    insert into marketplace_private.shop_billing_audit_log(owner_id,billing_customer_id,billing_subscription_id,billing_event_id,action,details)
      values(v_owner,v_customer.id,v_subscription.id,v_event.id,'subscription_synced',jsonb_build_object('providerStatus',v_subscription.status,'providerUpdatedAt',v_subscription.provider_updated_at)) on conflict do nothing;
  end if;
  return jsonb_build_object('applied',v_applied,'ownerId',v_owner,'subscriptionId',v_subscription.id);
end;$$;

revoke all on function public.marketplace_shop_billing_event_command(text,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_shop_billing_sync_subscription(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_billing_event_command(text,text,text,jsonb,uuid),public.marketplace_shop_billing_sync_subscription(text,text,uuid,jsonb) to service_role;

commit;

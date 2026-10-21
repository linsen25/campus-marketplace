-- B22: verified Stripe Order payment events and recoverable reconciliation.
-- Signed webhooks are durable notices; only a fresh server-side PaymentIntent
-- retrieval may apply an Order payment outcome.
begin;

alter table marketplace_private.stripe_webhook_inbox
 add column purpose text not null default 'account_setup',
 add column provider_ref text,
 add constraint stripe_webhook_inbox_purpose_check check(purpose in('account_setup','marketplace_order')),
 add constraint stripe_webhook_inbox_provider_check check(
  (purpose='account_setup' and provider_ref is null)
  or(purpose='marketplace_order' and account_scope=platform and provider_ref ~ '^pi_[A-Za-z0-9]+$')
 );
alter table marketplace_private.stripe_webhook_inbox drop constraint stripe_webhook_inbox_error_code_check;
alter table marketplace_private.stripe_webhook_inbox add constraint stripe_webhook_inbox_error_code_check
 check(error_code in('reconcile_failed','binding_not_ready','provider_mismatch','late_payment_review'));
create index stripe_webhook_order_claim_idx on marketplace_private.stripe_webhook_inbox
 (platform,mode,purpose,status,next_attempt_at,received_at) where purpose='marketplace_order' and status<>'done';

alter table marketplace_private.campus_payment_attempts
 add column provider_status text,
 add column provider_observed_at timestamptz,
 add column provider_evidence_id text,
 add column provider_reconcile_state text,
 add column provider_exception_code text,
 add column provider_reconcile_after timestamptz,
 add column provider_reconcile_lease uuid,
 add column provider_reconcile_lease_until timestamptz,
 add column provider_reconcile_attempts integer not null default 0,
 add constraint campus_payment_provider_status_check check(provider_status is null or provider_status in(
  'requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded')),
 add constraint campus_payment_reconcile_state_check check(provider_reconcile_state is null or provider_reconcile_state in('pending','applied','exception')),
 add constraint campus_payment_reconcile_exception_check check(provider_exception_code is null or provider_exception_code in(
  'binding_mismatch','unexpected_provider_state','late_success','late_failure','paid_after_cancellation_requested','terminal_conflict')),
 add constraint campus_payment_reconcile_lease_check check((provider_reconcile_lease is null)=(provider_reconcile_lease_until is null)),
 add constraint campus_payment_reconcile_attempts_check check(provider_reconcile_attempts>=0);
create index campus_payment_reconcile_due_idx on marketplace_private.campus_payment_attempts
 (provider_platform,provider_mode,provider_reconcile_after,provider_bound_at)
 where provider='stripe' and provider_purpose='marketplace_order' and status='processing';

-- Preserve the setup consumer while excluding Order payment notices from it.
create or replace function public.marketplace_stripe_events(p_action text,p_platform text,p_value jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;b marketplace_private.stripe_bindings;t timestamptz:=clock_timestamp();
begin
 perform marketplace_private.require_stripe_staging();
 if p_action='enqueue' then
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,owner_ref,purpose)
  values(p_platform,'test',p_value->>'id',p_value->>'type',p_value->>'scope',p_value->>'owner','account_setup') on conflict do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test' and purpose='account_setup'
   and status<>'done' and next_attempt_at<=t and (lease_until is null or lease_until<t) order by received_at for update skip locked limit 1;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),lease_until=t+interval '180 seconds',attempts=attempts+1
  where platform=e.platform and mode=e.mode and purpose='account_setup' and account_scope=e.account_scope and event_id=e.event_id returning * into e;
  select * into b from marketplace_private.stripe_bindings where platform=p_platform and mode='test' and (owner_ref=e.owner_ref or instrument_ref=e.owner_ref);
  return to_jsonb(e)||jsonb_build_object('binding',case when b.id is null then null else jsonb_build_object('user_id',b.user_id,'kind',b.kind) end);
 elsif p_action in('done','retry') then
  update marketplace_private.stripe_webhook_inbox set status=case when p_action='done' then 'done' else 'pending' end,
   processed_at=case when p_action='done' then t else null end,lease=null,lease_until=null,next_attempt_at=t+interval '1 minute',
   error_code=case when p_action='done' then null else 'reconcile_failed' end
  where platform=p_platform and mode='test' and purpose='account_setup' and account_scope=p_value->>'scope'
   and event_id=p_value->>'id' and lease=(p_value->>'lease')::uuid and lease_until>t;
  return '{}'::jsonb;
 else raise exception 'Unknown event action.';end if;
end;$$;

-- A single private authority owns Order event enqueue, event/due leases and the
-- locked application of a freshly retrieved PaymentIntent observation.
create function public.marketplace_order_payment_reconciliation(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;a marketplace_private.campus_payment_attempts;o public.orders;
 t timestamptz:=clock_timestamp();keys text[];mismatch boolean:=false;cancel_pending boolean:=false;
 provider_state text;amount bigint;received bigint;result text:='pending';err text;
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Invalid platform.' using errcode='23514';end if;
 if p_action='enqueue' then
  select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
  if keys is distinct from (select array_agg(x order by x) from unnest(array['id','providerReference','scope','type']::text[]) x)
   or p_value->>'type' not in('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','payment_intent.canceled')
   or p_value->>'id' !~ '^evt_[A-Za-z0-9]+$' or p_value->>'providerReference' !~ '^pi_[A-Za-z0-9]+$'
   or p_value->>'scope' is distinct from p_platform then raise exception 'Invalid Order payment event.' using errcode='23514';end if;
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,purpose,provider_ref)
  values(p_platform,'test',p_value->>'id',p_value->>'type',p_platform,'marketplace_order',p_value->>'providerReference') on conflict do nothing;
  return '{}'::jsonb;
 elsif p_action='claim_event' then
  select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test' and purpose='marketplace_order'
   and status<>'done' and next_attempt_at<=t and (lease_until is null or lease_until<t) order by received_at,event_id for update skip locked limit 1;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),lease_until=t+interval '180 seconds',attempts=attempts+1
  where platform=e.platform and mode=e.mode and purpose=e.purpose and account_scope=e.account_scope and event_id=e.event_id returning * into e;
  return jsonb_build_object('claimKind','event','eventId',e.event_id,'eventType',e.event_type,'providerReference',e.provider_ref,'lease',e.lease);
 elsif p_action='claim_unbound' then
  select * into a from marketplace_private.campus_payment_attempts where provider='stripe' and provider_mode='test'
   and provider_platform=p_platform and provider_purpose='marketplace_order' and provider_reference is null and status='processing'
   and provider_create_started_at between t-interval '20 hours' and t-interval '120 seconds'
   and (provider_lease_until is null or provider_lease_until<t) and coalesce(provider_reconcile_after,provider_create_started_at)<=t
   order by provider_create_started_at,id for update skip locked limit 1;
  if a.id is null then return null;end if;
  update marketplace_private.campus_payment_attempts set provider_reconcile_after=t+interval '1 minute',
   provider_reconcile_attempts=provider_reconcile_attempts+1 where id=a.id returning * into a;
  return jsonb_build_object('claimKind','unbound','attemptId',a.id,'buyerId',a.buyer_id);
 elsif p_action='claim_due' then
  select * into a from marketplace_private.campus_payment_attempts where provider='stripe' and provider_mode='test'
   and provider_platform=p_platform and provider_purpose='marketplace_order' and provider_reference is not null and status='processing'
   and provider_reconcile_state is distinct from 'exception'
   and coalesce(provider_reconcile_after,provider_bound_at,provider_create_started_at)<=t
   and (provider_reconcile_lease_until is null or provider_reconcile_lease_until<t)
   order by coalesce(provider_reconcile_after,provider_bound_at,provider_create_started_at),id for update skip locked limit 1;
  if a.id is null then return null;end if;
  update marketplace_private.campus_payment_attempts set provider_reconcile_lease=gen_random_uuid(),provider_reconcile_lease_until=t+interval '180 seconds',
   provider_reconcile_after=t+interval '5 minutes',provider_reconcile_attempts=provider_reconcile_attempts+1 where id=a.id returning * into a;
  return jsonb_build_object('claimKind','due','attemptId',a.id,'providerReference',a.provider_reference,'lease',a.provider_reconcile_lease);
 elsif p_action='retry_event' then
  update marketplace_private.stripe_webhook_inbox set status='pending',lease=null,lease_until=null,
   next_attempt_at=t+least(interval '10 minutes',interval '15 seconds'*greatest(1,attempts)),error_code='reconcile_failed'
  where platform=p_platform and mode='test' and purpose='marketplace_order' and event_id=p_value->>'eventId'
   and account_scope=p_platform and lease=p_token and lease_until>t;
  return '{}'::jsonb;
 elsif p_action='retry_due' then
  update marketplace_private.campus_payment_attempts set provider_reconcile_lease=null,provider_reconcile_lease_until=null,
   provider_reconcile_after=t+least(interval '10 minutes',interval '15 seconds'*greatest(1,provider_reconcile_attempts))
  where id=(p_value->>'attemptId')::uuid and provider_platform=p_platform and provider_reconcile_lease=p_token and provider_reconcile_lease_until>t;
  return '{}'::jsonb;
 elsif p_action not in('apply_event','apply_due') then raise exception 'Unknown reconciliation action.' using errcode='23514';end if;

 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;
 if keys is distinct from (select array_agg(x order by x) from unnest(array['amount','amountReceived','attemptId','currency','customer','evidenceId','livemode','metadataAttempt',
  'metadataEnvironment','metadataKind','orderId','paymentMethod','providerReference','providerStatus','sellerAccount','transferGroup']::text[]) x)
  or jsonb_typeof(p_value->'livemode') is distinct from 'boolean' or (p_value->>'livemode')::boolean
  or p_value->>'providerReference' !~ '^pi_[A-Za-z0-9]+$'
  or p_value->>'providerStatus' not in('requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded')
  or p_value->>'amount' !~ '^[0-9]+$' or p_value->>'amountReceived' !~ '^[0-9]+$'
  then raise exception 'Invalid provider observation.' using errcode='23514';end if;
 amount:=(p_value->>'amount')::bigint;received:=(p_value->>'amountReceived')::bigint;provider_state:=p_value->>'providerStatus';
 if p_action='apply_event' then
  select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test' and purpose='marketplace_order'
   and account_scope=p_platform and event_id=p_value->>'evidenceId' for update;
  if e.event_id is null or e.lease is distinct from p_token or e.lease_until<=clock_timestamp()
   or e.provider_ref is distinct from p_value->>'providerReference'
   then raise exception 'Stale event lease.' using errcode='40001';end if;
  select * into a from marketplace_private.campus_payment_attempts where provider='stripe' and provider_mode='test'
   and provider_platform=p_platform and provider_purpose='marketplace_order' and provider_reference=e.provider_ref;
 else
  select * into a from marketplace_private.campus_payment_attempts where id=(p_value->>'attemptId')::uuid and provider='stripe'
   and provider_mode='test' and provider_platform=p_platform and provider_purpose='marketplace_order';
 end if;
 if a.id is null then raise exception 'Payment attempt binding unavailable.' using errcode='P0002';end if;
 select * into o from public.orders where id=a.order_id;
 if o.id is null then raise exception 'Payment attempt binding unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=a.order_id for update;
 select * into a from marketplace_private.campus_payment_attempts where id=a.id for update;
 if a.id is null or a.order_id is distinct from o.id or a.provider<>'stripe' or a.provider_mode<>'test'
  or a.provider_platform is distinct from p_platform or a.provider_purpose<>'marketplace_order' then
  raise exception 'Payment attempt changed.' using errcode='40001';end if;
 if p_action='apply_event' then
  if e.lease is distinct from p_token or e.lease_until<=clock_timestamp()
   or e.provider_ref is distinct from a.provider_reference then
   raise exception 'Stale event lease.' using errcode='40001';end if;
 elsif a.provider_reconcile_lease is distinct from p_token or a.provider_reconcile_lease_until<=clock_timestamp() then
  raise exception 'Stale reconciliation lease.' using errcode='40001';
 end if;
 mismatch:=a.provider_reference is distinct from p_value->>'providerReference' or a.id::text is distinct from p_value->>'attemptId'
  or a.order_id::text is distinct from p_value->>'orderId' or a.provider_amount_cents is distinct from amount
  or a.provider_currency is distinct from upper(p_value->>'currency') or a.provider_customer_ref is distinct from p_value->>'customer'
  or a.provider_instrument_ref is distinct from p_value->>'paymentMethod' or a.provider_seller_account_ref is distinct from p_value->>'sellerAccount'
  or a.provider_transfer_group is distinct from p_value->>'transferGroup' or a.id::text is distinct from p_value->>'metadataAttempt'
  or a.order_id::text is distinct from p_value->>'orderId' or p_value->>'metadataKind' is distinct from 'marketplace_order'
  or p_value->>'metadataEnvironment' is distinct from 'staging';
 if mismatch or (provider_state='succeeded' and received<>amount) or (provider_state='canceled' and received<>0) then
  err:='binding_mismatch';result:='exception';
 elsif provider_state='succeeded' then
  if a.status='paid' and o.payment_status='paid' then
   if a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested' then
    err:='paid_after_cancellation_requested';result:='exception';
   else result:='duplicate';end if;
  elsif a.status='processing' and o.lifecycle_status='open' and o.payment_status='processing' and o.holds_listing
   and exists(select 1 from public.listings where id=o.listing_id and status='pending' and reserved_order_id=o.id) then
   cancel_pending:=exists(select 1 from marketplace_private.order_cancellation_intents where order_id=o.id);
   update marketplace_private.campus_payment_attempts set status='paid',finished_at=t where id=a.id;
   update public.orders set payment_status='paid',payment_paid_at=t,fulfillment_status='awaiting_fulfillment',updated_at=t where id=o.id;
   perform marketplace_private.finalize_order_cancellation(o.id);
   if cancel_pending then err:='paid_after_cancellation_requested';result:='exception';else result:='applied';end if;
  else err:=case when a.status in('paid','failed') then 'terminal_conflict' else 'late_success' end;result:='exception';end if;
 elsif provider_state='canceled' then
  if a.status='failed' and o.payment_status='failed' then result:='duplicate';
  elsif a.status='processing' and o.lifecycle_status='open' and o.payment_status='processing' and o.holds_listing
   and exists(select 1 from public.listings where id=o.listing_id and status='pending' and reserved_order_id=o.id) then
   update marketplace_private.campus_payment_attempts set status='failed',finished_at=t where id=a.id;
   update public.orders set payment_status='failed',payment_paid_at=null,fulfillment_status='awaiting_payment',updated_at=t where id=o.id;
   insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    select o.conversation_id,o.request_id,o.id,a.buyer_id,'buyer','payment_failed',t,a.id::text||':payment_failed',jsonb_build_object('orderId',o.id,'source','stripe')
    where not exists(select 1 from public.transaction_events where transition_key=a.id::text||':payment_failed');
   perform marketplace_private.notify_order_history(o.conversation_id);
   perform marketplace_private.finalize_order_cancellation(o.id);result:='applied';
  else err:=case when a.status in('paid','failed') then 'terminal_conflict' else 'late_failure' end;result:='exception';end if;
 elsif provider_state='requires_capture' then err:='unexpected_provider_state';result:='exception';
 else result:='pending';end if;

 update marketplace_private.campus_payment_attempts set provider_status=provider_state,provider_observed_at=t,
  provider_evidence_id=case when provider_reconcile_state='exception' and provider_exception_code='paid_after_cancellation_requested'
   then provider_evidence_id else p_value->>'evidenceId' end,
  provider_reconcile_state=case when result in('applied','duplicate') then 'applied' when result='exception' then 'exception' else 'pending' end,
  provider_exception_code=err,provider_reconcile_after=case when result='pending' then t+interval '1 minute' else null end,
  provider_reconcile_lease=case when p_action='apply_due' then null else provider_reconcile_lease end,
  provider_reconcile_lease_until=case when p_action='apply_due' then null else provider_reconcile_lease_until end where id=a.id;
 if p_action='apply_event' then
  update marketplace_private.stripe_webhook_inbox set status='done',processed_at=t,lease=null,lease_until=null,
   error_code=case when result='exception' then case when err='binding_mismatch' then 'provider_mismatch' else 'late_payment_review' end else null end
  where platform=p_platform and mode='test' and purpose='marketplace_order' and account_scope=p_platform and event_id=e.event_id;
 end if;
 return jsonb_build_object('result',result,'attemptId',a.id,'orderId',a.order_id,'providerStatus',provider_state,'exceptionCode',err);
end;$$;

-- Attribute Paid events to their actual authority without changing the event key
-- or any downstream notification behavior.
create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;happened timestamptz;payment_source text:='staging_simulator';
begin
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' and new.terms_snapshot->'terms'->>'fulfillment'='delivery' then
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
  values(new.conversation_id,new.request_id,new.id,'system','reservation_expired',new.expired_at,new.id::text||':reservation_expired',jsonb_build_object('orderId',new.id));
  perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' then
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
  select new.conversation_id,new.request_id,new.id,'system','order_no_show_expired',new.expired_at,new.id::text||':order_no_show_expired',
   jsonb_build_object('orderId',new.id,'confirmedRevisionId',e.confirmed_id,'graceDeadline',e.deadline,'reason','Meetup was not completed within the allowed grace period.')
  from marketplace_private.meetup_expiries e where e.order_id=new.id;
  perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
 if tg_op='INSERT' then kind:='order_created';happened:=new.created_at;
 elsif new.payment_status='paid' and old.payment_status<>'paid' then
  kind:='payment_paid';happened:=new.payment_paid_at;
  if exists(select 1 from marketplace_private.campus_payment_attempts where order_id=new.id and status='paid' and provider='stripe') then payment_source:='stripe';end if;
 elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
 elsif new.lifecycle_status='completed' then kind:='order_completed';happened:=new.reservation_ended_at;
 elsif new.lifecycle_status='cancelled' then kind:='order_cancelled';happened:=new.cancelled_at;
 else kind:='reservation_expired';happened:=new.expired_at;end if;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(new.conversation_id,new.request_id,new.id,
  case when kind='order_cancelled' then new.cancelled_by when kind='order_created' then auth.uid() when kind='payment_paid' then new.buyer_id end,
  case when kind='order_cancelled' then new.cancelled_by_role when kind='order_created' then case when auth.uid()=new.buyer_id then 'buyer' else 'seller' end when kind='payment_paid' then 'buyer' else 'system' end,
  kind,happened,new.id::text||':'||kind,jsonb_build_object('orderId',new.id)||
  case when kind='payment_paid' then jsonb_build_object('source',payment_source)
   when kind='order_cancelled' then jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note)
   else '{}'::jsonb end);
 perform marketplace_private.notify_order_history(new.conversation_id);return new;
end;$$;

revoke all on function public.marketplace_order_payment_reconciliation(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_payment_reconciliation(text,text,uuid,jsonb) to service_role;

commit;

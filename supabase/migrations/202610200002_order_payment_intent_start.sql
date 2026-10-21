-- B21: durable, idempotent Stripe PaymentIntent start. No payment outcome authority.
begin;

alter table marketplace_private.campus_payment_attempts
 add column provider text,
 add column provider_mode text,
 add column provider_platform text,
 add column provider_purpose text,
 add column provider_operation_id uuid,
 add column provider_idempotency_key text,
 add column provider_customer_ref text,
 add column provider_instrument_ref text,
 add column provider_seller_account_ref text,
 add column provider_amount_cents bigint,
 add column provider_currency text,
 add column provider_transfer_group text,
 add column provider_reference text,
 add column provider_create_started_at timestamptz,
 add column provider_bound_at timestamptz,
 add column provider_lease uuid,
 add column provider_lease_until timestamptz,
 add constraint campus_payment_provider_group check (
  (provider is null and provider_mode is null and provider_platform is null and provider_purpose is null
   and provider_operation_id is null and provider_idempotency_key is null and provider_customer_ref is null
   and provider_instrument_ref is null and provider_seller_account_ref is null and provider_amount_cents is null
   and provider_currency is null and provider_transfer_group is null and provider_reference is null
   and provider_create_started_at is null and provider_bound_at is null and provider_lease is null and provider_lease_until is null)
  or
  (provider='stripe' and provider_mode='test' and provider_platform ~ '^acct_[A-Za-z0-9]+$'
   and provider_purpose='marketplace_order' and provider_operation_id is not null
   and provider_idempotency_key is not null and length(provider_idempotency_key) between 20 and 255
   and provider_customer_ref ~ '^cus_[A-Za-z0-9]+$' and provider_instrument_ref ~ '^pm_[A-Za-z0-9]+$'
   and provider_seller_account_ref ~ '^acct_[A-Za-z0-9]+$'
   and provider_amount_cents between 1 and 99999999 and provider_currency='CAD'
   and provider_transfer_group=('uu_order_'||order_id::text)
   and (provider_reference is null or provider_reference ~ '^pi_[A-Za-z0-9]+$')
   and (provider_bound_at is null)=(provider_reference is null)
   and (provider_lease is null)=(provider_lease_until is null))
 );

create unique index campus_payment_provider_operation_unique
 on marketplace_private.campus_payment_attempts(provider_platform,provider_mode,provider_purpose,provider_operation_id)
 where provider_operation_id is not null;
create unique index campus_payment_provider_idempotency_unique
 on marketplace_private.campus_payment_attempts(provider_platform,provider_mode,provider_idempotency_key)
 where provider_idempotency_key is not null;
create unique index campus_payment_provider_reference_unique
 on marketplace_private.campus_payment_attempts(provider_platform,provider_mode,provider_reference)
 where provider_reference is not null;

-- The authenticated start RPC still owns Order eligibility and attempt creation.
-- Only its new event label changes from simulator-specific to provider-neutral.
create or replace function public.marketplace_start_order_payment(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;method text;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_payment'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery') then raise exception 'Buyer Order required.' using errcode='42501';end if;
 select * into a from marketplace_private.campus_payment_attempts where buyer_id=auth.uid() and command=p_client_action_id;
 if found and a.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 perform marketplace_private.lock_financial_capability(auth.uid(),'payment_method');
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.order_agreement_ready(o.id) then raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';end if;
 if marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' then raise exception 'External exchange has no UU payment.' using errcode='23514';end if;
 perform marketplace_private.assert_order_progression(o);
 select * into l from public.listings where id=o.listing_id;
 if a.id is not null then return jsonb_build_object('attemptId',a.id,'status',a.status);end if;
 if o.lifecycle_status='open' and o.holds_listing and o.payment_status='processing' and o.buyer_id=auth.uid() then
  select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and buyer_id=auth.uid() and status='processing';
  if a.id is null then raise exception 'Protected attempt missing.' using errcode='23514';end if;
  return jsonb_build_object('attemptId',a.id,'status',a.status);
 end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending' or l.reserved_order_id is distinct from o.id or o.payment_status not in('pending','failed') or o.buyer_id is distinct from auth.uid() then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
  perform 1 from marketplace_private.delivery_checkouts where order_id=o.id and checkout_started_at is not null and payment_deadline_at>clock_timestamp() and address_snapshot is not null for update;
  if not found then raise exception 'Valid checkout and matching private address required.' using errcode='23514';end if;
 end if;
 perform marketplace_private.v2_order_money(o.id);
 select status into method from marketplace_private.financial_capabilities where user_id=auth.uid() and capability='payment_method' for update;
 if method is distinct from 'set' then return jsonb_build_object('errorCode','buyer_payment_method_not_ready');end if;
 t:=clock_timestamp();
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then update marketplace_private.delivery_checkouts set address_frozen_at=coalesce(address_frozen_at,t) where order_id=o.id;end if;
 insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at) values(o.id,auth.uid(),p_client_action_id,'processing',t) returning * into a;
 update public.orders set payment_status='processing',updated_at=t where id=o.id;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','payment_started',t,a.id::text||':payment_started',jsonb_build_object('orderId',o.id,'source','order_payment_attempt'));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return jsonb_build_object('attemptId',a.id,'status',a.status);
end;$$;

-- Trusted server lease. It freezes all Stripe create parameters before HTTPS and
-- binds exactly one PaymentIntent afterward. It never resolves payment outcome.
create function public.marketplace_order_payment_provider(p_action text,p_attempt uuid,p_buyer uuid,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a marketplace_private.campus_payment_attempts;o public.orders;l public.listings;m jsonb;b marketplace_private.stripe_bindings;s marketplace_private.stripe_bindings;t timestamptz:=clock_timestamp();op uuid;confirmable boolean;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action not in('claim','bind','read','release') or p_platform !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Invalid provider operation.' using errcode='23514';end if;
 -- Locate without locking, then join the global per-Order financial lock order.
 select * into a from marketplace_private.campus_payment_attempts where id=p_attempt and buyer_id=p_buyer;
 if a.id is null then raise exception 'Payment attempt unavailable.' using errcode='42501';end if;
 select * into o from public.orders where id=a.order_id;
 if o.id is null then raise exception 'Payment attempt unavailable.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=a.order_id for update;
 select * into a from marketplace_private.campus_payment_attempts where id=p_attempt and buyer_id=p_buyer for update;
 if a.id is null or a.order_id is distinct from o.id then raise exception 'Payment attempt changed.' using errcode='40001';end if;
 select * into l from public.listings where id=o.listing_id;
 confirmable:=o.buyer_id=p_buyer and o.seller_id is not null and o.seller_id<>p_buyer and o.lifecycle_status='open' and o.holds_listing and o.payment_status='processing' and l.status='pending' and l.reserved_order_id=o.id and marketplace_private.payment_mode(o.terms_snapshot->'terms')='uu_pay' and marketplace_private.order_agreement_ready(o.id);
 if p_action='claim' and not confirmable then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if a.provider is null then
  if p_action<>'claim' then raise exception 'Provider operation unavailable.' using errcode='23514';end if;
  m:=marketplace_private.v2_order_money(o.id);
  if m->>'total' is null or (m->>'total')::bigint<=0 then raise exception 'Invalid frozen economics.' using errcode='23514';end if;
  select * into b from marketplace_private.stripe_bindings where user_id=p_buyer and kind='payment_method' and platform=p_platform and mode='test' and status='set';
  select * into s from marketplace_private.stripe_bindings where user_id=o.seller_id and kind='payout_account' and platform=p_platform and mode='test' and status='ready';
  if b.id is null or b.owner_ref is null or b.instrument_ref is null then raise exception 'Buyer payment binding unavailable.' using errcode='23514';end if;
  if s.id is null or s.owner_ref is null then raise exception 'Seller Connect binding unavailable.' using errcode='23514';end if;
  op:=gen_random_uuid();
  update marketplace_private.campus_payment_attempts set provider='stripe',provider_mode='test',provider_platform=p_platform,provider_purpose='marketplace_order',provider_operation_id=op,
   provider_idempotency_key='uu:test:'||p_platform||':order:'||op::text,provider_customer_ref=b.owner_ref,provider_instrument_ref=b.instrument_ref,
   provider_seller_account_ref=s.owner_ref,provider_amount_cents=(m->>'total')::bigint,provider_currency='CAD',provider_transfer_group='uu_order_'||o.id::text
  where id=a.id returning * into a;
 else
  if a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform<>p_platform or a.provider_purpose<>'marketplace_order' then raise exception 'Provider identity mismatch.' using errcode='23514';end if;
 end if;
 if p_action='read' then return to_jsonb(a)||jsonb_build_object('confirmable',confirmable);end if;
 if p_action='claim' then
  if a.provider_reference is not null then return to_jsonb(a)||jsonb_build_object('claimState','bound','confirmable',confirmable);end if;
  if a.provider_create_started_at is not null and a.provider_create_started_at<t-interval '20 hours' then return to_jsonb(a)||jsonb_build_object('claimState','reconcile','confirmable',false);end if;
  if a.provider_lease_until>t then return to_jsonb(a)||jsonb_build_object('claimState','in_progress','confirmable',confirmable);end if;
  update marketplace_private.campus_payment_attempts set provider_lease=gen_random_uuid(),provider_lease_until=t+interval '120 seconds',provider_create_started_at=coalesce(provider_create_started_at,t) where id=a.id returning * into a;
  return to_jsonb(a)||jsonb_build_object('claimState','create','confirmable',confirmable);
 end if;
 if a.provider_lease is distinct from p_token or a.provider_lease_until<t then raise exception 'Stale provider operation.' using errcode='40001';end if;
 if p_action='release' then update marketplace_private.campus_payment_attempts set provider_lease=null,provider_lease_until=null where id=a.id;return null;end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_value) k) is distinct from array['providerReference']::text[] or p_value->>'providerReference' !~ '^pi_[A-Za-z0-9]+$' then raise exception 'Invalid provider reference.' using errcode='23514';end if;
 if a.provider_reference is not null and a.provider_reference is distinct from p_value->>'providerReference' then raise exception 'Provider reference mismatch.' using errcode='23505';end if;
 update marketplace_private.campus_payment_attempts set provider_reference=coalesce(provider_reference,p_value->>'providerReference'),provider_bound_at=coalesce(provider_bound_at,t),provider_lease=null,provider_lease_until=null where id=a.id returning * into a;
 return to_jsonb(a)||jsonb_build_object('confirmable',confirmable);
end;$$;

revoke all on function public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb) to service_role;

commit;

-- Phase D: provider-independent Order financial foundation. STAGING ONLY.
-- Reviewed additive extension; old Request/history and monetary snapshots are preserved.
begin;
lock table public.orders in access exclusive mode;
alter table public.orders drop constraint orders_payment_status_check;
alter table public.orders alter column payment_status set default 'pending';
alter table public.orders add column payment_paid_at timestamptz;
alter table public.orders add column payout_status text not null default 'not_eligible';
-- Existing rows have never been paid. Disable only the two known Order triggers,
-- in this locked transaction, to map not_enabled without rewriting events/lifecycle.
alter table public.orders disable trigger orders_immutable;
alter table public.orders disable trigger orders_event;
update public.orders set payment_status='pending' where payment_status='not_enabled';
alter table public.orders enable trigger orders_immutable;
alter table public.orders enable trigger orders_event;
alter table public.orders add constraint orders_payment_status_check
  check(payment_status in('pending','processing','paid','failed','refunded'));
alter table public.orders add constraint orders_payout_status_check
  check(payout_status in('not_eligible','pending','on_hold','eligible','processing','paid','failed'));
alter table public.orders add constraint orders_payment_timestamp_check
  check((payment_status in('paid','refunded'))=(payment_paid_at is not null));
alter table public.orders add constraint orders_paid_inventory_check
  check(payment_status<>'paid' or (lifecycle_status='open' and holds_listing and money_status='finalized'));
alter table public.orders drop constraint orders_fulfillment_status_check;
alter table public.orders add constraint orders_fulfillment_status_check
  check(fulfillment_status in('awaiting_payment','awaiting_fulfillment'));
alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check
  check(event_type in('request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired','payment_paid'));
alter table marketplace_private.order_commands drop constraint order_commands_action_check;
alter table marketplace_private.order_commands add constraint order_commands_action_check
  check(action in('create','replace','cancel','accept','simulate_payment'));

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
  if tg_op='DELETE' then raise exception 'Order history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='INSERT' then
    select * into r from public.order_requests where id=new.request_id;
    if not found or r.status<>'active' or auth.uid() is distinct from r.buyer_id or new.buyer_id is distinct from r.buyer_id
      or new.seller_id is distinct from r.seller_id or new.conversation_id<>r.conversation_id or new.listing_id<>r.listing_id
      or new.listing_origin_id<>r.listing_origin_id or new.buyer_origin_id<>r.buyer_origin_id or new.seller_origin_id<>r.seller_origin_id
      or new.terms_snapshot is distinct from to_jsonb(r) or new.item_amount_cents<>r.item_amount_cents
      or new.shipping_amount_cents is distinct from (case when r.fulfillment_type<>'shipping' then 0 else r.shipping_amount_cents end)
      or new.lifecycle_status<>'open' or new.holds_listing is distinct from (new.shipping_amount_cents is not null)
      or new.money_status<>(case when new.shipping_amount_cents is null then 'shipping_pending' else 'finalized' end)
      or new.service_fee_amount_cents is distinct from (marketplace_private.order_money(new.item_amount_cents,new.shipping_amount_cents)->>'fee')::bigint
      or new.total_amount_cents is distinct from (marketplace_private.order_money(new.item_amount_cents,new.shipping_amount_cents)->>'total')::bigint then
      raise exception 'Canonical Buyer Request required.' using errcode='23514'; end if;
    if new.payment_status<>'pending' or new.payment_paid_at is not null or new.payout_status<>'not_eligible' or new.fulfillment_status<>'awaiting_payment' then
      raise exception 'Canonical initial financial state required.' using errcode='23514'; end if;
    return new;
  end if;
  if new.payment_status is distinct from old.payment_status then
    if old.payment_status<>'pending' or new.payment_status<>'paid' or old.lifecycle_status<>'open'
      or new.lifecycle_status<>'open' or not old.holds_listing or old.money_status<>'finalized'
      or new.payment_paid_at is null or new.payment_paid_at>=old.reservation_expires_at
      or old.payment_paid_at is not null or new.payout_status<>'not_eligible'
      or new.fulfillment_status<>'awaiting_fulfillment'
      or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
        is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at']) then
      raise exception 'Invalid financial transition.' using errcode='23514'; end if;
    return new;
  end if;
  if (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','expired_at','buyer_id','seller_id'])
    is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','expired_at','buyer_id','seller_id']) then
    raise exception 'Order identity, terms, money and deadlines are immutable.' using errcode='23514'; end if;
  if new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id))
    or new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Order participant cannot change.' using errcode='23514'; end if;
  if new.lifecycle_status=old.lifecycle_status then
    if (to_jsonb(new)-array['buyer_id','seller_id','updated_at']) is distinct from (to_jsonb(old)-array['buyer_id','seller_id','updated_at']) then
      raise exception 'Order lifecycle transition required.' using errcode='23514'; end if;
  elsif old.payment_status='paid' or old.lifecycle_status<>'open' or new.lifecycle_status<>'expired' or old.reservation_expires_at is null or old.reservation_expires_at>clock_timestamp() then
    raise exception 'Invalid Order transition.' using errcode='23514'; end if;
  return new;
end; $$;

create or replace function marketplace_private.settle_listing_reservation(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; t timestamptz;
begin
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing for update;
  if not found then return; end if;
  t:=clock_timestamp();
  if o.payment_status<>'paid' and o.reservation_expires_at<=t then
    update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
    update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
  end if;
end; $$;

create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
  if tg_op='INSERT' then kind:='order_created'; happened:=new.created_at;
  elsif new.payment_status='paid' and old.payment_status<>'paid' then kind:='payment_paid'; happened:=new.payment_paid_at;
  elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
  else kind:='reservation_expired'; happened:=new.expired_at; end if;
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.request_id,new.id,case when kind='order_created' then auth.uid() when kind='payment_paid' then new.buyer_id end,
      case when kind in('order_created','payment_paid') then 'buyer' else 'system' end,kind,happened,new.id::text||':'||kind,
      jsonb_build_object('orderId',new.id)||case when kind='payment_paid' then jsonb_build_object('source','staging_simulator') else '{}'::jsonb end);
  perform marketplace_private.notify_order_history(new.conversation_id);
  return new;
end; $$;

-- service_role-only RPC, authenticated Buyer identity resolved by the server.
-- Denial envelopes commit legitimate lazy expiry; raising after expiry would undo it.
create function public.marketplace_simulate_order_payment_success(p_order_id uuid,p_buyer_id uuid,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; l public.listings; cmd marketplace_private.order_commands;
  t timestamptz; digest text; method_status text;
begin
  if (select auth.jwt()->>'role') is distinct from 'service_role'
    or (select auth.jwt()->>'ref') is distinct from 'pcaqxezdfxofysghssyo' then
    raise exception 'Staging trusted transition required.' using errcode='42501'; end if;
  if p_buyer_id is null or not exists(select 1 from auth.users where id=p_buyer_id
    and email_confirmed_at is not null and lower(email) ~ '^[^[:space:]@]+@uwo[.]ca$') then
    raise exception 'Verified Buyer required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found or o.buyer_id is distinct from p_buyer_id then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  digest:=encode(sha256(convert_to(p_order_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text||'simulate_payment'||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=p_buyer_id
    and action='simulate_payment' and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused.' using errcode='23505'; end if;
    select * into o from public.orders where id=cmd.order_id;
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  -- Same Phase C capability lock namespace, for Buyer's method only. No new Seller gate.
  perform marketplace_private.lock_financial_capability(p_buyer_id,'payment_method');
  select status into method_status from marketplace_private.financial_capabilities
    where user_id=p_buyer_id and capability='payment_method' for update;
  -- Matches every expiry/Accept inventory path: Listing before Order.
  perform 1 from public.listings where id=o.listing_id for update;
  perform marketplace_private.settle_listing_reservation(o.listing_id);
  select * into o from public.orders where id=p_order_id for update;
  select * into l from public.listings where id=o.listing_id;
  if o.buyer_id is distinct from p_buyer_id then raise exception 'Order not accessible.' using errcode='42501'; end if;
  if o.payment_status='paid' then
    insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
      values(p_buyer_id,'simulate_payment',p_client_action_id,digest,o.request_id,o.id);
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  t:=clock_timestamp();
  -- Recheck deadline AFTER acquiring locks, never trust the browser countdown.
  if o.lifecycle_status<>'open' or o.payment_status<>'pending' or o.money_status<>'finalized'
    or o.total_amount_cents is null or not o.holds_listing or l.status<>'reserved'
    or l.reserved_order_id is distinct from o.id or o.reservation_expires_at is null
    or o.reservation_expires_at<=t then
    -- Deadline may have crossed between settlement and this final eligibility check.
    perform marketplace_private.settle_listing_reservation(o.listing_id);
    return jsonb_build_object('errorCode','order_not_payment_ready');
  end if;
  if method_status is distinct from 'set' then
    return jsonb_build_object('errorCode','buyer_payment_method_not_ready'); end if;
  update public.orders set payment_status='paid',payment_paid_at=t,
    fulfillment_status='awaiting_fulfillment',updated_at=t where id=o.id returning * into o;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(p_buyer_id,'simulate_payment',p_client_action_id,digest,o.request_id,o.id);
  return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
end; $$;
revoke all on function public.marketplace_simulate_order_payment_success(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_simulate_order_payment_success(uuid,uuid,uuid) to service_role;
commit;

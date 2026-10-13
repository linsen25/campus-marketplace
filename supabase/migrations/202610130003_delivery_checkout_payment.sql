-- One shared V2 payment authority; legacy campus table/RPC names remain compatible.
begin;
alter table public.orders drop constraint orders_paid_inventory_check;
alter table public.orders add constraint orders_paid_inventory_check check(
 payment_status<>'paid' or (lifecycle_status='open' and holds_listing and (
 (order_protocol_version=1 and money_status='finalized') or
 (order_protocol_version=2 and terms_snapshot->'terms'->>'fulfillment' in('on_campus','delivery') and money_status='v2_pending'))));
create table marketplace_private.delivery_checkouts (
 order_id uuid primary key references public.orders(id) on delete restrict,
 checkout_claim_deadline_at timestamptz,
 checkout_started_at timestamptz,
 payment_deadline_at timestamptz,
 address_snapshot jsonb,
 address_frozen_at timestamptz,
 expired_at timestamptz,
 check((checkout_started_at is null)=(payment_deadline_at is null)),
 check(payment_deadline_at=checkout_started_at+interval '30 minutes'),
 check(address_frozen_at is null or address_snapshot is not null),
 check(checkout_claim_deadline_at is not null or checkout_started_at is not null)
);
alter table marketplace_private.delivery_checkouts enable row level security;
alter table marketplace_private.campus_inspections enable row level security;
alter table marketplace_private.campus_payment_attempts enable row level security;
revoke all on marketplace_private.delivery_checkouts from public,anon,authenticated,service_role;

create function marketplace_private.initialize_delivery_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.order_protocol_version=2 and new.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 if new.terms_snapshot->>'senderId'=new.seller_origin_id::text then
 insert into marketplace_private.delivery_checkouts(order_id,checkout_started_at,payment_deadline_at)
 values(new.id,new.accepted_at,new.accepted_at+interval '30 minutes');
 else
 insert into marketplace_private.delivery_checkouts(order_id,checkout_claim_deadline_at)
 values(new.id,new.accepted_at+interval '12 hours');
 end if;
 end if;return new;
end;$$;
create trigger orders_initialize_delivery after insert on public.orders
for each row execute function marketplace_private.initialize_delivery_checkout();

create function marketplace_private.normalize_checkout_address(v jsonb,area jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare code text;province text;country text;city text;street text;
begin
 if v is null or jsonb_typeof(v)<>'object' or
 (v-array['country_code','province_code','city','postal_code','street','unit','recipient_name','instructions'])<>'{}'::jsonb
 or jsonb_typeof(v->'country_code') is distinct from 'string' or jsonb_typeof(v->'province_code') is distinct from 'string'
 or jsonb_typeof(v->'city') is distinct from 'string' or jsonb_typeof(v->'postal_code') is distinct from 'string'
 or jsonb_typeof(v->'street') is distinct from 'string'
 or (v?'unit' and jsonb_typeof(v->'unit') is distinct from 'string')
 or (v?'recipient_name' and jsonb_typeof(v->'recipient_name') is distinct from 'string')
 or (v?'instructions' and jsonb_typeof(v->'instructions') is distinct from 'string') then
 raise exception 'Private structured checkout address required.' using errcode='23514';end if;
 country:=upper(btrim(v->>'country_code'));province:=upper(btrim(v->>'province_code'));
 code:=upper(regexp_replace(v->>'postal_code','[[:space:]]','','g'));
 city:=btrim(v->>'city');street:=btrim(v->>'street');
 if code !~ '^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9]$'
 or country is distinct from area->>'country_code' or province is distinct from area->>'province_code'
 or left(code,3) is distinct from area->>'postal_prefix' then
 raise exception 'Checkout address does not match the accepted Delivery area.' using errcode='23514';end if;
 if char_length(city) not between 1 and 120 or char_length(street) not between 1 and 250
 or char_length(coalesce(v->>'unit',''))>80 or char_length(coalesce(v->>'recipient_name',''))>120
 or char_length(coalesce(v->>'instructions',''))>1000 then
 raise exception 'Invalid private address fields.' using errcode='23514';end if;
 return v||jsonb_build_object('country_code',country,'province_code',province,'city',city,'street',street,'postal_code',code);
end;$$;

create function public.marketplace_delivery_checkout(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;c marketplace_private.delivery_checkouts;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then
 raise exception 'Order not accessible.' using errcode='42501';end if;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id;
 if not found then raise exception 'Delivery Order required.' using errcode='23514';end if;
 return jsonb_build_object('orderId',o.id,'area',o.terms_snapshot->'terms'->'delivery_area',
 'checkoutClaimDeadlineAt',c.checkout_claim_deadline_at,'checkoutStartedAt',c.checkout_started_at,'paymentDeadlineAt',c.payment_deadline_at,
 'addressFrozen',c.address_frozen_at is not null,'address',case when o.buyer_id=auth.uid() or o.payment_status='paid' then c.address_snapshot end,
 'economics',marketplace_private.v2_order_money(o.id),'serverTime',clock_timestamp());
end;$$;

create function public.marketplace_start_delivery_checkout(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;c marketplace_private.delivery_checkouts;t timestamptz;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer Order required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id for update;
 if c.order_id is null then raise exception 'Delivery Order required.' using errcode='23514';end if;
 if o.lifecycle_status<>'open' or not o.holds_listing then raise exception 'Order is no longer open.' using errcode='23505';end if;
 if c.checkout_started_at is not null then return public.marketplace_delivery_checkout(o.id);end if;
 t:=clock_timestamp();
 if c.checkout_claim_deadline_at<=t then raise exception 'Checkout claim deadline passed.' using errcode='23505';end if;
 update marketplace_private.delivery_checkouts set checkout_started_at=t,payment_deadline_at=t+interval '30 minutes' where order_id=o.id;
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_delivery_checkout(o.id);
end;$$;
create function public.marketplace_save_delivery_address(p_order_id uuid,p_address jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;c marketplace_private.delivery_checkouts;v jsonb;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer Order required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id for update;
 if c.order_id is null or c.checkout_started_at is null then raise exception 'Start Delivery checkout first.' using errcode='23514';end if;
 if o.lifecycle_status<>'open' or o.payment_status not in('pending','failed') or c.address_frozen_at is not null or c.payment_deadline_at<=clock_timestamp() then
 raise exception 'Address cannot be edited after payment starts or checkout expires.' using errcode='23505';end if;
 v:=marketplace_private.normalize_checkout_address(p_address,o.terms_snapshot->'terms'->'delivery_area');
 update marketplace_private.delivery_checkouts set address_snapshot=v where order_id=o.id;
 -- No exact address in transaction events, notifications, or Realtime.
 return public.marketplace_delivery_checkout(o.id);
end;$$;

create function marketplace_private.settle_delivery_checkout(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;c marketplace_private.delivery_checkouts;t timestamptz;
begin
 perform 1 from public.listings where id=p_listing for update;
 select * into o from public.orders where listing_id=p_listing and order_protocol_version=2 and holds_listing for update;
 if o.id is null or o.lifecycle_status<>'open' or o.payment_status not in('pending','failed') then return;end if;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id for update;
 if c.order_id is null then return;end if;t:=clock_timestamp();
 if (c.checkout_started_at is null and c.checkout_claim_deadline_at<=t) or c.payment_deadline_at<=t then
 update marketplace_private.delivery_checkouts set expired_at=t where order_id=o.id;
 update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
 update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
 end if;
end;$$;

alter table public.orders drop constraint orders_v2_foundation;
alter table public.orders add constraint orders_v2_foundation check((order_protocol_version=1 and listing_snapshot is null)
 or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)='object' and money_status='v2_pending' and service_fee_rule_version='not_finalized_v2'
 and service_fee_amount_cents is null and total_amount_cents is null and payout_status='not_eligible'
 and ((payment_status='pending' and payment_paid_at is null and fulfillment_status='awaiting_payment')
 or(terms_snapshot->'terms'->>'fulfillment' in('on_campus','delivery') and
 ((payment_status in('processing','failed') and payment_paid_at is null and fulfillment_status='awaiting_payment')
 or(payment_status='paid' and payment_paid_at is not null and fulfillment_status='awaiting_fulfillment' and lifecycle_status='open' and holds_listing)))) and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null
 and((lifecycle_status='open' and holds_listing and reservation_ended_at is null and expired_at is null)
 or(lifecycle_status='cancelled' and not holds_listing and reservation_ended_at=cancelled_at and expired_at is null)
 or(lifecycle_status='expired' and terms_snapshot->'terms'->>'fulfillment' in('on_campus','delivery') and not holds_listing and expired_at is not null and reservation_ended_at=expired_at and cancelled_at is null))));

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin

 if tg_op='UPDATE' and old.order_protocol_version=2 and old.terms_snapshot->'terms'->>'fulfillment'='delivery' and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if old.payment_status not in('pending','failed') or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.expired_at=new.expired_at and
 ((c.checkout_started_at is null and c.checkout_claim_deadline_at<=new.expired_at) or c.payment_deadline_at<=new.expired_at)) then
 raise exception 'Authoritative Delivery expiry receipt required.' using errcode='23514';end if;return new;end if;
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions mr on mr.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=mr.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and mr.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

  if tg_op='UPDATE' and old.order_protocol_version=2 and new.payment_status is distinct from old.payment_status then
   if old.lifecycle_status<>'open' or new.lifecycle_status<>'open' or not old.holds_listing
    or old.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery')
    or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
      is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
    or not ((old.terms_snapshot->'terms'->>'fulfillment'='on_campus' and exists(select 1 from marketplace_private.campus_inspections where order_id=old.id)) or (old.terms_snapshot->'terms'->>'fulfillment'='delivery' and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.address_frozen_at is not null and c.address_snapshot is not null)))
    or not exists(select 1 from marketplace_private.campus_payment_attempts a where a.order_id=old.id and a.status=new.payment_status
      and ((old.payment_status in('pending','failed') and new.payment_status='processing' and a.finished_at is null and auth.uid()=old.buyer_id)
        or(old.payment_status='processing' and new.payment_status in('paid','failed') and a.finished_at is not null
          and (auth.jwt()->>'role')='service_role' and (auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'
          and (new.payment_status<>'paid' or new.payment_paid_at=a.finished_at))))
    or new.fulfillment_status<>(case when new.payment_status='paid' then 'awaiting_fulfillment' else 'awaiting_payment' end)
    then raise exception 'Trusted V2 payment receipt required.' using errcode='42501';end if;return new;
  end if;
  if tg_op<>'DELETE' and new.order_protocol_version=2 then
   if tg_op='INSERT' then
    select * into r from public.order_requests where id=new.request_id;
    if r.protocol_version<>2 or r.status<>'active' or r.recipient_user_id is distinct from auth.uid()
    or new.buyer_id is distinct from r.buyer_id or new.seller_id is distinct from r.seller_id
    or new.buyer_origin_id<>r.buyer_origin_id or new.seller_origin_id<>r.seller_origin_id
    or new.listing_id<>r.listing_id or new.listing_origin_id<>r.listing_origin_id or new.conversation_id<>r.conversation_id
    or new.terms_snapshot->'terms' is distinct from r.offer_terms or new.item_amount_cents<>r.item_amount_cents
    or not exists(select 1 from marketplace_private.offer_accept_commands x where x.order_id=new.id and x.offer_id=r.id and x.actor_key=auth.uid())
    then raise exception 'Atomic recipient V2 Order required.' using errcode='42501';end if;
    return new;
   end if;
   if old.order_protocol_version<>2 then raise exception 'Order protocol immutable.' using errcode='42501';end if;
   if new.lifecycle_status='cancelled' and old.lifecycle_status='open'
    and old.payment_status in('pending','failed') and new.cancelled_by=auth.uid()
    and new.cancelled_by_role=(case when old.buyer_id=auth.uid() then 'buyer' when old.seller_id=auth.uid() then 'seller' end)
    and new.cancelled_at is not null and not new.holds_listing and new.reservation_ended_at=new.cancelled_at
    and (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
      is not distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
    then return new;end if;
   if (to_jsonb(new)-array['updated_at','buyer_id','seller_id']) is distinct from (to_jsonb(old)-array['updated_at','buyer_id','seller_id'])
    or (new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)))
    or (new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)))
    then raise exception 'V2 Order snapshot/state immutable in C2.' using errcode='42501';end if;
   return new;
  end if;
  if tg_op='UPDATE' and new.order_protocol_version is distinct from old.order_protocol_version then
   raise exception 'Order protocol immutable.' using errcode='42501';end if;
  if tg_op='DELETE' then raise exception 'Order history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='INSERT' then
    if new.cancelled_at is not null or new.cancelled_by is not null or new.cancelled_by_role is not null or new.cancel_reason_code is not null or new.cancel_reason_label_snapshot is not null or new.cancel_note is not null then
      raise exception 'Canonical initial cancellation state required.' using errcode='23514'; end if;
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
  if new.lifecycle_status='cancelled' and old.lifecycle_status='open' then
    if old.payment_status not in('pending','failed') or old.payment_paid_at is not null
      or auth.uid() is null or (old.buyer_id is distinct from auth.uid() and old.seller_id is distinct from auth.uid())
      or new.cancelled_by is distinct from auth.uid()
      or new.cancelled_by_role is distinct from (case when old.buyer_id=auth.uid() then 'buyer' else 'seller' end)
      or new.cancelled_at is null or new.expired_at is not null or new.holds_listing
      or (old.holds_listing and (new.cancelled_at>=old.reservation_expires_at or new.reservation_ended_at is distinct from new.cancelled_at))
      or (not old.holds_listing and new.reservation_ended_at is not null)
      or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
        is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note']) then
      raise exception 'Invalid Order cancellation.' using errcode='23514'; end if;
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

create function public.marketplace_start_order_payment(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;method text;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_payment'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery') then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into a from marketplace_private.campus_payment_attempts where buyer_id=auth.uid() and command=p_client_action_id;
 if found and a.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 -- Match legacy V1 capability -> Listing -> Order, including stale V1 retries on a reused Listing.
 perform marketplace_private.lock_financial_capability(auth.uid(),'payment_method');
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into l from public.listings where id=o.listing_id;
 if a.id is not null then return jsonb_build_object('attemptId',a.id,'status',a.status);end if;
 -- A browser restart may lose its command. Reconcile the existing protected attempt,
 -- never create another attempt or require a new payment-method authorization.
 if o.lifecycle_status='open' and o.holds_listing and o.payment_status='processing' and o.buyer_id=auth.uid() then
  select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and buyer_id=auth.uid() and status='processing';
  if a.id is null then raise exception 'Protected attempt missing.' using errcode='23514';end if;
  return jsonb_build_object('attemptId',a.id,'status',a.status);
 end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending' or l.reserved_order_id is distinct from o.id or o.payment_status not in('pending','failed')
 or o.buyer_id is distinct from auth.uid() then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if o.terms_snapshot->'terms'->>'fulfillment'='on_campus' then
 if not exists(select 1 from marketplace_private.campus_inspections where order_id=o.id and buyer_id=auth.uid()) then raise exception 'Buyer inspection required.' using errcode='23514';end if;
 else
 perform 1 from marketplace_private.delivery_checkouts where order_id=o.id and checkout_started_at is not null and payment_deadline_at>clock_timestamp() and address_snapshot is not null for update;
 if not found then raise exception 'Valid checkout and matching private address required.' using errcode='23514';end if;
 end if;
 perform marketplace_private.v2_order_money(o.id);
 -- Capability is rechecked at actual payment initiation; inspection has no capability gate.
 select status into method from marketplace_private.financial_capabilities where user_id=auth.uid() and capability='payment_method' for update;
 if method is distinct from 'set' then return jsonb_build_object('errorCode','buyer_payment_method_not_ready');end if;
 t:=clock_timestamp();
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 update marketplace_private.delivery_checkouts set address_frozen_at=coalesce(address_frozen_at,t) where order_id=o.id;
 end if;
 insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at) values(o.id,auth.uid(),p_client_action_id,'processing',t) returning * into a;
 update public.orders set payment_status='processing',updated_at=t where id=o.id;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','payment_started',t,a.id::text||':payment_started',jsonb_build_object('orderId',o.id,'source','staging_simulator'));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return jsonb_build_object('attemptId',a.id,'status',a.status);
end;$$;

create or replace function public.marketplace_start_campus_payment(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.orders where id=p_order_id and buyer_id=auth.uid() and terms_snapshot->'terms'->>'fulfillment'='on_campus') then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 return public.marketplace_start_order_payment(p_order_id,p_client_action_id);
end;$$;

create or replace function public.marketplace_resolve_campus_payment(p_attempt_id uuid,p_success boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.campus_payment_attempts;t timestamptz;begin
 if (auth.jwt()->>'role') is distinct from 'service_role' or(auth.jwt()->>'ref') is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging authority required.' using errcode='42501';end if;
 if p_success is null then raise exception 'Trusted outcome required.' using errcode='23514';end if;
 select * into a from marketplace_private.campus_payment_attempts where id=p_attempt_id;
 if a.id is null then raise exception 'Attempt not found.' using errcode='23514';end if;
 select * into o from public.orders where id=a.order_id;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=a.order_id for update;
 select * into a from marketplace_private.campus_payment_attempts where id=p_attempt_id for update;
 if a.status<>'processing' then
 if(a.status='paid') is distinct from p_success then raise exception 'Outcome already recorded.' using errcode='23505';end if;
 return jsonb_build_object('status',a.status);end if;
 if o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery') or o.lifecycle_status<>'open' or not o.holds_listing or o.payment_status<>'processing'
 or not exists(select 1 from public.listings where id=o.listing_id and status='pending' and reserved_order_id=o.id) then raise exception 'Protected payment state required.' using errcode='23514';end if;
 t:=clock_timestamp();update marketplace_private.campus_payment_attempts set status=case when p_success then 'paid' else 'failed' end,finished_at=t where id=a.id returning * into a;
 update public.orders set payment_status=a.status,payment_paid_at=case when p_success then t else null end,
 fulfillment_status=case when p_success then 'awaiting_fulfillment' else 'awaiting_payment' end,updated_at=t where id=o.id;
 if not p_success then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,a.buyer_id,'buyer','payment_failed',t,a.id::text||':payment_failed',jsonb_build_object('orderId',o.id,'source','staging_simulator'));
 perform marketplace_private.notify_order_history(o.conversation_id);end if;
 return jsonb_build_object('status',a.status);
end;$$;

create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' and new.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
 values(new.conversation_id,new.request_id,new.id,'system','reservation_expired',new.expired_at,new.id::text||':reservation_expired',jsonb_build_object('orderId',new.id));
 perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
 select new.conversation_id,new.request_id,new.id,'system','order_no_show_expired',new.expired_at,new.id::text||':order_no_show_expired',
 jsonb_build_object('orderId',new.id,'confirmedRevisionId',e.confirmed_id,'graceDeadline',e.deadline,'reason','Meetup was not completed within the allowed grace period.') from marketplace_private.meetup_expiries e where e.order_id=new.id;
 perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
  if tg_op='INSERT' then kind:='order_created'; happened:=new.created_at;
  elsif new.payment_status='paid' and old.payment_status<>'paid' then kind:='payment_paid'; happened:=new.payment_paid_at;
  elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
  elsif new.lifecycle_status='cancelled' then kind:='order_cancelled'; happened:=new.cancelled_at;
  else kind:='reservation_expired'; happened:=new.expired_at; end if;
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.request_id,new.id,
      case when kind='order_cancelled' then new.cancelled_by when kind='order_created' then auth.uid() when kind='payment_paid' then new.buyer_id end,
      case when kind='order_cancelled' then new.cancelled_by_role when kind='order_created' then case when auth.uid()=new.buyer_id then 'buyer' else 'seller' end when kind='payment_paid' then 'buyer' else 'system' end,
      kind,happened,new.id::text||':'||kind,jsonb_build_object('orderId',new.id)||
      case when kind='payment_paid' then jsonb_build_object('source','staging_simulator')
        when kind='order_cancelled' then jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note)
        else '{}'::jsonb end);
  perform marketplace_private.notify_order_history(new.conversation_id);
  return new;
end; $$;

create or replace function marketplace_private.settle_listing_reservation(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; t timestamptz;
begin
 perform marketplace_private.settle_delivery_checkout(p_listing);
 perform marketplace_private.settle_order_meetup(p_listing);
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing and order_protocol_version=1 for update;
  if not found then return; end if;
  t:=clock_timestamp();
  if o.payment_status<>'paid' and o.reservation_expires_at<=t then
    update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
    update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
  end if;
end; $$;

revoke all on function marketplace_private.initialize_delivery_checkout(),marketplace_private.normalize_checkout_address(jsonb,jsonb),
 marketplace_private.settle_delivery_checkout(uuid) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_delivery_checkout(uuid),public.marketplace_start_delivery_checkout(uuid),
 public.marketplace_save_delivery_address(uuid,jsonb),public.marketplace_start_order_payment(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_delivery_checkout(uuid),public.marketplace_start_delivery_checkout(uuid),
 public.marketplace_save_delivery_address(uuid,jsonb),public.marketplace_start_order_payment(uuid,uuid) to authenticated;
commit;

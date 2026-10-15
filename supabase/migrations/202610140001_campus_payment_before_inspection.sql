-- Master flow: secure Buyer payment before On Campus meeting/inspection.
-- New additive migration; no historical inspection receipts or economics rewritten.
-- Staging-only application is enforced by the qualification/application runner.
begin;
create or replace function public.marketplace_start_order_payment(p_order_id uuid,p_client_action_id uuid) returns jsonb
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
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 perform 1 from marketplace_private.delivery_checkouts where order_id=o.id and checkout_started_at is not null and payment_deadline_at>clock_timestamp() and address_snapshot is not null for update;
 if not found then raise exception 'Valid checkout and matching private address required.' using errcode='23514';end if;
 end if;
 perform marketplace_private.v2_order_money(o.id);
 -- Capability is rechecked at actual payment initiation, before fulfillment.
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

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='completed' then
 if old.payment_status<>'paid' or new.holds_listing or new.payout_status<>'eligible' or new.fulfillment_status<>'fulfilled'
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.order_protection p where p.order_id=old.id and p.completed_at=new.reservation_ended_at and p.completed_at>=p.expires_at)
 or exists(select 1 from marketplace_private.protection_cases where order_id=old.id) then raise exception 'Mature unheld Protection receipt required.' using errcode='23514';end if;
 return new;end if;

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
    or not ((old.terms_snapshot->'terms'->>'fulfillment'='on_campus') or (old.terms_snapshot->'terms'->>'fulfillment'='delivery' and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.address_frozen_at is not null and c.address_snapshot is not null)))
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

-- Existing security-definer ownership and ACLs are preserved by CREATE OR REPLACE.
commit;

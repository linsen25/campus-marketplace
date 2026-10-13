-- D1 qualification correction only: unambiguous expiry receipt SQL alias.
-- STAGING pcaqxezdfxofysghssyo; applied 005 remains immutable.
begin;
create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions mr on mr.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=mr.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and mr.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

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
    and old.payment_status='pending' and new.cancelled_by=auth.uid()
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
commit;

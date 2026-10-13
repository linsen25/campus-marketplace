-- V2-C2 staging-only Accept/winner foundation. No D/E timers/payment/fulfillment.
begin;
lock table public.orders in access exclusive mode;
do $$begin
 if exists(select 1 from public.orders o join public.order_requests r on r.id=o.request_id where r.protocol_version<>1
 or o.listing_origin_id<>r.listing_origin_id or o.buyer_origin_id<>r.buyer_origin_id or o.seller_origin_id<>r.seller_origin_id)
 then raise exception 'Legacy Order protocol cannot be proved; stop.' using errcode='23514';end if;
end;$$;
-- Metadata-only default backfill: no historical timestamps/status/event changes.
alter table public.orders add column order_protocol_version integer not null default 1
  check(order_protocol_version in(1,2));
alter table public.orders add column listing_snapshot jsonb;
alter table public.order_requests add column listing_material_hash_at_offer text
  check(listing_material_hash_at_offer ~ '^[0-9a-f]{64}$');
create function marketplace_private.capture_offer_material() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.protocol_version=2 then
  -- Existing identity trigger locks Listing before this last BEFORE INSERT trigger.
  new.listing_material_hash_at_offer:=marketplace_private.listing_media_material_hash(new.listing_id);
 end if;
 return new;
end;$$;
create trigger zz_offer_material_baseline before insert on public.order_requests
for each row execute function marketplace_private.capture_offer_material();

-- Preserve each exact V1 constraint expression; V2 uses its separate foundation contract.
do $$ declare x record;expr text;begin
 for x in select conname,pg_get_expr(conbin,conrelid) expr from pg_constraint
 where conrelid='public.orders'::regclass and conname in
 ('orders_check1','orders_check3','orders_inventory_lifecycle_check','orders_money_status_check',
  'orders_terms_schema_version_check','orders_service_fee_rule_version_check') loop
  execute format('alter table public.orders drop constraint %I',x.conname);
  execute format('alter table public.orders add constraint %I check(order_protocol_version=2 or (%s))',x.conname,x.expr);
 end loop;
end;$$;
alter table public.orders add constraint orders_v2_foundation check(
 (order_protocol_version=1 and listing_snapshot is null)
 or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)='object'
 and money_status='v2_pending' and service_fee_rule_version='not_finalized_v2'
 and service_fee_amount_cents is null and total_amount_cents is null
 and payment_status='pending' and payment_paid_at is null and payout_status='not_eligible'
 and fulfillment_status='awaiting_payment' and created_at=accepted_at
 and reservation_started_at is null and reservation_expires_at is null and expired_at is null
 and ((lifecycle_status='open' and holds_listing and reservation_ended_at is null)
 or(lifecycle_status='cancelled' and not holds_listing and reservation_ended_at=cancelled_at))));

alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check check(status in('available','reserved','pending','sold'));
alter table public.listings drop constraint listings_inventory_pair;
alter table public.listings add constraint listings_inventory_pair check((status in('reserved','pending'))=(reserved_order_id is not null));
create policy listings_pending_participant_read on public.listings for select to authenticated using(
 status='pending' and exists(select 1 from public.orders o where o.id=reserved_order_id and o.holds_listing
 and (o.buyer_id=(select auth.uid()) or o.seller_id=(select auth.uid()))));
-- Existing orders_listing_hold unique index is shared by V1 and V2 winners.
create table marketplace_private.offer_accept_commands(
 actor_key uuid not null,idempotency_key uuid not null,offer_id uuid not null references public.order_requests(id),
 order_id uuid not null references public.orders(id) deferrable initially deferred,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_key,idempotency_key));
alter table marketplace_private.offer_accept_commands enable row level security;
revoke all on marketplace_private.offer_accept_commands from public,anon,authenticated,service_role;

alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in(
 'request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created',
 'reservation_expired','payment_paid','order_cancelled','offer_created','offer_replaced','offer_withdrawn',
 'offer_accepted','offer_closed','listing_pending'));

create function marketplace_private.offer_accept_eligibility(r public.order_requests) returns text
language plpgsql stable security definer set search_path='' as $$
declare l public.listings;begin
 if r.protocol_version<>2 or r.status<>'active' then return 'offer_not_active';end if;
 select * into l from public.listings where id=r.listing_id;
 if l.id is null or l.published_at is null or l.status<>'available' then return 'listing_unavailable';end if;
 if r.offer_terms is null or r.listing_material_hash_at_offer is null
 or r.listing_material_hash_at_offer is distinct from marketplace_private.listing_media_material_hash(l.id)
 then return 'listing_changed';end if;
 if r.item_amount_cents>l.price_cents then return 'asking_price_lower';end if;
 return null;
end;$$;

-- Session-authorized preflight also reconciles retries BEFORE external media work.
create function public.marketplace_offer_accept_preflight(p_offer_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;actor uuid:=auth.uid();cmd marketplace_private.offer_accept_commands;reason text;begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 select * into r from public.order_requests where id=p_offer_id;
 if r.id is null or r.protocol_version<>2 or r.recipient_user_id is distinct from actor or r.sender_user_id=actor
 then raise exception 'V2 Offer recipient required.' using errcode='42501';end if;
 select * into cmd from marketplace_private.offer_accept_commands where actor_key=actor and idempotency_key=p_client_action_id;
 if found then
  if cmd.offer_id<>r.id then raise exception 'Action UUID reused.' using errcode='23505';end if;
  return jsonb_build_object('orderId',cmd.order_id);
 end if;
 reason:=marketplace_private.offer_accept_eligibility(r);
 if reason is not null then return jsonb_build_object('errorCode',reason);end if;
 perform marketplace_private.require_seller_payout_ready(r.seller_id);
 return jsonb_build_object('ready',true);
end;$$;

-- Final authority: command -> capability -> Listing -> sorted Offers -> media -> Order.
create function public.marketplace_accept_offer(p_offer_id uuid,p_client_action_id uuid,p_media_batch uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r public.order_requests;c public.conversations;l public.listings;
 o public.orders;cmd marketplace_private.offer_accept_commands;oid uuid:=gen_random_uuid();t timestamptz;reason text;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'accept_offer'||p_client_action_id::text,0));
 select * into cmd from marketplace_private.offer_accept_commands where actor_key=actor and idempotency_key=p_client_action_id;
 if found then
  if cmd.offer_id<>p_offer_id then raise exception 'Action UUID reused.' using errcode='23505';end if;
  select * into o from public.orders where id=cmd.order_id;return o;
 end if;
 select * into r from public.order_requests where id=p_offer_id;
 if r.id is null or r.protocol_version<>2 or r.recipient_user_id is distinct from actor or r.sender_user_id=actor
 then raise exception 'V2 Offer recipient required.' using errcode='42501';end if;
 perform marketplace_private.require_seller_payout_ready(r.seller_id);
 select * into l from public.listings where id=r.listing_id for update;
 -- Shared Listing lock serializes all A2 mutations and V1 Accept. Stable row order closes all conversations.
 perform 1 from public.order_requests where listing_id=l.id and protocol_version=2 and status='active' order by id for update;
 select * into r from public.order_requests where id=p_offer_id for update;
 select * into c from public.conversations where id=r.conversation_id;
 if c.buyer_id is null or c.seller_id is null or r.recipient_user_id is distinct from actor or r.sender_user_id=actor or c.buyer_id is distinct from r.buyer_id
 or c.seller_id is distinct from r.seller_id or l.seller_id is distinct from r.seller_id
 or c.listing_id is distinct from l.id or c.listing_origin_id is distinct from r.listing_origin_id
 then raise exception 'Offer relationship changed.' using errcode='42501';end if;
 reason:=marketplace_private.offer_accept_eligibility(r);
 if reason is not null then raise exception '%',reason using errcode='23505';end if;
 -- A forged/reused batch cannot reach Order creation; C1 binding rechecks completeness and current material.
 if not exists(select 1 from marketplace_private.order_media_batches b where b.id=p_media_batch and b.offer_id=r.id
 and b.actor_id=actor and b.listing_id=l.id and b.material_hash=r.listing_material_hash_at_offer)
 then raise exception 'Exact prepared media required.' using errcode='42501';end if;
 t:=clock_timestamp();
 insert into marketplace_private.offer_accept_commands(actor_key,idempotency_key,offer_id,order_id) values(actor,p_client_action_id,r.id,oid);
 insert into public.orders(id,order_protocol_version,request_id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,
 buyer_origin_id,seller_origin_id,terms_schema_version,terms_snapshot,listing_snapshot,item_amount_cents,shipping_amount_cents,
 money_status,service_fee_rule_version,holds_listing,created_at,updated_at,accepted_at)
 values(oid,2,r.id,c.id,l.id,r.listing_origin_id,r.buyer_id,r.seller_id,r.buyer_origin_id,r.seller_origin_id,2,
 jsonb_build_object('offerId',r.id,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id,'terms',r.offer_terms,
 'termsVersion',2,'acceptedAt',t,'buyerName',r.buyer_username_snapshot,'sellerName',r.seller_username_snapshot),
 jsonb_build_object('listingId',l.id,'title',l.title,'description',l.description,'category',l.category,'subcategory',l.subcategory,
 'condition',l.condition,'askingPriceCents',l.price_cents,'currency',l.currency,'sellerId',l.seller_id,
 'materialHash',r.listing_material_hash_at_offer,'mediaBatchId',p_media_batch),r.item_amount_cents,
 case when r.offer_terms->>'fulfillment'='delivery' then (r.offer_terms->>'delivery_fee_cents')::bigint else 0 end,
 'v2_pending','not_finalized_v2',true,t,t,t) returning * into o;
 perform marketplace_private.bind_order_media(p_media_batch,oid);
 update public.order_requests set status='accepted',accepted_at=t,updated_at=t where id=r.id;
 update public.listings set status='pending',reserved_order_id=oid where id=l.id;
 update public.order_requests set status='closed',closed_at=t,updated_at=t where listing_id=l.id and protocol_version=2 and status='active';
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(c.id,r.id,oid,actor,case when actor=r.buyer_id then 'buyer' else 'seller' end,'listing_pending',t,
 oid::text||':listing_pending',jsonb_build_object('orderId',oid));
 return o;
end;$$;

revoke all on function marketplace_private.capture_offer_material(),marketplace_private.offer_accept_eligibility(public.order_requests)
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_offer_accept_preflight(uuid,uuid),public.marketplace_accept_offer(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_offer_accept_preflight(uuid,uuid),public.marketplace_accept_offer(uuid,uuid,uuid) to authenticated;
-- Compatibility trigger/RPC definitions follow; no applied A1/A2/B/C1 files are edited.

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin

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

create or replace function marketplace_private.protect_listing_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin

 if tg_op<>'DELETE' and (new.status='pending' or old.status='pending') then
  if new.status='pending' then
   if old.reserved_order_id is not null and new.reserved_order_id is distinct from old.reserved_order_id
    or not exists(select 1 from public.orders o where o.id=new.reserved_order_id and o.order_protocol_version=2
    and o.listing_id=new.id and o.seller_id=new.seller_id and o.holds_listing and o.lifecycle_status='open')
    then raise exception 'Server V2 winner required.' using errcode='42501';end if;
   return new;
  end if;
  if new.status<>'available' or new.reserved_order_id is not null
   or exists(select 1 from public.orders where id=old.reserved_order_id and holds_listing)
   then raise exception 'Server V2 release required.' using errcode='42501';end if;
  return new;
 end if;
  if tg_op='DELETE' then
    if old.reserved_order_id is not null then raise exception 'Reserved inventory cannot be deleted.' using errcode='23514'; end if;
    return old;
  end if;
  -- Stored generated columns are unset in NEW during BEFORE triggers.
  if old.reserved_order_id is not null and (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text'])
    is distinct from (to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text']) then
    raise exception 'Reserved inventory cannot be edited.' using errcode='23514'; end if;
  if new.status='reserved' then
    if not exists(select 1 from public.orders o where o.id=new.reserved_order_id and o.listing_id=new.id
      and o.holds_listing and o.lifecycle_status='open' and o.seller_id=new.seller_id) then
      raise exception 'Server Order inventory claim required.' using errcode='23514'; end if;
    if old.reserved_order_id is not null and new.reserved_order_id<>old.reserved_order_id then
      raise exception 'Cannot reassign a reservation.' using errcode='23514'; end if;
  elsif old.reserved_order_id is not null then
    if new.status<>'available' or new.reserved_order_id is not null or exists(select 1 from public.orders where id=old.reserved_order_id and holds_listing) then
      raise exception 'Server reservation release required.' using errcode='23514'; end if;
  elsif new.reserved_order_id is not null then raise exception 'Invalid inventory pointer.' using errcode='23514'; end if;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION marketplace_private.protect_order_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Request history cannot be deleted.' using errcode='23514'; end if;
  if (to_jsonb(new) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at'])
    is distinct from (to_jsonb(old) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at']) then
    raise exception 'Request identity and terms are immutable.' using errcode='23514';
  end if;
  if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)) then
    raise exception 'Buyer cannot change.' using errcode='23514'; end if;
  if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Seller cannot change.' using errcode='23514'; end if;
  if old.protocol_version=2 and new.status is distinct from old.status then
    if old.status<>'active' or not (
      (new.status='accepted' and auth.uid()=old.recipient_user_id and exists(select 1 from public.orders o
       join marketplace_private.offer_accept_commands x on x.order_id=o.id where o.request_id=old.id and o.order_protocol_version=2
       and o.accepted_at=new.accepted_at and x.actor_key=auth.uid()))
      or(new.status='closed' and exists(select 1 from public.orders o join marketplace_private.offer_accept_commands x on x.order_id=o.id
       where o.listing_id=old.listing_id and o.order_protocol_version=2 and o.holds_listing and o.lifecycle_status='open' and x.actor_key=auth.uid()))
      or(new.status='superseded' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='create' and x.previous_offer_id=old.id and x.offer_id=new.replacement_request_id))
      or(new.status='withdrawn' and auth.uid()=old.sender_user_id and new.withdrawn_by=auth.uid() and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='withdraw' and x.offer_id=old.id))) then
      raise exception 'V2 mutation authority required.' using errcode='42501'; end if;
    return new;
  end if;
  if new.status = old.status then
    if (to_jsonb(new) - array['buyer_id','seller_id','updated_at']) is distinct from (to_jsonb(old) - array['buyer_id','seller_id','updated_at']) then
      raise exception 'Lifecycle cannot change without a transition.' using errcode='23514'; end if;
  elsif old.status <> 'active' or new.status not in ('superseded','cancelled','expired','accepted') then
    raise exception 'Invalid Request transition.' using errcode='23514';
  end if;
  if new.status='accepted' and old.status='active' and (auth.uid() is distinct from new.buyer_id or not exists(select 1 from public.orders o where o.request_id=new.id and o.accepted_at=new.accepted_at and o.buyer_id=new.buyer_id)) then
    raise exception 'Atomic Buyer Order required.' using errcode='23514'; end if;
  return new;
end; $function$;
create or replace function marketplace_private.emit_offer_event(r public.order_requests, previous_status text) returns public.order_requests
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz; member record; details jsonb; actor uuid:=auth.uid();
begin
 if previous_status is null then kind:='offer_created';happened:=r.created_at;
 elsif r.status=previous_status then return r;
 elsif r.status='superseded' then kind:='offer_replaced';happened:=r.replaced_at;
 elsif r.status='withdrawn' then kind:='offer_withdrawn';happened:=r.withdrawn_at;
 elsif r.status='accepted' then kind:='offer_accepted';happened:=r.accepted_at;
 elsif r.status='closed' then kind:='offer_closed';happened:=r.closed_at;
 else raise exception 'Unsupported Offer event.' using errcode='42501';end if;
 if actor is null or(kind<>'offer_closed' and actor is distinct from r.buyer_id and actor is distinct from r.seller_id) then raise exception 'Offer actor required.' using errcode='42501';end if;
 details:=jsonb_build_object('protocolVersion',2,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id);
 if kind='offer_accepted' then details:=details||jsonb_build_object('orderId',(select id from public.orders where request_id=r.id));end if;
 if kind='offer_replaced' then details:=details||jsonb_build_object('replacementOfferId',r.replacement_request_id);end if;
 if kind='offer_created' then details:=details||jsonb_build_object('previousOfferId',(select previous_offer_id from marketplace_private.offer_commands where offer_id=r.id and action='create'));end if;
 if kind='offer_withdrawn' then details:=details||jsonb_build_object('note',r.withdrawal_note);end if;
 insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(r.conversation_id,r.id,actor,case when kind='offer_closed' then (select case when actor=o.buyer_id then 'buyer' else 'seller' end from public.orders o where o.listing_id=r.listing_id and o.holds_listing) when actor=r.buyer_id then 'buyer' else 'seller' end,kind,happened,r.id::text||':'||kind,details);
 begin
 for member in select members.id,members.role from public.conversations c cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
 join auth.users u on u.id=members.id where c.id=r.conversation_id and u.email_confirmed_at is not null and lower(u.email)~'^[^[:space:]@]+@uwo[.]ca$'
 loop perform realtime.send(jsonb_build_object('conversationId',r.conversation_id,'role',member.role,'scope','history'),'messages_changed','marketplace:messages:'||member.id::text,true);end loop;
 exception when others then raise log 'Offer invalidation skipped; SQLSTATE=%',sqlstate;end;
 return r;
end;$$;

create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
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
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing and order_protocol_version=1 for update;
  if not found then return; end if;
  t:=clock_timestamp();
  if o.payment_status<>'paid' and o.reservation_expires_at<=t then
    update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
    update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
  end if;
end; $$;

create or replace function public.marketplace_simulate_order_payment_success(p_order_id uuid,p_buyer_id uuid,p_client_action_id uuid)
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
  if o.order_protocol_version<>1 then raise exception 'V1 payment protocol required.' using errcode='42501';end if;
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

create or replace function public.marketplace_cancel_order(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; actor uuid:=auth.uid(); actor_role text; label text;
  note text:=btrim(coalesce(p_note,'')); t timestamptz; digest text; cmd marketplace_private.order_commands;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found or (o.buyer_id is distinct from actor and o.seller_id is distinct from actor) then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  actor_role:=case when o.buyer_id=actor then 'buyer' else 'seller' end;
  label:=case
    when p_reason='other' then 'Other'
    when actor_role='buyer' then case p_reason
      when 'buyer_changed_mind' then 'Changed my mind'
      when 'buyer_payment_issue' then 'Can''t complete payment'
      when 'buyer_scheduling_issue' then 'Scheduling issue'
      when 'buyer_terms_issue' then 'Item or terms no longer work for me' end
    else case p_reason
      when 'seller_item_unavailable' then 'Item no longer available'
      when 'seller_scheduling_issue' then 'Scheduling issue'
      when 'buyer_requested_cancellation' then 'Buyer requested cancellation'
      when 'seller_terms_issue' then 'Terms need to change' end end;
  if label is null or char_length(note)>1000 or (p_reason='other' and note='') then
    raise exception 'Valid cancellation reason/note required.' using errcode='23514'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_array(p_order_id,p_reason,note)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'cancel_order'||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=actor and action='cancel_order' and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused.' using errcode='23505'; end if;
    select * into o from public.orders where id=cmd.order_id;
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  perform 1 from public.listings where id=o.listing_id for update;
  -- Settle only this Order's own unpaid hold; do not expire an unrelated holder.
  select * into o from public.orders where id=p_order_id for update;
  if o.buyer_id is distinct from actor and o.seller_id is distinct from actor then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  if o.lifecycle_status='cancelled' then
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp()); end if;
  if o.lifecycle_status<>'open' or o.payment_status not in('pending','failed') or o.payment_paid_at is not null then
    return jsonb_build_object('errorCode','order_not_cancellable'); end if;
  if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
  select * into o from public.orders where id=p_order_id for update;
  t:=clock_timestamp();
  if o.lifecycle_status<>'open' or (o.order_protocol_version=1 and o.holds_listing and o.reservation_expires_at<=t) then
    if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
    return jsonb_build_object('errorCode','order_not_cancellable'); end if;
  update public.orders set lifecycle_status='cancelled',holds_listing=false,cancelled_at=t,cancelled_by=actor,
    cancelled_by_role=actor_role,cancel_reason_code=p_reason,cancel_reason_label_snapshot=label,cancel_note=note,
    reservation_ended_at=case when holds_listing then t else null end,updated_at=t where id=o.id returning * into o;
  update public.listings set status='available',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'cancel_order',p_client_action_id,digest,o.request_id,o.id);
  return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
end; $$;

-- Validate references at transaction end, after C1 bind and Offer/Listing transitions.
create function marketplace_private.verify_v2_order_commit() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.orders;begin
 select * into o from public.orders where id=new.id;
 if o.order_protocol_version=2 and (not exists(select 1 from public.order_requests where id=o.request_id and status='accepted' and protocol_version=2)
 or not exists(select 1 from marketplace_private.order_media_batches where order_id=o.id and state='bound')
 or (o.holds_listing and not exists(select 1 from public.listings where id=o.listing_id and status='pending' and reserved_order_id=o.id)))
 then raise exception 'Incomplete V2 transaction.' using errcode='23514';end if;
 return null;
end;$$;
create constraint trigger orders_v2_atomic_commit after insert or update on public.orders
 deferrable initially deferred for each row execute function marketplace_private.verify_v2_order_commit();
revoke all on function marketplace_private.verify_v2_order_commit() from public,anon,authenticated,service_role;

create or replace function public.marketplace_offer_history(p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.conversations;actor uuid:=auth.uid();begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select * into c from public.conversations where id=p_conversation_id;
 if c.id is null or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Conversation not accessible.' using errcode='42501';end if;
 return jsonb_build_object('offers',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'linked_order_id',(select id from public.orders where request_id=r.id and order_protocol_version=2),
 'accept_block_reason',marketplace_private.offer_accept_eligibility(r)) order by r.created_at,r.id)
 from public.order_requests r where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e
 join public.order_requests r on r.id=e.request_id where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb));
end;$$;

commit;

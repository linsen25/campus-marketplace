-- Pre-payment Order cancellation. STAGING pcaqxezdfxofysghssyo ONLY.
-- No Request rewrite, payment transition, provider, handoff or protection changes.
begin;
alter table public.orders add column cancelled_at timestamptz;
alter table public.orders add column cancelled_by uuid;
alter table public.orders add column cancelled_by_role text;
alter table public.orders add column cancel_reason_code text;
alter table public.orders add column cancel_reason_label_snapshot text;
alter table public.orders add column cancel_note text;
alter table public.orders drop constraint orders_lifecycle_status_check;
alter table public.orders add constraint orders_lifecycle_status_check check(lifecycle_status in('open','expired','cancelled'));
alter table public.orders drop constraint orders_check2;
alter table public.orders add constraint orders_inventory_lifecycle_check check(
 (lifecycle_status='open' and holds_listing=(money_status='finalized') and reservation_ended_at is null and expired_at is null)
 or(lifecycle_status='expired' and not holds_listing and reservation_ended_at=expired_at and expired_at is not null)
 or(lifecycle_status='cancelled' and not holds_listing and expired_at is null
   and ((money_status='finalized' and reservation_ended_at=cancelled_at) or(money_status='shipping_pending' and reservation_ended_at is null))));
alter table public.orders add constraint orders_cancellation_check check(
 (lifecycle_status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancelled_by_role is null and cancel_reason_code is null and cancel_reason_label_snapshot is null and cancel_note is null)
 or(lifecycle_status='cancelled' and payment_status in('pending','failed') and payment_paid_at is null
   and cancelled_at is not null and cancelled_by is not null and cancelled_by_role is not null and cancelled_by_role in('buyer','seller')
   and cancel_reason_code is not null
   and cancel_reason_label_snapshot is not null and char_length(cancel_note)<=1000 and cancel_note is not null
   and (cancel_reason_code='other' and char_length(btrim(cancel_note))>0
     or cancelled_by_role='buyer' and cancel_reason_code in('buyer_changed_mind','buyer_payment_issue','buyer_scheduling_issue','buyer_terms_issue')
     or cancelled_by_role='seller' and cancel_reason_code in('seller_item_unavailable','seller_scheduling_issue','buyer_requested_cancellation','seller_terms_issue'))));
alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in('request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired','payment_paid','order_cancelled'));
alter table marketplace_private.order_commands drop constraint order_commands_action_check;
alter table marketplace_private.order_commands add constraint order_commands_action_check check(action in('create','replace','cancel','accept','simulate_payment','cancel_order'));

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
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
      case when kind='order_cancelled' then new.cancelled_by_role when kind in('order_created','payment_paid') then 'buyer' else 'system' end,
      kind,happened,new.id::text||':'||kind,jsonb_build_object('orderId',new.id)||
      case when kind='payment_paid' then jsonb_build_object('source','staging_simulator')
        when kind='order_cancelled' then jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note)
        else '{}'::jsonb end);
  perform marketplace_private.notify_order_history(new.conversation_id);
  return new;
end; $$;

-- Same Listing -> Order lock order as Accept, payment success and expiry.
-- Denial envelope commits legitimate expiry rather than rolling it back.
create function public.marketplace_cancel_order(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid)
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
  if o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
  select * into o from public.orders where id=p_order_id for update;
  t:=clock_timestamp();
  if o.lifecycle_status<>'open' or (o.holds_listing and o.reservation_expires_at<=t) then
    if o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
    return jsonb_build_object('errorCode','order_not_cancellable'); end if;
  update public.orders set lifecycle_status='cancelled',holds_listing=false,cancelled_at=t,cancelled_by=actor,
    cancelled_by_role=actor_role,cancel_reason_code=p_reason,cancel_reason_label_snapshot=label,cancel_note=note,
    reservation_ended_at=case when holds_listing then t else null end,updated_at=t where id=o.id returning * into o;
  update public.listings set status='available',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'cancel_order',p_client_action_id,digest,o.request_id,o.id);
  return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
end; $$;
revoke all on function public.marketplace_cancel_order(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_cancel_order(uuid,text,text,uuid) to authenticated;
commit;



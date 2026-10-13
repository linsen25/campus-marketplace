-- V2-D2A: staging On Campus inspection and trusted test payment only.
-- No provider integration, handoff, Protection, completion or payout release.
begin;
create table marketplace_private.campus_inspections (
 order_id uuid primary key references public.orders(id) on delete restrict,
 buyer_id uuid not null, command uuid not null, confirmed_at timestamptz not null,
 item_cents bigint not null, fee_cents bigint not null, total_cents bigint not null,
 fee_rule text not null check(fee_rule='preview_cad_v1'), unique(buyer_id,command),
 check(item_cents>=0 and fee_cents between 100 and 1500 and total_cents=item_cents+fee_cents and total_cents<=9007199254740991)
);
create table marketplace_private.campus_payment_attempts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
 buyer_id uuid not null, command uuid not null, status text not null check(status in('processing','paid','failed')),
 started_at timestamptz not null, finished_at timestamptz,
 unique(buyer_id,command), check((status='processing')=(finished_at is null)), check(finished_at>=started_at)
);
create unique index campus_one_processing on marketplace_private.campus_payment_attempts(order_id) where status='processing';
create unique index campus_one_paid on marketplace_private.campus_payment_attempts(order_id) where status='paid';
revoke all on marketplace_private.campus_inspections,marketplace_private.campus_payment_attempts from public,anon,authenticated,service_role;
alter table public.orders drop constraint orders_v2_foundation;
alter table public.orders add constraint orders_v2_foundation check((order_protocol_version=1 and listing_snapshot is null)
 or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)='object' and money_status='v2_pending' and service_fee_rule_version='not_finalized_v2'
 and service_fee_amount_cents is null and total_amount_cents is null and payout_status='not_eligible'
 and ((payment_status='pending' and payment_paid_at is null and fulfillment_status='awaiting_payment')
 or(terms_snapshot->'terms'->>'fulfillment'='on_campus' and
 ((payment_status in('processing','failed') and payment_paid_at is null and fulfillment_status='awaiting_payment')
 or(payment_status='paid' and payment_paid_at is not null and fulfillment_status='awaiting_fulfillment' and lifecycle_status='open' and holds_listing)))) and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null
 and((lifecycle_status='open' and holds_listing and reservation_ended_at is null and expired_at is null)
 or(lifecycle_status='cancelled' and not holds_listing and reservation_ended_at=cancelled_at and expired_at is null)
 or(lifecycle_status='expired' and terms_snapshot->'terms'->>'fulfillment'='on_campus' and not holds_listing and expired_at is not null and reservation_ended_at=expired_at and cancelled_at is null))));

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions mr on mr.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=mr.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and mr.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

  if tg_op='UPDATE' and old.order_protocol_version=2 and new.payment_status is distinct from old.payment_status then
   if old.lifecycle_status<>'open' or new.lifecycle_status<>'open' or not old.holds_listing
    or old.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus'
    or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
      is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
    or not exists(select 1 from marketplace_private.campus_inspections where order_id=old.id)
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

-- Read projection excludes command IDs, provider references and payment instruments.
create function public.marketplace_campus_payment_state(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.campus_inspections;m jsonb;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid())
 or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Order not accessible.' using errcode='42501';end if;
 select * into i from marketplace_private.campus_inspections where order_id=o.id;
 m:=marketplace_private.order_money(o.item_amount_cents,0);
 return jsonb_build_object('inspectionConfirmedAt',i.confirmed_at,'itemCents',coalesce(i.item_cents,o.item_amount_cents),
 'feeCents',coalesce(i.fee_cents,(m->>'fee')::bigint),'totalCents',coalesce(i.total_cents,(m->>'total')::bigint),
 'feeRule',coalesce(i.fee_rule,'preview_cad_v1'),'serverTime',clock_timestamp());
end;$$;
create function public.marketplace_confirm_campus_inspection(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.campus_inspections;m jsonb;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_inspection'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into i from marketplace_private.campus_inspections where buyer_id=auth.uid() and command=p_client_action_id;
 if found and i.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 -- All transaction progression shares Listing -> Order. No local countdown authority.
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into i from marketplace_private.campus_inspections where order_id=o.id;
 if found then return public.marketplace_campus_payment_state(o.id);end if;
 if not marketplace_private.meetup_mutable(o) or o.buyer_id is distinct from auth.uid() then raise exception 'Order not inspectable.' using errcode='23505';end if;
 t:=clock_timestamp();m:=marketplace_private.order_money(o.item_amount_cents,0);
 insert into marketplace_private.campus_inspections values(o.id,auth.uid(),p_client_action_id,t,o.item_amount_cents,(m->>'fee')::bigint,(m->>'total')::bigint,'preview_cad_v1');
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','buyer_inspection_confirmed',t,o.id::text||':buyer_inspection_confirmed',jsonb_build_object('orderId',o.id));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_campus_payment_state(o.id);
end;$$;
create function public.marketplace_start_campus_payment(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;method text;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_payment'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into a from marketplace_private.campus_payment_attempts where buyer_id=auth.uid() and command=p_client_action_id;
 if found and a.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into l from public.listings where id=o.listing_id;
 if a.id is not null then return jsonb_build_object('attemptId',a.id,'status',a.status);end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending' or l.reserved_order_id is distinct from o.id or o.payment_status not in('pending','failed')
 or o.buyer_id is distinct from auth.uid() then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if not exists(select 1 from marketplace_private.campus_inspections where order_id=o.id and buyer_id=auth.uid()) then raise exception 'Buyer inspection required.' using errcode='23514';end if;
 -- Capability is rechecked at actual payment initiation; inspection has no capability gate.
 perform marketplace_private.lock_financial_capability(auth.uid(),'payment_method');
 select status into method from marketplace_private.financial_capabilities where user_id=auth.uid() and capability='payment_method' for update;
 if method is distinct from 'set' then return jsonb_build_object('errorCode','buyer_payment_method_not_ready');end if;
 t:=clock_timestamp();insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at) values(o.id,auth.uid(),p_client_action_id,'processing',t) returning * into a;
 update public.orders set payment_status='processing',updated_at=t where id=o.id;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','payment_started',t,a.id::text||':payment_started',jsonb_build_object('orderId',o.id,'source','staging_simulator'));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return jsonb_build_object('attemptId',a.id,'status',a.status);
end;$$;
-- No normal role can forge a payment outcome. Caller is the server's staging simulator.
create function public.marketplace_resolve_campus_payment(p_attempt_id uuid,p_success boolean) returns jsonb
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
 if o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' or o.lifecycle_status<>'open' or not o.holds_listing or o.payment_status<>'processing'
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
revoke all on function public.marketplace_campus_payment_state(uuid),public.marketplace_confirm_campus_inspection(uuid,uuid),public.marketplace_start_campus_payment(uuid,uuid),public.marketplace_resolve_campus_payment(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_campus_payment_state(uuid),public.marketplace_confirm_campus_inspection(uuid,uuid),public.marketplace_start_campus_payment(uuid,uuid) to authenticated;
grant execute on function public.marketplace_resolve_campus_payment(uuid,boolean) to service_role;
alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in(
 'request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired','payment_paid','order_cancelled',
 'offer_created','offer_replaced','offer_withdrawn','offer_accepted','offer_closed','listing_pending','meetup_initial_confirmed','meetup_proposed','meetup_confirmed','meetup_declined','meetup_withdrawn','meetup_superseded','meetup_closed','order_no_show_expired','buyer_inspection_confirmed','payment_started','payment_failed'));
commit;

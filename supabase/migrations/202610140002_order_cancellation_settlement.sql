-- Master Order contract: cancellation intent, delivery effort and settlement authority.
-- Additive and provider-independent. Amounts authorize disposition; no provider execution.
begin;

create table marketplace_private.seller_delivery_starts (
 order_id uuid primary key references public.orders(id), seller_id uuid not null,
 command uuid not null, started_at timestamptz not null, unique(seller_id,command)
);
create table marketplace_private.order_cancellation_intents (
 order_id uuid primary key references public.orders(id), requested_by uuid not null,
 requested_by_role text not null check(requested_by_role in('buyer','seller')),
 requested_at timestamptz not null, reason text not null, note text not null,
 payment_at_request text not null check(payment_at_request in('pending','processing','paid','failed')),
 fulfillment_at_request jsonb not null,
 path text not null check(path in('full_release','delivery_compensation','full_refund_request')),
 state text not null check(state in('payment_pending','awaiting_seller','disputed','finalized')),
 seller_response text check(seller_response in('agree','dispute')),
 seller_responded_at timestamptz, finalized_at timestamptz,
 check((seller_response is null)=(seller_responded_at is null)),
 check((state='finalized')=(finalized_at is not null))
);
create table marketplace_private.order_settlement_authorizations (
 order_id uuid primary key references public.orders(id),
 disposition text not null check(disposition in('full_release','delivery_compensation')),
 secured_cents bigint not null check(secured_cents>=0),
 buyer_release_cents bigint not null check(buyer_release_cents>=0),
 seller_delivery_compensation_cents bigint not null check(seller_delivery_compensation_cents>=0),
 platform_retained_cents bigint not null default 0 check(platform_retained_cents=0),
 platform_reversed_cents bigint not null check(platform_reversed_cents>=0),
 seller_sale_payout_cents bigint not null default 0 check(seller_sale_payout_cents=0),
 authorized_at timestamptz not null,
 check(secured_cents::numeric=buyer_release_cents::numeric+seller_delivery_compensation_cents)
);
create table marketplace_private.order_flow_commands (
 actor_id uuid not null, command uuid not null, action text not null,
 order_id uuid not null references public.orders(id), input_digest text not null,
 primary key(actor_id,command)
);
alter table marketplace_private.seller_delivery_starts enable row level security;
alter table marketplace_private.order_cancellation_intents enable row level security;
alter table marketplace_private.order_settlement_authorizations enable row level security;
alter table marketplace_private.order_flow_commands enable row level security;
revoke all on marketplace_private.seller_delivery_starts,marketplace_private.order_cancellation_intents,
 marketplace_private.order_settlement_authorizations,marketplace_private.order_flow_commands from public,anon,authenticated,service_role;

-- Reuse the existing unresolved Case authority. Pre-handoff disagreement holds the
-- same transaction; it does not fabricate a Protection start or final fault judgment.
alter table marketplace_private.protection_cases drop constraint protection_cases_reason_check;
alter table marketplace_private.protection_cases add constraint protection_cases_reason_check check(reason in(
 'ITEM_NOT_RECEIVED','WRONG_ITEM','MATERIALLY_NOT_AS_DESCRIBED','MISSING_AGREED_ITEM','QUALIFYING_HIDDEN_DEFECT','DELIVERY_CANCELLATION_DISPUTE'));
alter table marketplace_private.protection_cases add column phase text not null default 'protection'
 check(phase in('protection','pre_handoff_cancellation'));

create function marketplace_private.order_progression_allowed(o public.orders) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from marketplace_private.order_cancellation_intents where order_id=o.id)
 and not exists(select 1 from marketplace_private.protection_cases where order_id=o.id);
$$;
create function marketplace_private.assert_order_progression(o public.orders) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not marketplace_private.order_progression_allowed(o) then
 raise exception 'Cancellation or Case holds this transaction.' using errcode='23505';end if;
end;$$;

-- All entry points acquire Listing -> Order; no client timestamp determines cutoff.
create function marketplace_private.lock_order_participant(p_order_id uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
 raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id) then
 raise exception 'V2 participant required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id then
 raise exception 'Participant changed.' using errcode='42501';end if;
 return o;
end;$$;
create function marketplace_private.order_cancel_before_cutoff(o public.orders) returns boolean
language sql stable security definer set search_path='' as $$
 select o.lifecycle_status='open' and o.holds_listing
 and not exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id and redeemed_at is not null)
 and not exists(select 1 from marketplace_private.order_protection where order_id=o.id)
 and not exists(select 1 from marketplace_private.courier_shipments where order_id=o.id and shipped_at is not null);
$$;
create function marketplace_private.record_order_flow_command(o public.orders,p_action text,p_command uuid,p_digest text) returns void
language plpgsql security definer set search_path='' as $$
declare cmd marketplace_private.order_flow_commands;
begin
 if p_command is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 select * into cmd from marketplace_private.order_flow_commands where actor_id=auth.uid() and command=p_command;
 if found then
 if cmd.order_id<>o.id or cmd.action<>p_action or cmd.input_digest<>p_digest then raise exception 'Command reused.' using errcode='23505';end if;
 else insert into marketplace_private.order_flow_commands values(auth.uid(),p_command,p_action,o.id,p_digest);end if;
end;$$;

create function public.marketplace_start_seller_delivery(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;s marketplace_private.seller_delivery_starts;t timestamptz;
begin
 if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'order_flow'||p_client_action_id::text,0));
 o:=marketplace_private.lock_order_participant(p_order_id);
 if o.seller_id is distinct from auth.uid() or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'seller_delivery' then
 raise exception 'Actual Seller Delivery Seller required.' using errcode='42501';end if;
 perform marketplace_private.record_order_flow_command(o,'start_delivery',p_client_action_id,o.id::text);
 select * into s from marketplace_private.seller_delivery_starts where order_id=o.id;
 if found then return jsonb_build_object('startedAt',s.started_at);end if;
 perform marketplace_private.assert_order_progression(o);
 if o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing then raise exception 'Paid Open Order required.' using errcode='23505';end if;
 t:=clock_timestamp();insert into marketplace_private.seller_delivery_starts values(o.id,auth.uid(),p_client_action_id,t);
 perform marketplace_private.emit_order_domain_event(o,'seller_delivery_started',t,auth.uid());
 return jsonb_build_object('startedAt',t);
end;$$;

create function marketplace_private.finalize_order_cancellation(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.order_cancellation_intents;m marketplace_private.v2_order_economics;
 t timestamptz;secured bigint;compensation bigint;fee bigint;
begin
 -- Caller already holds Listing -> Order. Reentrant locks preserve the same ordering.
 select * into o from public.orders where id=p_order_id for update;
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id for update;
 if i.order_id is null or i.state in('awaiting_seller','disputed','finalized') or o.payment_status='processing' then return;end if;
 if not marketplace_private.order_cancel_before_cutoff(o) then raise exception 'Cancellation cutoff crossed.' using errcode='23505';end if;
 select * into m from marketplace_private.v2_order_economics where order_id=o.id;
 if m.order_id is null then raise exception 'Frozen economics missing.' using errcode='23514';end if;
 secured:=case when o.payment_status='paid' then m.buyer_total_cents else 0 end;
 fee:=case when o.payment_status='paid' then m.buyer_service_fee_cents else 0 end;
 compensation:=case when secured>0 and i.path='delivery_compensation' then m.delivery_fee_cents else 0 end;
 t:=clock_timestamp();
 insert into marketplace_private.order_settlement_authorizations(order_id,disposition,secured_cents,buyer_release_cents,
 seller_delivery_compensation_cents,platform_reversed_cents,authorized_at)
 values(o.id,i.path,secured,secured-compensation,compensation,fee,t);
 update marketplace_private.order_cancellation_intents set state='finalized',finalized_at=t where order_id=o.id;
 update public.orders set lifecycle_status='cancelled',holds_listing=false,cancelled_at=t,cancelled_by=i.requested_by,
 cancelled_by_role=i.requested_by_role,cancel_reason_code=i.reason,cancel_reason_label_snapshot=case when i.path='delivery_compensation'
 then 'Buyer cancellation after delivery started' when i.seller_response='agree' then 'Full-refund cancellation agreed'
 else 'Order cancellation' end,cancel_note=i.note,reservation_ended_at=t,updated_at=t where id=o.id;
 update public.listings set status='available',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
end;$$;

create function public.marketplace_order_cancellation_state(p_order_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o public.orders;i marketplace_private.order_cancellation_intents;s marketplace_private.order_settlement_authorizations;started timestamptz;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id) then raise exception 'V2 participant required.' using errcode='42501';end if;
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
 select * into s from marketplace_private.order_settlement_authorizations where order_id=o.id;
 select started_at into started from marketplace_private.seller_delivery_starts where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'deliveryStartedAt',started,
 'canCancel',i.order_id is null and marketplace_private.order_cancel_before_cutoff(o) and marketplace_private.order_progression_allowed(o),
 'state',i.state,'path',i.path,'requestedAt',i.requested_at,'requestingRole',i.requested_by_role,
 'reason',i.reason,'note',i.note,'sellerResponse',i.seller_response,'sellerRespondedAt',i.seller_responded_at,
 'settlement',case when s.order_id is not null then jsonb_build_object('disposition',s.disposition,
 'securedCents',s.secured_cents,'buyerReleaseCents',s.buyer_release_cents,'sellerDeliveryCompensationCents',s.seller_delivery_compensation_cents,
 'platformRetainedCents',s.platform_retained_cents,'platformReversedCents',s.platform_reversed_cents,
 'sellerSalePayoutCents',s.seller_sale_payout_cents,'authorizedAt',s.authorized_at,'execution','provider_not_integrated') end,
 'serverTime',clock_timestamp());
end;$$;

create function public.marketplace_request_delivery_full_refund(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.order_cancellation_intents;t timestamptz;digest text;
begin
 if p_client_action_id is null or p_reason is null or p_reason not in('seller_fault','mutual') or p_note is null or char_length(p_note)>1000 then raise exception 'Cancellation request context required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'order_flow'||p_client_action_id::text,0));
 o:=marketplace_private.lock_order_participant(p_order_id);
 if auth.uid() is distinct from o.buyer_id or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'seller_delivery' then raise exception 'Seller Delivery Buyer required.' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(o.id,p_reason,btrim(p_note))::text,'UTF8')),'hex');
 perform marketplace_private.record_order_flow_command(o,'request_full_refund',p_client_action_id,digest);
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
 if found then
 if i.path<>'full_refund_request' or i.requested_by<>auth.uid() or i.reason<>p_reason or i.note<>btrim(p_note) then raise exception 'Existing cancellation request differs.' using errcode='23505';end if;
 return public.marketplace_order_cancellation_state(o.id);end if;
 if not marketplace_private.order_cancel_before_cutoff(o) or o.payment_status<>'paid'
 or not exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id) then raise exception 'Started Paid Delivery before handoff required.' using errcode='23505';end if;
 perform marketplace_private.assert_order_progression(o);t:=clock_timestamp();
 insert into marketplace_private.order_cancellation_intents values(o.id,auth.uid(),'buyer',t,p_reason,btrim(p_note),o.payment_status,
 jsonb_build_object('deliveryStarted',true,'handoffConfirmed',false),'full_refund_request','awaiting_seller',null,null,null);
 perform marketplace_private.emit_order_domain_event(o,'cancellation_requested',t,auth.uid());
 return public.marketplace_order_cancellation_state(o.id);
end;$$;

create function public.marketplace_respond_delivery_cancellation(p_order_id uuid,p_response text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.order_cancellation_intents;t timestamptz;
begin
 if p_client_action_id is null or p_response is null or p_response not in('agree','dispute') then raise exception 'Seller response required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'order_flow'||p_client_action_id::text,0));
 o:=marketplace_private.lock_order_participant(p_order_id);
 if auth.uid() is distinct from o.seller_id then raise exception 'Actual Seller required.' using errcode='42501';end if;
 perform marketplace_private.record_order_flow_command(o,'respond_cancellation',p_client_action_id,o.id::text||':'||p_response);
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id for update;
 if i.order_id is null or i.path<>'full_refund_request' and i.seller_response is null then raise exception 'Full-refund request required.' using errcode='23505';end if;
 if i.seller_response is not null then
 if i.seller_response<>p_response then raise exception 'Response already recorded.' using errcode='23505';end if;
 return public.marketplace_order_cancellation_state(o.id);end if;
 if i.state<>'awaiting_seller' or not marketplace_private.order_cancel_before_cutoff(o) then raise exception 'Cancellation cutoff crossed.' using errcode='23505';end if;
 t:=clock_timestamp();
 update marketplace_private.order_cancellation_intents set seller_response=p_response,seller_responded_at=t,
 state=case when p_response='agree' then 'payment_pending' else 'disputed' end,
 path=case when p_response='agree' then 'full_release' else path end where order_id=o.id;
 if p_response='agree' then perform marketplace_private.finalize_order_cancellation(o.id);
 else
 insert into marketplace_private.protection_cases(order_id,buyer_id,command,reason,opened_at,phase)
 values(o.id,o.buyer_id,p_client_action_id,'DELIVERY_CANCELLATION_DISPUTE',t,'pre_handoff_cancellation');
 perform marketplace_private.emit_order_domain_event(o,'protection_case_opened',t,auth.uid());
 end if;
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_order_cancellation_state(o.id);
end;$$;

-- Existing successful-transaction authority remains the Completed Order + mature
-- Protection receipt. Cancelled authorizations are separate from sale payout.
revoke all on function marketplace_private.order_progression_allowed(public.orders),marketplace_private.assert_order_progression(public.orders),
 marketplace_private.lock_order_participant(uuid),marketplace_private.order_cancel_before_cutoff(public.orders),
 marketplace_private.record_order_flow_command(public.orders,text,uuid,text),marketplace_private.finalize_order_cancellation(uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_start_seller_delivery(uuid,uuid),public.marketplace_order_cancellation_state(uuid),
 public.marketplace_request_delivery_full_refund(uuid,text,text,uuid),public.marketplace_respond_delivery_cancellation(uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_start_seller_delivery(uuid,uuid),public.marketplace_order_cancellation_state(uuid),
 public.marketplace_request_delivery_full_refund(uuid,text,text,uuid),public.marketplace_respond_delivery_cancellation(uuid,text,uuid) to authenticated;


do $$declare expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_v2_foundation';
 execute 'alter table public.orders drop constraint orders_v2_foundation';
 execute 'alter table public.orders add constraint orders_v2_foundation check(('||expr||') or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)=''object'' and lifecycle_status=''cancelled'' and not holds_listing and payment_status=''paid'' and payment_paid_at is not null and payout_status=''not_eligible'' and fulfillment_status=''awaiting_fulfillment'' and money_status=''v2_pending'' and service_fee_rule_version=''not_finalized_v2'' and service_fee_amount_cents is null and total_amount_cents is null and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null and expired_at is null and cancelled_at is not null and reservation_ended_at=cancelled_at))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_paid_inventory_check';
 execute 'alter table public.orders drop constraint orders_paid_inventory_check';
 execute 'alter table public.orders add constraint orders_paid_inventory_check check(('||expr||') or(order_protocol_version=2 and lifecycle_status=''cancelled'' and payment_status=''paid'' and not holds_listing))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_cancellation_check';
 execute 'alter table public.orders drop constraint orders_cancellation_check';
 execute 'alter table public.orders add constraint orders_cancellation_check check(('||expr||') or(order_protocol_version=2 and lifecycle_status=''cancelled'' and payment_status in(''pending'',''failed'',''paid'') and cancelled_at is not null and cancelled_by is not null and cancelled_by_role in(''buyer'',''seller'') and cancel_reason_code is not null and cancel_reason_label_snapshot is not null and cancel_note is not null and char_length(cancel_note)<=1000))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_event_type_check';
 execute 'alter table public.transaction_events drop constraint transaction_events_event_type_check';
 execute 'alter table public.transaction_events add constraint transaction_events_event_type_check check(('||expr||') or event_type in(''seller_delivery_started'',''cancellation_requested''))';
end;$$;


create or replace function marketplace_private.cancel_legacy_order(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid)
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

create or replace function public.marketplace_cancel_order(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; actor uuid:=auth.uid(); actor_role text; label text;
  note text:=btrim(coalesce(p_note,'')); t timestamptz; digest text; cmd marketplace_private.order_commands; intent marketplace_private.order_cancellation_intents; path text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found or (o.buyer_id is distinct from actor and o.seller_id is distinct from actor) then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  if o.order_protocol_version=1 then return marketplace_private.cancel_legacy_order(p_order_id,p_reason,p_note,p_client_action_id);end if;
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
  select * into intent from marketplace_private.order_cancellation_intents where order_id=o.id;
  if intent.order_id is not null then
   if intent.requested_by<>actor or intent.reason<>p_reason or intent.note<>note or intent.path='full_refund_request' then
   raise exception 'Existing cancellation intent differs.' using errcode='23505';end if;
   return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  if not marketplace_private.order_cancel_before_cutoff(o) or not marketplace_private.order_progression_allowed(o)
   or o.payment_status not in('pending','failed','processing','paid') then
   return jsonb_build_object('errorCode','order_not_cancellable');end if;
  if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
  select * into o from public.orders where id=p_order_id for update;
  t:=clock_timestamp();
  if o.lifecycle_status<>'open' or (o.order_protocol_version=1 and o.holds_listing and o.reservation_expires_at<=t) then
    if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
    return jsonb_build_object('errorCode','order_not_cancellable'); end if;
  path:=case when actor_role='buyer' and o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery'
   and exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id)
   then 'delivery_compensation' else 'full_release' end;
  insert into marketplace_private.order_cancellation_intents values(o.id,actor,actor_role,t,p_reason,note,o.payment_status,
   jsonb_build_object('deliveryStarted',exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id),
   'handoffConfirmed',false,'shipped',false),path,'payment_pending',null,null,null);
  perform marketplace_private.emit_order_domain_event(o,'cancellation_requested',t,actor);
  perform marketplace_private.finalize_order_cancellation(o.id);
  select * into o from public.orders where id=o.id;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'cancel_order',p_client_action_id,digest,o.request_id,o.id);
  return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
end; $$;

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='completed' then
 perform marketplace_private.assert_order_progression(old);
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

  if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='cancelled'
   and old.payment_status in('pending','failed','paid') then
   if new.holds_listing or new.cancelled_at is null or new.reservation_ended_at is distinct from new.cancelled_at
   or new.payout_status<>'not_eligible' or not marketplace_private.order_cancel_before_cutoff(old)
   or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
   is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
   or not exists(select 1 from marketplace_private.order_cancellation_intents i
    join marketplace_private.order_settlement_authorizations a on a.order_id=i.order_id
    where i.order_id=old.id and i.state='finalized' and i.finalized_at=new.cancelled_at
    and i.requested_by=new.cancelled_by and i.requested_by_role=new.cancelled_by_role
    and i.reason=new.cancel_reason_code and i.note=new.cancel_note
    and a.authorized_at=new.cancelled_at and a.platform_retained_cents=0 and a.seller_sale_payout_cents=0)
   then raise exception 'Authoritative cancellation settlement required.' using errcode='23514';end if;
   return new;
  end if;

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
 perform marketplace_private.assert_order_progression(o);
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

create or replace function public.marketplace_verify_handoff(p_order_id uuid,p_channel text,p_credential text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.handoff_authorizations;key bytea;digest bytea;t timestamptz;fails integer;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Seller required.' using errcode='42501';end if;
 if p_client_action_id is null or p_channel is null or p_channel not in('qr','code') or p_credential is null
 or(p_channel='code' and p_credential !~ '^[0-9]{6}$') or(p_channel='qr' and p_credential !~ '^[0-9a-f]{64}$') then
 raise exception 'Valid verification channel and command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'handoff'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.seller_id is distinct from auth.uid() then raise exception 'Actual Seller required.' using errcode='42501';end if;
 if exists(select 1 from marketplace_private.handoff_authorizations where verified_by=auth.uid() and verification_command=p_client_action_id and order_id<>o.id) then raise exception 'Command reused.' using errcode='23505';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id for update;
 if a.order_id is null or o.payment_status<>'paid' then raise exception 'Paid handoff authorization required.' using errcode='23514';end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 digest:=extensions.hmac(convert_to(a.id::text||':'||p_channel||':'||p_credential,'UTF8'),key,'sha256');
 if a.redeemed_at is not null then
 if a.verified_by=auth.uid() and a.verification_command=p_client_action_id and digest=(case when p_channel='qr' then a.qr_digest else a.code_digest end) then
 return jsonb_build_object('verified',true,'confirmedAt',a.redeemed_at);end if;
 return jsonb_build_object('verified',false,'errorCode','handoff_already_redeemed');end if;
 if o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery'
 and not exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id) then
 raise exception 'Start Seller Delivery before handoff.' using errcode='23505';end if;
 if o.lifecycle_status<>'open' then raise exception 'Open Order required.' using errcode='23505';end if;t:=clock_timestamp();
 if p_channel='code' and a.numeric_locked_until>t then return jsonb_build_object('verified',false,'errorCode','numeric_temporarily_locked','retryAt',a.numeric_locked_until);end if;
 if digest is distinct from (case when p_channel='qr' then a.qr_digest else a.code_digest end) then
 if p_channel='code' then
 fails:=case when a.numeric_window_started_at is null or a.numeric_window_started_at<=t-interval '10 minutes' then 1 else a.numeric_failures+1 end;
 update marketplace_private.handoff_authorizations set numeric_failures=fails,
 numeric_window_started_at=case when fails=1 then t else numeric_window_started_at end,
 numeric_locked_until=case when fails>=5 then t+interval '15 minutes' else null end where order_id=o.id;
 end if;
 -- Return domain rejection rather than raise: rate-limit evidence must commit.
 return jsonb_build_object('verified',false,'errorCode','invalid_handoff_credential');end if;
 update marketplace_private.handoff_authorizations set redeemed_at=t,verified_by=auth.uid(),verification_command=p_client_action_id,
 numeric_failures=0,numeric_window_started_at=null,numeric_locked_until=null where order_id=o.id;
 perform marketplace_private.emit_order_domain_event(o,'handoff_confirmed',t,auth.uid());
 perform marketplace_private.begin_order_protection(o,'handoff',t);
 return jsonb_build_object('verified',true,'confirmedAt',t);
end;$$;

create or replace function public.marketplace_record_courier_shipment(p_order_id uuid,p_carrier_label text,p_tracking_reference text,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;s marketplace_private.courier_shipments;cmd marketplace_private.courier_commands;digest text;t timestamptz;
begin
if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Seller required.' using errcode='42501';end if;
if p_client_action_id is null or p_carrier_label is null or char_length(btrim(p_carrier_label)) not between 1 and 120
or p_tracking_reference is null or char_length(btrim(p_tracking_reference)) not between 1 and 200 then raise exception 'Carrier and tracking reference required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'courier_shipment'||p_client_action_id::text,0));
select * into o from public.orders where id=p_order_id;
if o.id is null or o.seller_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Actual Courier Seller required.' using errcode='42501';end if;
digest:=encode(sha256(convert_to(jsonb_build_array(o.id,btrim(p_carrier_label),btrim(p_tracking_reference))::text,'UTF8')),'hex');
select * into cmd from marketplace_private.courier_commands where seller_id=auth.uid() and command=p_client_action_id;
if found then if cmd.input_digest<>digest then raise exception 'Command reused.' using errcode='23505';end if;return jsonb_build_object('recorded',true);end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
if o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing then raise exception 'Paid Open Courier Order required.' using errcode='23505';end if;
select * into s from marketplace_private.courier_shipments where order_id=o.id for update;
if s.order_id is not null and s.state<>'not_shipped' then raise exception 'Shipment already recorded.' using errcode='23505';end if;t:=clock_timestamp();
insert into marketplace_private.courier_shipments(order_id,state,carrier_label,tracking_reference,shipped_at,shipment_command)
values(o.id,'shipped',btrim(p_carrier_label),btrim(p_tracking_reference),t,p_client_action_id);
insert into marketplace_private.courier_commands values(auth.uid(),p_client_action_id,o.id,digest);
perform marketplace_private.emit_order_domain_event(o,'courier_shipped',t,auth.uid());
return jsonb_build_object('recorded',true);
end;$$;

create or replace function public.marketplace_record_trusted_courier_delivery(p_order_id uuid,p_event_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;s marketplace_private.courier_shipments;t timestamptz;
begin
-- Only current staging qualification authority. A real carrier adapter must later
-- verify its webhook and map provider identity; no caller-submitted delivery clock.
if auth.jwt()->>'role' is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging authority required.' using errcode='42501';end if;
if p_event_key is null or char_length(p_event_key) not between 1 and 200 then raise exception 'Delivery event identity required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended('courier_delivery:'||p_event_key,0));
if exists(select 1 from marketplace_private.courier_shipments where delivery_event_key=p_event_key and order_id<>p_order_id) then raise exception 'Delivery event reused.' using errcode='23505';end if;
select * into o from public.orders where id=p_order_id;
if o.id is null or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Courier Order required.' using errcode='23514';end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
select * into s from marketplace_private.courier_shipments where order_id=o.id for update;
if s.state='delivered' then return jsonb_build_object('delivered',true,'deliveredAt',s.delivered_at);end if;
if o.lifecycle_status<>'open' or o.payment_status<>'paid' or s.order_id is null or s.state<>'shipped' then raise exception 'Paid shipped Order required.' using errcode='23505';end if;t:=clock_timestamp();
update marketplace_private.courier_shipments set state='delivered',delivered_at=t,delivery_source='staging_trusted_boundary',delivery_event_key=p_event_key where order_id=o.id;
perform marketplace_private.emit_order_domain_event(o,'courier_delivered',t);
perform marketplace_private.begin_order_protection(o,'courier_delivered',t);
return jsonb_build_object('delivered',true,'deliveredAt',t);
end;$$;

create or replace function public.marketplace_confirm_courier_received(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;cmd marketplace_private.buyer_receipt_commands;t timestamptz;
begin
if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'courier_received'||p_client_action_id::text,0));
select * into o from public.orders where id=p_order_id;
if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Actual Courier Buyer required.' using errcode='42501';end if;
select * into cmd from marketplace_private.buyer_receipt_commands where buyer_id=auth.uid() and command=p_client_action_id;
if found and cmd.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
select * into cmd from marketplace_private.buyer_receipt_commands where order_id=o.id;
if found then return jsonb_build_object('received',true,'confirmedAt',cmd.confirmed_at);end if;
if o.lifecycle_status<>'open' or o.payment_status<>'paid' then raise exception 'Paid Open Order required.' using errcode='23505';end if;t:=clock_timestamp();
insert into marketplace_private.buyer_receipt_commands values(auth.uid(),p_client_action_id,o.id,t);
perform marketplace_private.emit_order_domain_event(o,'buyer_confirm_received',t,auth.uid());
perform marketplace_private.begin_order_protection(o,'buyer_received',t);
return jsonb_build_object('received',true,'confirmedAt',t);
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
 perform marketplace_private.finalize_order_cancellation(o.id);
 return jsonb_build_object('status',a.status);
end;$$;

create or replace function marketplace_private.create_paid_handoff() returns trigger
language plpgsql security definer set search_path='' as $$
declare key bytea;aid uuid:=gen_random_uuid();qr text;code text;n bigint;t timestamptz;
begin
 if new.order_protocol_version<>2 or new.payment_status<>'paid' or old.payment_status='paid'
 or not(new.terms_snapshot->'terms'->>'fulfillment'='on_campus' or new.terms_snapshot->'terms'->>'delivery_method'='seller_delivery') then return new;end if;
 if exists(select 1 from marketplace_private.order_cancellation_intents where order_id=new.id) then return new;end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 qr:=encode(extensions.gen_random_bytes(32),'hex');
 loop n:=('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint;exit when n<4294000000;end loop;
 code:=lpad((n%1000000)::text,6,'0');t:=clock_timestamp();
 insert into marketplace_private.handoff_authorizations(order_id,id,encrypted_credentials,qr_digest,code_digest,created_at)
 values(new.id,aid,extensions.pgp_sym_encrypt(jsonb_build_object('qrToken',qr,'code',code)::text,encode(key,'hex'),'cipher-algo=aes256,compress-algo=0'),
 extensions.hmac(convert_to(aid::text||':qr:'||qr,'UTF8'),key,'sha256'),
 extensions.hmac(convert_to(aid::text||':code:'||code,'UTF8'),key,'sha256'),t);
 perform marketplace_private.emit_order_domain_event(new,'handoff_ready',t);
 return new;
end;$$;

create or replace function public.marketplace_handoff_credential(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;a marketplace_private.handoff_authorizations;key bytea;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer credential only.' using errcode='42501';end if;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 if a.order_id is null or o.lifecycle_status<>'open' or o.payment_status<>'paid' or a.redeemed_at is not null or not marketplace_private.order_progression_allowed(o) then
 return jsonb_build_object('available',false);end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 return extensions.pgp_sym_decrypt(a.encrypted_credentials,encode(key,'hex'))::jsonb||jsonb_build_object('available',true);
end;$$;

create or replace function public.marketplace_order_fulfillment(p_order_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o public.orders;p marketplace_private.order_protection;a marketplace_private.handoff_authorizations;c marketplace_private.protection_cases;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into p from marketplace_private.order_protection where order_id=o.id;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'handoffReady',a.order_id is not null and a.redeemed_at is null and o.lifecycle_status='open' and marketplace_private.order_progression_allowed(o),
 'deliveryStartedAt',(select started_at from marketplace_private.seller_delivery_starts where order_id=o.id),
 'cancellation',public.marketplace_order_cancellation_state(o.id),
 'handoffConfirmedAt',a.redeemed_at,'protectionStartedAt',p.started_at,'protectionExpiresAt',p.expires_at,
 'protectionCompletedAt',p.completed_at,'protectionHold',c.id is not null,'caseState',c.state,
 'payoutEligible',o.lifecycle_status='completed' and c.id is null and o.payout_status='eligible','serverTime',clock_timestamp());
end;$$;
revoke all on function marketplace_private.cancel_legacy_order(uuid,text,text,uuid) from public,anon,authenticated,service_role;
commit;


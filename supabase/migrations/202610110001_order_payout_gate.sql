-- Phase C: staging-only function update. No tables, columns or history backfill.
-- Lock order: command idempotency -> user/capability advisory -> listing ->
-- conversation -> Request/Order. Capability mutation: advisory -> capability row.
-- Completed command returns precede payout gate; Cancel does not take payout lock.
begin;
create function marketplace_private.lock_financial_capability(p_user_id uuid,p_capability text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_user_id is null or p_capability not in ('payment_method','payout_account') or p_capability is null then
  raise exception 'Invalid capability owner.' using errcode='23514';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'marketplace:financial:'||p_user_id::text||':'||p_capability,0));
end; $$;
create function marketplace_private.require_seller_payout_ready(p_seller_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_status text;
begin
 if p_seller_id is null then raise exception 'Seller required.' using errcode='42501'; end if;
 perform marketplace_private.lock_financial_capability(p_seller_id,'payout_account');
 -- Read AFTER advisory lock, hold ready row through commit as an additional backstop.
 -- Advisory locking covers absent rows and Clear; FOR UPDATE also prevents stale
 -- stronger-isolation transactions from accepting an outdated changed Ready row.
 select status into current_status from marketplace_private.financial_capabilities
  where user_id=p_seller_id and capability='payout_account' for update;
 if current_status is distinct from 'ready' then
  raise exception 'seller_payout_not_ready' using errcode='P0001';
 end if;
end; $$;
revoke all on function marketplace_private.lock_financial_capability(uuid,text),
 marketplace_private.require_seller_payout_ready(uuid) from public,anon,authenticated,service_role;

create or replace function public.marketplace_record_financial_capability(
 p_user_id uuid,p_capability text,p_status text,p_provider_key text,
 p_provider_owner_ref text,p_provider_instrument_ref text,p_display_label text,p_last4 text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_capability is null or p_capability not in ('payment_method','payout_account') then
  raise exception 'Invalid capability.' using errcode='23514';
 end if;
 if not exists(select 1 from public.profiles where id=p_user_id) then
  raise exception 'Account not found.' using errcode='23503';
 end if;
 perform marketplace_private.lock_financial_capability(p_user_id,p_capability);
 if p_status='unset' then
  if p_provider_key is not null or p_provider_owner_ref is not null or p_provider_instrument_ref is not null
    or p_display_label is not null or p_last4 is not null then
   raise exception 'Unset must clear metadata.' using errcode='23514';
  end if;
  delete from marketplace_private.financial_capabilities where user_id=p_user_id and capability=p_capability;
  return;
 end if;
 insert into marketplace_private.financial_capabilities(user_id,capability,status,provider_key,provider_owner_ref,provider_instrument_ref,display_label,last4)
 values(p_user_id,p_capability,p_status,p_provider_key,p_provider_owner_ref,p_provider_instrument_ref,p_display_label,p_last4)
 on conflict(user_id,capability) do update set status=excluded.status,provider_key=excluded.provider_key,
  provider_owner_ref=excluded.provider_owner_ref,provider_instrument_ref=excluded.provider_instrument_ref,
  display_label=excluded.display_label,last4=excluded.last4,updated_at=clock_timestamp();
end; $$;

create or replace function marketplace_private.mutate_order_request(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_reason text default null,p_note text default null)
returns public.order_requests language plpgsql security definer set search_path = '' as $$
declare c public.conversations; l public.listings; old_request public.order_requests; result public.order_requests;
  cmd marketplace_private.order_commands; actor uuid:=auth.uid(); conversation uuid; lid uuid; digest text;
  t timestamptz; scheduled timestamptz; local_time timestamp; amount bigint; shipping bigint; method text; cost text;
  label text; new_id uuid:=gen_random_uuid(); location text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null or p_action not in ('create','replace','cancel') then
    raise exception 'A client action UUID is required.' using errcode='23514'; end if;
  if p_action='create' then conversation:=p_target;
  else select * into old_request from public.order_requests where id=p_target;
    if not found or old_request.seller_id is distinct from actor then raise exception 'Request not accessible.' using errcode='42501'; end if;
    conversation:=old_request.conversation_id;
  end if;
  select * into c from public.conversations where id=conversation;
  if not found or c.seller_id is distinct from actor or c.buyer_id is null then raise exception 'Seller conversation required.' using errcode='42501'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_array(p_target,p_terms,p_reason,p_note)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_action||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=actor and action=p_action and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused for different input.' using errcode='23505'; end if;
    select * into result from public.order_requests where id=cmd.request_id; return result;
  end if;
  if p_action in ('create','replace') then perform marketplace_private.require_seller_payout_ready(actor); end if;
  lid:=c.listing_id;
  select * into l from public.listings where id=lid for update;
  select * into c from public.conversations where id=conversation for update;
  if not found or c.seller_id is distinct from actor or c.buyer_id is null or c.listing_id is distinct from lid then
    raise exception 'Seller conversation required.' using errcode='42501'; end if;
  perform marketplace_private.settle_listing_reservation(lid);
  t:=clock_timestamp();
  perform marketplace_private.expire_order_requests(c.id,t);
  if p_action<>'create' then
    select * into old_request from public.order_requests where id=p_target for update;
    if old_request.status<>'active' then raise exception 'Request changed; refresh before retrying.' using errcode='23505'; end if;
  end if;
  if p_action='cancel' then
    label:=case p_reason when 'incorrect_details' then 'Incorrect transaction details' when 'item_unavailable' then 'Item is no longer available'
      when 'cannot_complete' then 'Cannot complete the transaction' when 'sent_by_mistake' then 'Sent by mistake' when 'other' then 'Other' end;
    if label is null or char_length(coalesce(p_note,''))>1000 then raise exception 'Valid cancellation reason/note required.' using errcode='23514'; end if;
    update public.order_requests set status='cancelled',cancelled_at=t,updated_at=t,cancelled_by=actor,cancelled_by_role='seller',
      cancel_reason_code=p_reason,cancel_reason_label_snapshot=label,cancel_note=btrim(coalesce(p_note,'')) where id=p_target returning * into result;
  else
    if l.id is null or l.seller_id is distinct from actor or l.published_at is null or l.status<>'available' then
      raise exception 'Published available seller listing required.' using errcode='23514'; end if;
    if p_terms is null or jsonb_typeof(p_terms)<>'object' then raise exception 'Request terms required.' using errcode='23514'; end if;
    amount:=(p_terms->>'item_amount_cents')::bigint;
    if amount is null or amount<0 or amount>9007199254740991 then raise exception 'Invalid item amount.' using errcode='23514'; end if;
    method:=p_terms->>'fulfillment_type'; cost:=p_terms->>'shipping_cost_mode';
    if method in ('pickup','meet') then
      scheduled:=(p_terms->>'scheduled_at')::timestamptz;
      location:=btrim(p_terms->>'place_name'); local_time:=scheduled at time zone 'America/Toronto';
      if scheduled is null or not isfinite(scheduled) or scheduled<t+interval '60 minutes' or scheduled>((t at time zone 'America/Toronto')+interval '30 days') at time zone 'America/Toronto'
        or extract(minute from local_time)::integer%15<>0 or extract(second from local_time)<>0
        or location is null or char_length(location) not between 1 and 120 then raise exception 'Choose a location and a 15-minute time 60 minutes to 30 days ahead.' using errcode='23514'; end if;
      cost:=null; shipping:=null;
    elsif method='shipping' then
      if cost='included' then shipping:=0;
      elsif cost='flat_rate' then shipping:=(p_terms->>'shipping_amount_cents')::bigint;
        if shipping is null or shipping<0 or shipping>9007199254740991 then raise exception 'Invalid flat shipping amount.' using errcode='23514'; end if;
      elsif cost='pending' then shipping:=null;
      else raise exception 'Choose shipping cost mode.' using errcode='23514'; end if;
    else raise exception 'Choose fulfillment type.' using errcode='23514'; end if;
    if char_length(coalesce(p_terms->>'seller_note',''))>1000 or char_length(coalesce(p_terms->>'shipping_method',''))>120 or char_length(coalesce(p_terms->>'shipping_note',''))>1000 then
      raise exception 'Request note/method too long.' using errcode='23514'; end if;
    if p_action='create' and exists(select 1 from public.order_requests where listing_origin_id=c.listing_origin_id and buyer_origin_id=c.buyer_id and seller_origin_id=c.seller_id and status='active') then
      raise exception 'An Active Request already exists; use replacement.' using errcode='23505'; end if;
    if exists(select 1 from public.orders where buyer_origin_id=c.buyer_id and listing_origin_id=c.listing_origin_id and lifecycle_status='open') then
      raise exception 'Resolve the existing Order first.' using errcode='23505'; end if;
    if p_action='replace' then update public.order_requests set status='superseded',replaced_at=t,updated_at=t,replacement_request_id=new_id where id=p_target; end if;
    insert into public.order_requests(id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,
      buyer_username_snapshot,seller_username_snapshot,listing_title_snapshot,listing_description_snapshot,listing_category_snapshot,
      listing_subcategory_snapshot,listing_condition_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_media_snapshot,
      item_amount_cents,fulfillment_type,location_source,place_name,scheduled_at,schedule_timezone,request_expires_at,
      shipping_cost_mode,shipping_amount_cents,shipping_method,shipping_note,seller_note,created_at,updated_at)
    values(new_id,c.id,l.id,c.listing_origin_id,c.buyer_id,c.seller_id,c.buyer_id,c.seller_id,
      (select display_name from public.profiles where id=c.buyer_id),(select display_name from public.profiles where id=c.seller_id),
      l.title,l.description,l.category,l.subcategory,l.condition,l.price_cents,l.currency,
      coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'slot',i.slot) order by i.slot) from public.listing_images i where i.listing_id=l.id and i.ready),'[]'::jsonb),
      amount,method,case when method<>'shipping' then 'free_text' end,location,scheduled,case when method<>'shipping' then 'America/Toronto' end,scheduled,
      cost,shipping,case when method='shipping' then btrim(coalesce(p_terms->>'shipping_method','')) end,
      case when method='shipping' then btrim(coalesce(p_terms->>'shipping_note','')) end,btrim(coalesce(p_terms->>'seller_note','')),t,t) returning * into result;
  end if;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id) values(actor,p_action,p_client_action_id,digest,result.id);
  return result;
end; $$;

create or replace function public.marketplace_accept_order_request(p_request_id uuid,p_client_action_id uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare r public.order_requests; c public.conversations; l public.listings; result public.orders;
  actor uuid:=auth.uid(); cmd marketplace_private.order_commands; digest text; t timestamptz; amounts jsonb; shipping bigint;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into r from public.order_requests where id=p_request_id;
  if not found or r.buyer_id is distinct from actor then raise exception 'Buyer Request required.' using errcode='42501'; end if;
  digest:=encode(sha256(convert_to(p_request_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'accept'||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=actor and action='accept' and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused.' using errcode='23505'; end if;
    select * into result from public.orders where id=cmd.order_id; return result;
  end if;
  perform marketplace_private.require_seller_payout_ready(r.seller_id);
  select * into l from public.listings where id=r.listing_id for update;
  perform marketplace_private.settle_listing_reservation(r.listing_id);
  select * into l from public.listings where id=r.listing_id;
  select * into c from public.conversations where id=r.conversation_id for update;
  select * into r from public.order_requests where id=p_request_id for update;
  t:=clock_timestamp();
  if r.buyer_id is distinct from actor or c.buyer_id is distinct from actor or c.seller_id is distinct from r.seller_id
    or c.listing_id is distinct from r.listing_id or r.seller_id is null or l.seller_id is distinct from r.seller_id then
    raise exception 'Request membership changed.' using errcode='42501'; end if;
  if r.status<>'active' or l.id is null or l.status<>'available' or l.published_at is null
    or (r.scheduled_at is not null and r.scheduled_at<=t)
    or exists(select 1 from public.orders where listing_origin_id=r.listing_origin_id and holds_listing) then
    raise exception 'Request or inventory changed; refresh.' using errcode='23505'; end if;
  shipping:=case when r.fulfillment_type<>'shipping' then 0 else r.shipping_amount_cents end;
  amounts:=marketplace_private.order_money(r.item_amount_cents,shipping);
  insert into public.orders(request_id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,
    terms_snapshot,item_amount_cents,shipping_amount_cents,service_fee_amount_cents,total_amount_cents,money_status,
    holds_listing,created_at,updated_at,accepted_at,reservation_started_at,reservation_expires_at)
  values(r.id,r.conversation_id,r.listing_id,r.listing_origin_id,r.buyer_id,r.seller_id,r.buyer_origin_id,r.seller_origin_id,to_jsonb(r),
    r.item_amount_cents,shipping,(amounts->>'fee')::bigint,(amounts->>'total')::bigint,
    case when shipping is null then 'shipping_pending' else 'finalized' end,shipping is not null,t,t,t,
    case when shipping is not null then t end,case when shipping is not null then t+interval '30 minutes' end) returning * into result;
  update public.order_requests set status='accepted',accepted_at=t,updated_at=t where id=r.id;
  if shipping is not null then update public.listings set status='reserved',reserved_order_id=result.id where id=l.id; end if;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'accept',p_client_action_id,digest,r.id,result.id);
  return result;
end; $$;
-- CREATE OR REPLACE retains existing owners/grants; private helpers have no client grant.
commit;

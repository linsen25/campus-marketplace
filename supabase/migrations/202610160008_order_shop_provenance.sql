-- Order source metadata only. Historical snapshots and transaction hashes remain unchanged.
begin;

create or replace function public.marketplace_accept_offer(p_offer_id uuid,p_client_action_id uuid,p_media_batch uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r public.order_requests;c public.conversations;l public.listings;
 o public.orders;cmd marketplace_private.offer_accept_commands;oid uuid:=gen_random_uuid();t timestamptz;reason text;
shop_name text;
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
 if marketplace_private.payment_mode(r.offer_terms)='uu_pay' then perform marketplace_private.require_seller_payout_ready(r.seller_id);end if;
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
 if l.listing_channel='shop' then
  select s.name into shop_name from public.shops s where s.owner_id=l.seller_id for share;
  if not found or marketplace_private.shop_profile_text_length(shop_name) not between 1 and 40 then
   raise exception 'Shop profile required for Shop Order.' using errcode='23514';
  end if;
 end if;
 insert into marketplace_private.offer_accept_commands(actor_key,idempotency_key,offer_id,order_id) values(actor,p_client_action_id,r.id,oid);
 insert into public.orders(id,order_protocol_version,request_id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,
 buyer_origin_id,seller_origin_id,terms_schema_version,terms_snapshot,listing_snapshot,item_amount_cents,shipping_amount_cents,
 money_status,service_fee_rule_version,holds_listing,created_at,updated_at,accepted_at)
 values(oid,2,r.id,c.id,l.id,r.listing_origin_id,r.buyer_id,r.seller_id,r.buyer_origin_id,r.seller_origin_id,2,
 jsonb_build_object('offerId',r.id,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id,'terms',r.offer_terms,
 'termsVersion',2,'acceptedAt',t,'buyerName',r.buyer_username_snapshot,'sellerName',r.seller_username_snapshot),
 jsonb_build_object('listingId',l.id,'title',l.title,'description',l.description,'category',l.category,'subcategory',l.subcategory,
 'preferredPaymentMode',l.preferred_payment_mode,'preferredFulfillment',l.preferred_fulfillment,'condition',l.condition,'askingPriceCents',l.price_cents,'currency',l.currency,'sellerId',l.seller_id,
 'materialHash',r.listing_material_hash_at_offer,'mediaBatchId',p_media_batch,'listingChannel',l.listing_channel)
 || case when l.listing_channel='shop' then jsonb_build_object('shopName',shop_name) else '{}'::jsonb end,r.item_amount_cents,
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

CREATE OR REPLACE FUNCTION public.marketplace_accept_order_request(p_request_id uuid, p_client_action_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.order_requests; c public.conversations; l public.listings; result public.orders;
  actor uuid:=auth.uid(); cmd marketplace_private.order_commands; digest text; t timestamptz; amounts jsonb; shipping bigint;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into r from public.order_requests where id=p_request_id;
  if not found or r.buyer_id is distinct from actor then raise exception 'Buyer Request required.' using errcode='42501'; end if;
  if r.protocol_version<>1 then raise exception 'V1_PROTOCOL_REQUIRED' using errcode='42501'; end if;
  digest:=encode(sha256(convert_to(p_request_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'accept'||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=actor and action='accept' and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused.' using errcode='23505'; end if;
    select * into result from public.orders where id=cmd.order_id; return result;
  end if;
  perform marketplace_private.require_seller_payout_ready(r.seller_id);
  select * into l from public.listings where id=r.listing_id for update;
  if l.listing_channel is distinct from 'resale' then
    raise exception 'V1 Order Requests require a Resale Listing.' using errcode='23514';
  end if;
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
end; $function$;

commit;

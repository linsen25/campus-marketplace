-- V2-A1 staging-only protocol isolation. No V2 mutation/Accept or timer changes.
begin;
lock table public.order_requests in access exclusive mode;
alter table public.order_requests add column protocol_version integer;
alter table public.order_requests add column sender_user_id uuid;
alter table public.order_requests add column recipient_user_id uuid;
do $audit$ begin
 if exists(select 1 from public.order_requests r left join public.conversations c on c.id=r.conversation_id
 where c.id is null or r.seller_origin_id is null or r.buyer_origin_id is null or r.seller_origin_id=r.buyer_origin_id
 or r.listing_origin_id is distinct from c.listing_origin_id
 or(c.seller_id is not null and c.seller_id is distinct from r.seller_origin_id)
 or(c.buyer_id is not null and c.buyer_id is distinct from r.buyer_origin_id)
 or(r.seller_id is not null and r.seller_id is distinct from r.seller_origin_id)
 or(r.buyer_id is not null and r.buyer_id is distinct from r.buyer_origin_id))
 or exists(select 1 from public.transaction_events e join public.order_requests r on r.id=e.request_id
 where e.event_type='request_created' and(e.actor_id is distinct from r.seller_origin_id or e.actor_role<>'seller')) then
 raise exception 'Legacy identity cannot be derived; stop.' using errcode='23514'; end if;
end;$audit$;
-- Exclusive lock + transaction: bypass only identity retention, no timestamps changed.
-- Existing event trigger returns on unchanged status; no fake activity is emitted.
alter table public.order_requests disable trigger order_request_immutable;
update public.order_requests set protocol_version=1,sender_user_id=seller_origin_id,recipient_user_id=buyer_origin_id;
alter table public.order_requests enable trigger order_request_immutable;
alter table public.order_requests alter column protocol_version set default 1;
alter table public.order_requests alter column protocol_version set not null;
alter table public.order_requests alter column sender_user_id set not null;
alter table public.order_requests alter column recipient_user_id set not null;
alter table public.order_requests add constraint order_requests_protocol_identity check (
 protocol_version in(1,2) and sender_user_id<>recipient_user_id
 and((sender_user_id=buyer_origin_id and recipient_user_id=seller_origin_id)
 or(sender_user_id=seller_origin_id and recipient_user_id=buyer_origin_id))
 and(protocol_version<>1 or(sender_user_id=seller_origin_id and recipient_user_id=buyer_origin_id)));
-- Original participant-origin partial unique index remains. Neither includes protocol.
create unique index order_requests_conversation_one_active on public.order_requests(conversation_id) where status='active';
create function marketplace_private.prepare_request_protocol_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.conversations; l public.listings; actor uuid:=auth.uid();
begin
 -- Listing -> Conversation lock order matches V1 mutation/Accept.
 select * into l from public.listings where id=new.listing_id for update;
 select * into c from public.conversations where id=new.conversation_id for update;
 if not found or c.buyer_id is null or c.seller_id is null or l.id is null
 or l.seller_id is distinct from c.seller_id or c.listing_id is distinct from new.listing_id
 or c.listing_origin_id is distinct from new.listing_origin_id
 or c.buyer_id is distinct from new.buyer_origin_id or c.seller_id is distinct from new.seller_origin_id
 or c.buyer_id is distinct from new.buyer_id or c.seller_id is distinct from new.seller_id then
 raise exception 'Proposal conversation identity mismatch.' using errcode='42501'; end if;
 new.protocol_version:=coalesce(new.protocol_version,1);
 if new.protocol_version=1 then
 if(new.sender_user_id is not null and new.sender_user_id<>c.seller_id)
 or(new.recipient_user_id is not null and new.recipient_user_id<>c.buyer_id) then
 raise exception 'Legacy sender/recipient mismatch.' using errcode='42501'; end if;
 new.sender_user_id:=c.seller_id;new.recipient_user_id:=c.buyer_id;
 elsif new.protocol_version=2 then
 -- Trusted inserts only: clients have no table write grant; no V2 mutation RPC in A1.
 if actor is null or not coalesce(marketplace_private.is_western_user(),false)
 or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id)
 or(new.sender_user_id is not null and new.sender_user_id is distinct from actor) then
 raise exception 'Authenticated proposal sender required.' using errcode='42501'; end if;
 new.sender_user_id:=actor;
 if new.recipient_user_id is not null and new.recipient_user_id is distinct from
 (case when actor=c.buyer_id then c.seller_id else c.buyer_id end) then
 raise exception 'Proposal recipient mismatch.' using errcode='42501'; end if;
 new.recipient_user_id:=case when actor=c.buyer_id then c.seller_id else c.buyer_id end;
 else raise exception 'Unsupported proposal protocol.' using errcode='23514'; end if;
 if new.status='active' and exists(select 1 from public.order_requests r where r.conversation_id=c.id
 and r.status='active' and r.protocol_version<>new.protocol_version) then
 raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505'; end if;
 return new;
end;$$;
create trigger order_request_protocol_identity before insert on public.order_requests
for each row execute function marketplace_private.prepare_request_protocol_identity();
revoke all on function marketplace_private.prepare_request_protocol_identity() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION marketplace_private.protect_order_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Request history cannot be deleted.' using errcode='23514'; end if;
  if (to_jsonb(new) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id'])
    is distinct from (to_jsonb(old) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id']) then
    raise exception 'Request identity and terms are immutable.' using errcode='23514';
  end if;
  if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)) then
    raise exception 'Buyer cannot change.' using errcode='23514'; end if;
  if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Seller cannot change.' using errcode='23514'; end if;
  if old.protocol_version=2 and new.status is distinct from old.status then
    raise exception 'V2 transitions are not enabled in A1.' using errcode='42501'; end if;
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

CREATE OR REPLACE FUNCTION marketplace_private.order_request_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text; happened timestamptz; recipient record; details jsonb := '{}';
begin
  -- V2 sender-aware events belong to A2; trusted isolation fixtures emit no V1 events.
  if new.protocol_version<>1 then return new; end if;
  if tg_op='INSERT' then kind:='request_created'; happened:=new.created_at;
  elsif new.status is not distinct from old.status then return new;
  elsif new.status='superseded' then kind:='request_replaced'; happened:=new.replaced_at; details:=jsonb_build_object('replacementRequestId',new.replacement_request_id);
  elsif new.status='cancelled' then kind:='request_cancelled'; happened:=new.cancelled_at; details:=jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note);
  elsif new.status='expired' then kind:='request_expired'; happened:=new.expired_at;
  elsif new.status='accepted' then kind:='request_accepted'; happened:=new.accepted_at; details:=jsonb_build_object('orderId',(select id from public.orders where request_id=new.id));
  else raise exception 'Unsupported Request event.' using errcode='23514'; end if;
  insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.id,case when kind='request_expired' then null else auth.uid() end,
      case when kind='request_expired' then 'system' when kind='request_accepted' then 'buyer' else 'seller' end,kind,happened,new.id::text||':'||kind,details);
  -- Same private channel/event contract as Messages; invalidation contains no terms.
  begin
    for recipient in select members.id,members.role from public.conversations c
      cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
      join auth.users u on u.id=members.id where c.id=new.conversation_id and u.email_confirmed_at is not null
        and lower(u.email) ~ '^[^[:space:]@]+@uwo[.]ca$'
    loop
      perform realtime.send(jsonb_build_object('conversationId',new.conversation_id,'role',recipient.role,'scope','history'),
        'messages_changed','marketplace:messages:'||recipient.id::text,true);
    end loop;
  exception when others then raise log 'Request invalidation skipped; SQLSTATE=%',sqlstate; end;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION marketplace_private.expire_order_requests(p_conversation_id uuid, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.order_requests set status='expired',expired_at=p_now,updated_at=p_now
    where conversation_id=p_conversation_id and protocol_version=1 and status='active' and request_expires_at <= p_now;
end; $function$;

CREATE OR REPLACE FUNCTION marketplace_private.mutate_order_request(p_action text, p_target uuid, p_terms jsonb, p_client_action_id uuid, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS order_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.conversations; l public.listings; old_request public.order_requests; result public.order_requests;
  cmd marketplace_private.order_commands; actor uuid:=auth.uid(); conversation uuid; lid uuid; digest text;
  t timestamptz; scheduled timestamptz; local_time timestamp; amount bigint; shipping bigint; method text; cost text;
  label text; new_id uuid:=gen_random_uuid(); location text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null or p_action not in ('create','replace','cancel') then
    raise exception 'A client action UUID is required.' using errcode='23514'; end if;
  if p_terms is not null and p_terms ?| array['protocol_version','protocolVersion','sender_user_id','senderId','recipient_user_id','recipientId'] then
    raise exception 'Proposal identity is server-owned.' using errcode='42501'; end if;
  if p_action='create' then conversation:=p_target;
  else select * into old_request from public.order_requests where id=p_target;
    if not found or old_request.seller_id is distinct from actor then raise exception 'Request not accessible.' using errcode='42501'; end if;
    if old_request.protocol_version<>1 then raise exception 'V1_PROTOCOL_REQUIRED' using errcode='42501'; end if;
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
  if exists(select 1 from public.order_requests where conversation_id=c.id and status='active' and protocol_version<>1) then
    raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505'; end if;
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
    insert into public.order_requests(protocol_version,id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,
      buyer_username_snapshot,seller_username_snapshot,listing_title_snapshot,listing_description_snapshot,listing_category_snapshot,
      listing_subcategory_snapshot,listing_condition_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_media_snapshot,
      item_amount_cents,fulfillment_type,location_source,place_name,scheduled_at,schedule_timezone,request_expires_at,
      shipping_cost_mode,shipping_amount_cents,shipping_method,shipping_note,seller_note,created_at,updated_at)
    values(1,new_id,c.id,l.id,c.listing_origin_id,c.buyer_id,c.seller_id,c.buyer_id,c.seller_id,
      (select display_name from public.profiles where id=c.buyer_id),(select display_name from public.profiles where id=c.seller_id),
      l.title,l.description,l.category,l.subcategory,l.condition,l.price_cents,l.currency,
      coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'slot',i.slot) order by i.slot) from public.listing_images i where i.listing_id=l.id and i.ready),'[]'::jsonb),
      amount,method,case when method<>'shipping' then 'free_text' end,location,scheduled,case when method<>'shipping' then 'America/Toronto' end,scheduled,
      cost,shipping,case when method='shipping' then btrim(coalesce(p_terms->>'shipping_method','')) end,
      case when method='shipping' then btrim(coalesce(p_terms->>'shipping_note','')) end,btrim(coalesce(p_terms->>'seller_note','')),t,t) returning * into result;
  end if;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id) values(actor,p_action,p_client_action_id,digest,result.id);
  return result;
end; $function$;

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

CREATE OR REPLACE FUNCTION public.marketplace_order_request_history(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.conversations; lid uuid; t timestamptz;
begin
  if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or (c.buyer_id is distinct from auth.uid() and c.seller_id is distinct from auth.uid()) then
    raise exception 'Conversation not accessible.' using errcode='42501'; end if;
  lid:=c.listing_id;
  perform 1 from public.listings where id=lid for update;
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found or (c.buyer_id is distinct from auth.uid() and c.seller_id is distinct from auth.uid()) then
    raise exception 'Conversation not accessible.' using errcode='42501'; end if;
  perform marketplace_private.settle_listing_reservation(lid);
  t:=clock_timestamp();
  perform marketplace_private.expire_order_requests(c.id,t);
  return jsonb_build_object('serverTime',t,'sellerId',c.seller_id,'buyerId',c.buyer_id,
    'eligibleRequestIds',coalesce((select jsonb_agg(r.id) from public.order_requests r join public.listings l on l.id=r.listing_id
      where r.conversation_id=c.id and r.protocol_version=1 and r.status='active' and r.buyer_id=c.buyer_id and r.seller_id=c.seller_id and r.buyer_id is not null
        and l.seller_id=r.seller_id and l.status='available' and l.published_at is not null and (r.scheduled_at is null or r.scheduled_at>t)
        and not exists(select 1 from public.orders o where o.listing_origin_id=r.listing_origin_id and o.holds_listing)),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.order_requests r where r.conversation_id=c.id and r.protocol_version=1),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e where e.conversation_id=c.id and exists(select 1 from public.order_requests r where r.id=e.request_id and r.protocol_version=1)),'[]'::jsonb));
end; $function$;
commit;

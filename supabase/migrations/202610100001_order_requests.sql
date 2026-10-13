-- Formal Orders Phase 1. Review and apply to western-marketplace-staging ONLY.
-- No Orders, Accept, inventory reservation, payment or storage changes.
begin;

create table public.order_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  listing_origin_id uuid not null,
  buyer_id uuid references public.profiles(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  buyer_origin_id uuid not null,
  seller_origin_id uuid not null,
  buyer_username_snapshot text not null,
  seller_username_snapshot text not null,
  listing_title_snapshot text not null,
  listing_description_snapshot text not null,
  listing_category_snapshot text not null,
  listing_subcategory_snapshot text,
  listing_condition_snapshot text,
  listing_price_cents_snapshot bigint not null,
  listing_currency_snapshot text not null check (listing_currency_snapshot = 'CAD'),
  listing_media_snapshot jsonb not null check (jsonb_typeof(listing_media_snapshot) = 'array'),
  status text not null default 'active' check (status in ('active','superseded','accepted','expired','cancelled')),
  item_amount_cents bigint not null check (item_amount_cents between 0 and 9007199254740991),
  currency text not null default 'CAD' check (currency = 'CAD'),
  fulfillment_type text not null check (fulfillment_type in ('pickup','meet','shipping')),
  location_source text,
  place_id text,
  place_name text,
  formatted_address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  meeting_details text check (char_length(meeting_details) <= 1000),
  scheduled_at timestamptz,
  schedule_timezone text,
  shipping_cost_mode text check (shipping_cost_mode in ('included','flat_rate','pending')),
  shipping_amount_cents bigint check (shipping_amount_cents between 0 and 9007199254740991),
  shipping_method text check (char_length(shipping_method) <= 120),
  shipping_note text check (char_length(shipping_note) <= 1000),
  seller_note text check (char_length(seller_note) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  request_expires_at timestamptz,
  replaced_at timestamptz,
  replacement_request_id uuid references public.order_requests(id) deferrable initially deferred,
  accepted_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancelled_by_role text check (cancelled_by_role = 'seller'),
  cancel_reason_code text,
  cancel_reason_label_snapshot text,
  cancel_note text check (char_length(cancel_note) <= 1000),
  check (buyer_origin_id <> seller_origin_id),
  check ((status = 'active' and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at) = 0)
    or (status = 'superseded' and replaced_at is not null and replacement_request_id is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at) = 1)
    or (status = 'accepted' and accepted_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at) = 1)
    or (status = 'expired' and expired_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at) = 1)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by = seller_origin_id and cancel_reason_code is not null and cancel_reason_label_snapshot is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at) = 1)),
  check ((fulfillment_type = 'shipping' and scheduled_at is null and request_expires_at is null
      and location_source is null and place_id is null and place_name is null and formatted_address is null
      and latitude is null and longitude is null and meeting_details is null and schedule_timezone is null
      and ((shipping_cost_mode = 'included' and shipping_amount_cents = 0)
        or (shipping_cost_mode = 'flat_rate' and shipping_amount_cents is not null)
        or (shipping_cost_mode = 'pending' and shipping_amount_cents is null)))
    or (fulfillment_type in ('pickup','meet') and scheduled_at is not null and request_expires_at = scheduled_at
      and schedule_timezone = 'America/Toronto' and location_source = 'free_text'
      and char_length(btrim(place_name)) between 1 and 120 and place_id is null and latitude is null and longitude is null
      and shipping_cost_mode is null and shipping_amount_cents is null and shipping_method is null and shipping_note is null))
);
create unique index order_requests_one_active on public.order_requests(listing_origin_id,buyer_origin_id,seller_origin_id) where status = 'active';
create index order_requests_history on public.order_requests(conversation_id,created_at,id);
create index order_requests_buyer on public.order_requests(buyer_id,created_at desc,id);
create index order_requests_seller on public.order_requests(seller_id,created_at desc,id);
create index order_requests_listing on public.order_requests(listing_id);
create index order_requests_replacement on public.order_requests(replacement_request_id);
create index order_requests_expiry on public.order_requests(request_expires_at,id) where status = 'active';

create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  request_id uuid not null references public.order_requests(id) on delete restrict,
  -- Phase 2 adds the Orders FK; there is no Order in Phase 1.
  order_id uuid check (order_id is null),
  actor_id uuid,
  actor_role text not null check (actor_role in ('seller','system')),
  event_type text not null check (event_type in ('request_created','request_replaced','request_cancelled','request_expired')),
  created_at timestamptz not null,
  transition_key text not null unique,
  metadata_schema_version integer not null default 1 check (metadata_schema_version = 1),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object')
);
create index transaction_events_history on public.transaction_events(conversation_id,created_at,id);
create index transaction_events_request on public.transaction_events(request_id,created_at,id);

create table marketplace_private.order_commands (
  id uuid primary key default gen_random_uuid(),
  actor_key uuid not null,
  action text not null check (action in ('create','replace','cancel')),
  idempotency_key uuid not null,
  input_digest text not null,
  request_id uuid not null references public.order_requests(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_key,action,idempotency_key)
);
create index order_commands_request on marketplace_private.order_commands(request_id);
alter table marketplace_private.order_commands enable row level security;
alter table public.order_requests enable row level security;
alter table public.transaction_events enable row level security;
revoke all on public.order_requests, public.transaction_events, marketplace_private.order_commands from public,anon,authenticated,service_role;
grant select on public.order_requests,public.transaction_events to authenticated;
create policy order_requests_participant_read on public.order_requests for select to authenticated using (
  (select marketplace_private.is_western_user()) and (buyer_id = (select auth.uid()) or seller_id = (select auth.uid())));
create policy transaction_events_participant_read on public.transaction_events for select to authenticated using (
  exists(select 1 from public.order_requests r where r.id = transaction_events.request_id and r.conversation_id = transaction_events.conversation_id));

create function marketplace_private.protect_order_request() returns trigger
language plpgsql security definer set search_path = '' as $$
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
  if new.status = old.status then
    if (to_jsonb(new) - array['buyer_id','seller_id','updated_at']) is distinct from (to_jsonb(old) - array['buyer_id','seller_id','updated_at']) then
      raise exception 'Lifecycle cannot change without a transition.' using errcode='23514'; end if;
  elsif old.status <> 'active' or new.status not in ('superseded','cancelled','expired') then
    raise exception 'Invalid Request transition; Accept is not enabled.' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger order_request_immutable before update or delete on public.order_requests for each row execute function marketplace_private.protect_order_request();
create function marketplace_private.protect_transaction_event() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Transaction events are append-only.' using errcode='23514'; end; $$;
create trigger transaction_events_immutable before update or delete on public.transaction_events for each row execute function marketplace_private.protect_transaction_event();

create function marketplace_private.order_request_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare kind text; happened timestamptz; recipient record; details jsonb := '{}';
begin
  if tg_op='INSERT' then kind:='request_created'; happened:=new.created_at;
  elsif new.status is not distinct from old.status then return new;
  elsif new.status='superseded' then kind:='request_replaced'; happened:=new.replaced_at; details:=jsonb_build_object('replacementRequestId',new.replacement_request_id);
  elsif new.status='cancelled' then kind:='request_cancelled'; happened:=new.cancelled_at; details:=jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note);
  elsif new.status='expired' then kind:='request_expired'; happened:=new.expired_at;
  else raise exception 'Unsupported Phase 1 event.' using errcode='23514'; end if;
  insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.id,case when kind='request_expired' then null else auth.uid() end,
      case when kind='request_expired' then 'system' else 'seller' end,kind,happened,new.id::text||':'||kind,details);
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
end; $$;
create trigger order_request_event after insert or update on public.order_requests for each row execute function marketplace_private.order_request_event();

create function marketplace_private.expire_order_requests(p_conversation_id uuid,p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.order_requests set status='expired',expired_at=p_now,updated_at=p_now
    where conversation_id=p_conversation_id and status='active' and request_expires_at <= p_now;
end; $$;

create function public.marketplace_order_request_history(p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  t:=clock_timestamp();
  perform marketplace_private.expire_order_requests(c.id,t);
  return jsonb_build_object('serverTime',t,'sellerId',c.seller_id,'buyerId',c.buyer_id,
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.order_requests r where r.conversation_id=c.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e where e.conversation_id=c.id),'[]'::jsonb));
end; $$;

create function marketplace_private.mutate_order_request(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_reason text default null,p_note text default null)
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
  lid:=c.listing_id;
  select * into l from public.listings where id=lid for update;
  select * into c from public.conversations where id=conversation for update;
  if not found or c.seller_id is distinct from actor or c.buyer_id is null or c.listing_id is distinct from lid then
    raise exception 'Seller conversation required.' using errcode='42501'; end if;
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
    -- Orders/unfinished-order checks are introduced atomically with Phase 2; no Orders exist now.
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

create function public.marketplace_create_order_request(p_conversation_id uuid,p_terms jsonb,p_client_action_id uuid) returns public.order_requests
language sql security definer set search_path = '' as $$ select marketplace_private.mutate_order_request('create',p_conversation_id,p_terms,p_client_action_id); $$;
create function public.marketplace_replace_order_request(p_request_id uuid,p_terms jsonb,p_client_action_id uuid) returns public.order_requests
language sql security definer set search_path = '' as $$ select marketplace_private.mutate_order_request('replace',p_request_id,p_terms,p_client_action_id); $$;
create function public.marketplace_cancel_order_request(p_request_id uuid,p_reason_code text,p_note text,p_client_action_id uuid) returns public.order_requests
language sql security definer set search_path = '' as $$ select marketplace_private.mutate_order_request('cancel',p_request_id,null,p_client_action_id,p_reason_code,p_note); $$;

revoke all on function marketplace_private.protect_order_request(),marketplace_private.protect_transaction_event(),marketplace_private.order_request_event(),
  marketplace_private.expire_order_requests(uuid,timestamptz),marketplace_private.mutate_order_request(text,uuid,jsonb,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_request_history(uuid),public.marketplace_create_order_request(uuid,jsonb,uuid),
  public.marketplace_replace_order_request(uuid,jsonb,uuid),public.marketplace_cancel_order_request(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_request_history(uuid),public.marketplace_create_order_request(uuid,jsonb,uuid),
  public.marketplace_replace_order_request(uuid,jsonb,uuid),public.marketplace_cancel_order_request(uuid,text,text,uuid) to authenticated;
commit;

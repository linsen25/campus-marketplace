-- Formal Accept vertical slice. STAGING pcaqxezdfxofysghssyo ONLY.
-- No payment provider/simulator, shipping quote, handoff or protection.
begin;

alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('available','reserved','sold'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.order_requests(id) on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  listing_origin_id uuid not null,
  buyer_id uuid references public.profiles(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  buyer_origin_id uuid not null,
  seller_origin_id uuid not null,
  terms_schema_version integer not null default 1 check (terms_schema_version=1),
  terms_snapshot jsonb not null check (jsonb_typeof(terms_snapshot)='object'),
  item_amount_cents bigint not null check (item_amount_cents between 0 and 9007199254740991),
  shipping_amount_cents bigint check (shipping_amount_cents between 0 and 9007199254740991),
  service_fee_amount_cents bigint check (service_fee_amount_cents between 100 and 1500),
  seller_fee_amount_cents bigint not null default 0 check (seller_fee_amount_cents=0),
  total_amount_cents bigint check (total_amount_cents between 0 and 9007199254740991),
  currency text not null default 'CAD' check (currency='CAD'),
  service_fee_rule_version text not null default 'preview_cad_v1' check (service_fee_rule_version='preview_cad_v1'),
  money_status text not null check (money_status in ('finalized','shipping_pending')),
  payment_status text not null default 'not_enabled' check (payment_status='not_enabled'),
  fulfillment_status text not null default 'awaiting_payment' check (fulfillment_status='awaiting_payment'),
  lifecycle_status text not null default 'open' check (lifecycle_status in ('open','expired')),
  holds_listing boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  accepted_at timestamptz not null,
  reservation_started_at timestamptz,
  reservation_expires_at timestamptz,
  reservation_ended_at timestamptz,
  expired_at timestamptz,
  check (buyer_origin_id<>seller_origin_id),
  check (created_at=accepted_at and ((money_status='finalized' and reservation_started_at is not null and reservation_expires_at is not null and accepted_at=reservation_started_at and reservation_expires_at=reservation_started_at+interval '30 minutes')
    or (money_status='shipping_pending' and reservation_started_at is null and reservation_expires_at is null))),
  check ((lifecycle_status='open' and holds_listing=(money_status='finalized') and reservation_ended_at is null and expired_at is null)
    or (lifecycle_status='expired' and not holds_listing and reservation_ended_at=expired_at and expired_at is not null)),
  check ((money_status='shipping_pending' and shipping_amount_cents is null and service_fee_amount_cents is null and total_amount_cents is null)
    or (money_status='finalized' and shipping_amount_cents is not null and service_fee_amount_cents is not null and total_amount_cents is not null
      and total_amount_cents::numeric=item_amount_cents::numeric+shipping_amount_cents::numeric+service_fee_amount_cents::numeric))
);
create unique index orders_listing_hold on public.orders(listing_origin_id) where holds_listing;
create unique index orders_unfinished_buyer on public.orders(buyer_origin_id,listing_origin_id) where lifecycle_status='open';
create index orders_buyer on public.orders(buyer_id,created_at desc,id);
create index orders_seller on public.orders(seller_id,created_at desc,id);
create index orders_conversation on public.orders(conversation_id,created_at,id);
create index orders_listing on public.orders(listing_id);
create index orders_expiry on public.orders(reservation_expires_at,id) where holds_listing;
alter table public.orders enable row level security;
revoke all on public.orders from public,anon,authenticated,service_role;
grant select on public.orders to authenticated;
create policy orders_participant_read on public.orders for select to authenticated using (
  (select marketplace_private.is_western_user()) and (buyer_id=(select auth.uid()) or seller_id=(select auth.uid())));

alter table public.listings add column reserved_order_id uuid references public.orders(id) on delete restrict deferrable initially deferred;
alter table public.listings add constraint listings_inventory_pair check ((status='reserved')=(reserved_order_id is not null));
create index listings_reserved_order on public.listings(reserved_order_id) where reserved_order_id is not null;
alter table marketplace_private.order_commands drop constraint order_commands_action_check;
alter table marketplace_private.order_commands add constraint order_commands_action_check check (action in ('create','replace','cancel','accept'));
alter table marketplace_private.order_commands add column order_id uuid references public.orders(id) on delete restrict;
alter table public.transaction_events drop constraint transaction_events_order_id_check;
alter table public.transaction_events add constraint transaction_events_order_fk foreign key(order_id) references public.orders(id) on delete restrict;
alter table public.transaction_events drop constraint transaction_events_actor_role_check;
alter table public.transaction_events add constraint transaction_events_actor_role_check check(actor_role in ('seller','buyer','system'));
alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in (
  'request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired'));
create index transaction_events_order on public.transaction_events(order_id,created_at,id);

create function marketplace_private.order_money(p_item bigint,p_shipping bigint) returns jsonb
language plpgsql immutable set search_path='' as $$
declare subtotal numeric; fee bigint; total numeric;
begin
  if p_item is null or p_item<0 or p_item>9007199254740991 or p_shipping<0 or p_shipping>9007199254740991 then
    raise exception 'Invalid amounts.' using errcode='23514'; end if;
  if p_shipping is null then return jsonb_build_object('fee',null,'total',null); end if;
  subtotal:=p_item::numeric+p_shipping::numeric;
  fee:=least(1500,greatest(100,round(subtotal*0.04)))::bigint; total:=subtotal+fee;
  if total>9007199254740991 then raise exception 'Amount overflow.' using errcode='23514'; end if;
  return jsonb_build_object('fee',fee,'total',total::bigint);
end; $$;

create function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
  if tg_op='DELETE' then raise exception 'Order history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='INSERT' then
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
  elsif old.lifecycle_status<>'open' or new.lifecycle_status<>'expired' or old.reservation_expires_at is null or old.reservation_expires_at>clock_timestamp() then
    raise exception 'Invalid Order transition.' using errcode='23514'; end if;
  return new;
end; $$;
create trigger orders_immutable before insert or update or delete on public.orders for each row execute function marketplace_private.protect_order();

create function marketplace_private.protect_listing_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
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
create trigger listings_inventory_guard before update or delete on public.listings for each row execute function marketplace_private.protect_listing_inventory();

create function marketplace_private.protect_unfinished_order_participant() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.orders where lifecycle_status='open' and (buyer_id=old.id or seller_id=old.id)) then
    raise exception 'Resolve unfinished Orders before account deletion.' using errcode='23514'; end if;
  return old;
end; $$;
create trigger profiles_order_retention before delete on public.profiles for each row execute function marketplace_private.protect_unfinished_order_participant();

create function marketplace_private.notify_order_history(p_conversation uuid) returns void
language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
  for recipient in select members.id,members.role from public.conversations c
    cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
    join auth.users u on u.id=members.id where c.id=p_conversation and u.email_confirmed_at is not null
      and lower(u.email) ~ '^[^[:space:]@]+@uwo[.]ca$'
  loop
    perform realtime.send(jsonb_build_object('conversationId',p_conversation,'role',recipient.role,'scope','history'),
      'messages_changed','marketplace:messages:'||recipient.id::text,true);
  end loop;
exception when others then raise log 'Order invalidation skipped; SQLSTATE=%',sqlstate;
end; $$;
create function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
  if tg_op='INSERT' then kind:='order_created'; happened:=new.created_at;
  elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
  else kind:='reservation_expired'; happened:=new.expired_at; end if;
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.request_id,new.id,case when kind='order_created' then auth.uid() end,
      case when kind='order_created' then 'buyer' else 'system' end,kind,happened,new.id::text||':'||kind,
      jsonb_build_object('orderId',new.id));
  perform marketplace_private.notify_order_history(new.conversation_id);
  return new;
end; $$;
create trigger orders_event after insert or update on public.orders for each row execute function marketplace_private.order_event();

create function marketplace_private.settle_listing_reservation(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; t timestamptz;
begin
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing for update;
  if not found then return; end if;
  t:=clock_timestamp();
  if o.reservation_expires_at<=t then
    update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
    update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
  end if;
end; $$;

create function public.marketplace_accept_order_request(p_request_id uuid,p_client_action_id uuid) returns public.orders
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

create function public.marketplace_order_workspace(p_workspace text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); lid uuid;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_workspace not in ('purchases','sales') then raise exception 'Invalid workspace.' using errcode='23514'; end if;
  for lid in select distinct listing_id from public.orders where buyer_id=actor or seller_id=actor order by listing_id loop
    perform marketplace_private.settle_listing_reservation(lid);
  end loop;
  return jsonb_build_object('serverTime',clock_timestamp(),'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc,o.id)
    from public.orders o where (p_workspace='purchases' and o.buyer_id=actor) or(p_workspace='sales' and o.seller_id=actor)),'[]'::jsonb));
end; $$;

-- Phase 1 guards/functions are deliberately replaced below without rewriting its migration.

create or replace function marketplace_private.protect_order_request() returns trigger
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
  elsif old.status <> 'active' or new.status not in ('superseded','cancelled','expired','accepted') then
    raise exception 'Invalid Request transition.' using errcode='23514';
  end if;
  if new.status='accepted' and old.status='active' and (auth.uid() is distinct from new.buyer_id or not exists(select 1 from public.orders o where o.request_id=new.id and o.accepted_at=new.accepted_at and o.buyer_id=new.buyer_id)) then
    raise exception 'Atomic Buyer Order required.' using errcode='23514'; end if;
  return new;
end; $$;

create or replace function marketplace_private.order_request_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare kind text; happened timestamptz; recipient record; details jsonb := '{}';
begin
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
end; $$;

create or replace function public.marketplace_order_request_history(p_conversation_id uuid) returns jsonb
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
  perform marketplace_private.settle_listing_reservation(lid);
  t:=clock_timestamp();
  perform marketplace_private.expire_order_requests(c.id,t);
  return jsonb_build_object('serverTime',t,'sellerId',c.seller_id,'buyerId',c.buyer_id,
    'eligibleRequestIds',coalesce((select jsonb_agg(r.id) from public.order_requests r join public.listings l on l.id=r.listing_id
      where r.conversation_id=c.id and r.status='active' and r.buyer_id=c.buyer_id and r.seller_id=c.seller_id and r.buyer_id is not null
        and l.seller_id=r.seller_id and l.status='available' and l.published_at is not null and (r.scheduled_at is null or r.scheduled_at>t)
        and not exists(select 1 from public.orders o where o.listing_origin_id=r.listing_origin_id and o.holds_listing)),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.order_requests r where r.conversation_id=c.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e where e.conversation_id=c.id),'[]'::jsonb));
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

create function public.marketplace_order_detail(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; actor uuid:=auth.uid();
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found or (o.buyer_id is distinct from actor and o.seller_id is distinct from actor) then raise exception 'Order not accessible.' using errcode='42501'; end if;
  perform marketplace_private.settle_listing_reservation(o.listing_id);
  select * into o from public.orders where id=p_order_id;
  return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
end; $$;

revoke all on function marketplace_private.order_money(bigint,bigint),marketplace_private.protect_order(),marketplace_private.protect_listing_inventory(),
  marketplace_private.protect_unfinished_order_participant(),marketplace_private.notify_order_history(uuid),marketplace_private.order_event(),marketplace_private.settle_listing_reservation(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.marketplace_accept_order_request(uuid,uuid),public.marketplace_order_workspace(text),public.marketplace_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_accept_order_request(uuid,uuid),public.marketplace_order_workspace(text),public.marketplace_order_detail(uuid) to authenticated;
commit;

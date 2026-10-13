-- Locked backend contract: staging-only Notifications/price-drop foundation.
-- No UI, email delivery, provider integration, historical notification backfill,
-- or transaction lifecycle authority. Transaction events remain the source facts.
begin;

create table marketplace_private.notification_events (
 id uuid primary key default gen_random_uuid(),
 source_key text not null unique,
 event_type text not null,
 created_at timestamptz not null default clock_timestamp(),
 destination jsonb not null check(jsonb_typeof(destination)='object')
);
alter table marketplace_private.notification_events enable row level security;
revoke all on marketplace_private.notification_events from public,anon,authenticated,service_role;

create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_user_id uuid not null references public.profiles(id) on delete cascade,
 domain_event_id uuid not null references marketplace_private.notification_events(id),
 event_type text not null,
 priority text not null check(priority in('ACTION_REQUIRED','INFORMATIONAL')),
 created_at timestamptz not null,
 updated_at timestamptz not null,
 read_at timestamptz,
 destination jsonb not null check(jsonb_typeof(destination)='object'),
 coalescing_key text,
 original_price_cents bigint,
 latest_price_cents bigint,
 unique(recipient_user_id,domain_event_id),
 check((event_type='price_drop' and coalescing_key is not null
   and original_price_cents between 0 and 9007199254740991
   and latest_price_cents between 0 and 9007199254740991)
   or(event_type<>'price_drop' and original_price_cents is null and latest_price_cents is null))
);
create index notifications_recipient_newest on public.notifications(recipient_user_id,created_at desc,id desc);
create unique index notifications_unread_coalescing on public.notifications(recipient_user_id,coalescing_key)
 where read_at is null and coalescing_key is not null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated,service_role;
grant select on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated
using((select marketplace_private.is_western_user()) and recipient_user_id=(select auth.uid()));

-- Private projector takes only a trusted event identity and bounded destination.
-- It never consumes an address, chat text, credential, payment instrument or token.
create function marketplace_private.deliver_notification(p_event uuid,p_recipient uuid,p_priority text)
returns void language plpgsql security definer set search_path='' as $$
declare e marketplace_private.notification_events;
begin
 if p_recipient is null then return;end if;
 select * into e from marketplace_private.notification_events where id=p_event;
 if e.id is null then raise exception 'Notification event required.' using errcode='23514';end if;
 insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination)
 select p_recipient,e.id,e.event_type,p_priority,e.created_at,e.created_at,
 e.destination||case when e.destination->>'section'='orders' then jsonb_build_object('destination',
   case when p_recipient=(select buyer_id from public.orders where id=(e.destination->>'orderId')::uuid) then 'purchases' else 'sales' end)
 when e.destination->>'section'='messages' then jsonb_build_object('destination',
   case when p_recipient=(select buyer_id from public.conversations where id=(e.destination->>'conversationId')::uuid) then 'buying' else 'selling' end)
 else '{}'::jsonb end
 where exists(select 1 from public.profiles where id=p_recipient)
 on conflict(recipient_user_id,domain_event_id) do nothing;
end;$$;

create function marketplace_private.project_transaction_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;o public.orders;event_id uuid;dest jsonb;kind text;target uuid;priority text:='INFORMATIONAL';
begin
 select * into r from public.order_requests where id=new.request_id;
 -- V1 remains independent; no historical or synthetic preview fanout.
 if r.protocol_version is distinct from 2 then return new;end if;
 if new.order_id is not null then select * into o from public.orders where id=new.order_id;end if;
 dest:=case when o.id is not null then jsonb_build_object('section','orders','orderId',o.id)
 else jsonb_build_object('section','messages','conversationId',new.conversation_id,'offerId',r.id) end;
 kind:=new.event_type;
 if kind='offer_created' then
  kind:=case when new.metadata->>'previousOfferId' is not null and exists(
   select 1 from public.order_requests prev where prev.id=(new.metadata->>'previousOfferId')::uuid
   and prev.sender_user_id<>r.sender_user_id) then 'incoming_counter_offer' else 'incoming_offer' end;
  target:=r.recipient_user_id;priority:='ACTION_REQUIRED';
 elsif kind='offer_withdrawn' then target:=r.recipient_user_id;
 elsif kind='offer_accepted' then target:=r.sender_user_id;
 elsif kind in('meetup_proposed','meetup_confirmed','meetup_declined') then
  target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
  if kind='meetup_proposed' then priority:='ACTION_REQUIRED';end if;
 elsif kind='order_cancelled' and new.actor_id is not null then
  target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
 elsif kind='payment_paid' then target:=r.seller_id;
 elsif kind in('offer_closed','order_no_show_expired','order_expired','order_cancelled','protection_started','order_completed') then target:=null;
 elsif kind in('handoff_confirmed','courier_shipped') then target:=r.buyer_id;
 elsif kind in('buyer_confirm_received','protection_case_opened') then target:=r.seller_id;
 else return new;end if;
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values('transaction:'||new.id,kind,new.created_at,dest) on conflict(source_key) do nothing;
 select id into event_id from marketplace_private.notification_events where source_key='transaction:'||new.id;
 if target is not null then
  if target is distinct from new.actor_id then perform marketplace_private.deliver_notification(event_id,target,priority);end if;
 else
  if r.buyer_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(event_id,r.buyer_id,priority);end if;
  if r.seller_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(event_id,r.seller_id,priority);end if;
 end if;
 return new;
end;$$;
create trigger transaction_notification_projector after insert on public.transaction_events
for each row execute function marketplace_private.project_transaction_notification();

create function marketplace_private.project_listing_price_drop() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_id uuid;recipient uuid;t timestamptz:=clock_timestamp();
begin
 if new.price_cents>=old.price_cents or new.published_at is null then return new;end if;
 -- The Listing row lock serializes price changes. The partial unique index and
 -- upsert serialize fanout against mark-read; no availability subscription inferred.
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values('listing-price:'||gen_random_uuid(),'price_drop',t,jsonb_build_object('section','listing','listingId',new.id))
 returning id into event_id;
 for recipient in select user_id from public.listing_favorites where listing_id=new.id order by user_id loop
  if recipient is not distinct from auth.uid() then continue;end if;
  insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination,
   coalescing_key,original_price_cents,latest_price_cents)
  values(recipient,event_id,'price_drop','INFORMATIONAL',t,t,jsonb_build_object('section','listing','listingId',new.id),
   'price-drop:'||new.id,old.price_cents,new.price_cents)
  on conflict(recipient_user_id,coalescing_key) where read_at is null and coalescing_key is not null
  do update set latest_price_cents=excluded.latest_price_cents,updated_at=excluded.updated_at;
 end loop;
 return new;
end;$$;
create trigger listing_price_drop_projector after update of price_cents on public.listings
for each row execute function marketplace_private.project_listing_price_drop();

create function public.marketplace_notifications(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();items jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
 raise exception 'Verified account required.' using errcode='42501';end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'Complete cursor required.' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc),'[]'::jsonb) into items from(
 select id,event_type,priority,created_at,updated_at,read_at,destination,original_price_cents,latest_price_cents
 from public.notifications where recipient_user_id=actor
 and(p_before is null or(created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50) v;
 return jsonb_build_object('notifications',items,'unreadCount',(select count(*) from public.notifications where recipient_user_id=actor and read_at is null));
end;$$;
create function public.marketplace_mark_notification_read(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.notifications;actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
 raise exception 'Verified account required.' using errcode='42501';end if;
 update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where id=p_id and recipient_user_id=actor returning * into n;
 if n.id is null then raise exception 'Notification not accessible.' using errcode='42501';end if;
 return jsonb_build_object('id',n.id,'readAt',n.read_at);
end;$$;
revoke all on function marketplace_private.deliver_notification(uuid,uuid,text),
 marketplace_private.project_transaction_notification(),marketplace_private.project_listing_price_drop(),
 public.marketplace_notifications(timestamptz,uuid),public.marketplace_mark_notification_read(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.marketplace_notifications(timestamptz,uuid),public.marketplace_mark_notification_read(uuid) to authenticated;
commit;

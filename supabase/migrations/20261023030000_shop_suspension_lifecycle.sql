-- B26-B: Shop suspension lifecycle, Offer termination and system messaging.
-- No scheduler is installed and Shop transaction admission remains unchanged/off.
begin;

create table marketplace_private.shop_suspension_cycles (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.shops(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 access_cycle_id uuid not null,
 suspended_at timestamptz not null,
 state text not null default 'open' check(state in('open','reopened')),
 offers_closed_at timestamptz,
 offers_closed_count integer not null default 0 check(offers_closed_count>=0),
 reopened_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(owner_id,access_cycle_id,suspended_at),
 check((state='open' and reopened_at is null) or(state='reopened' and reopened_at is not null)),
 check(updated_at>=created_at and suspended_at<=created_at)
);
create index shop_suspension_cycles_open on marketplace_private.shop_suspension_cycles(owner_id,created_at,id)
 where state='open';

create table marketplace_private.shop_suspension_offer_closures (
 offer_id uuid primary key references public.order_requests(id) on delete restrict,
 suspension_cycle_id uuid not null references marketplace_private.shop_suspension_cycles(id) on delete restrict,
 closed_at timestamptz not null,
 reason text not null default 'shop_membership_suspended' check(reason='shop_membership_suspended')
);
create index shop_suspension_offer_cycle on marketplace_private.shop_suspension_offer_closures(suspension_cycle_id,offer_id);

create table marketplace_private.shop_suspension_message_events (
 id uuid primary key default gen_random_uuid(),
 suspension_cycle_id uuid not null references marketplace_private.shop_suspension_cycles(id) on delete restrict,
 conversation_id uuid not null references public.conversations(id) on delete restrict,
 trigger_message_id uuid references public.messages(id) on delete restrict,
 message_id uuid not null unique,
 kind text not null check(kind in('suspended','reminder','reopened')),
 event_key text not null unique check(length(event_key) between 20 and 300),
 occurred_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(message_id) references public.messages(id) on delete restrict deferrable initially deferred,
 check((kind='reminder' and trigger_message_id is not null)
  or kind='suspended'
  or(kind='reopened' and trigger_message_id is null))
);
create index shop_suspension_message_window on marketplace_private.shop_suspension_message_events(
 suspension_cycle_id,conversation_id,occurred_at desc,id
) where kind in('suspended','reminder');

create table marketplace_private.shop_membership_lifecycle_cursor (
 singleton boolean primary key default true check(singleton),
 after_owner uuid,
 lease uuid,
 lease_until timestamptz,
 last_run_at timestamptz,
 check((lease is null)=(lease_until is null))
);
insert into marketplace_private.shop_membership_lifecycle_cursor(singleton) values(true);

alter table marketplace_private.shop_suspension_cycles enable row level security;
alter table marketplace_private.shop_suspension_offer_closures enable row level security;
alter table marketplace_private.shop_suspension_message_events enable row level security;
alter table marketplace_private.shop_membership_lifecycle_cursor enable row level security;
revoke all on marketplace_private.shop_suspension_cycles,
 marketplace_private.shop_suspension_offer_closures,
 marketplace_private.shop_suspension_message_events,
 marketplace_private.shop_membership_lifecycle_cursor from public,anon,authenticated,service_role;

create function marketplace_private.protect_shop_suspension_history() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Shop suspension history is retained.' using errcode='42501';end if;
 if tg_table_name='shop_suspension_cycles' then
  if (to_jsonb(new)-array['state','offers_closed_at','offers_closed_count','reopened_at','updated_at']) is distinct from
     (to_jsonb(old)-array['state','offers_closed_at','offers_closed_count','reopened_at','updated_at'])
   or old.state='reopened' or new.offers_closed_count<old.offers_closed_count then
   raise exception 'Shop suspension identity/history is immutable.' using errcode='42501';end if;
  return new;
 end if;
 raise exception 'Shop suspension evidence is immutable.' using errcode='42501';
end;$$;
create trigger shop_suspension_cycles_history before update or delete on marketplace_private.shop_suspension_cycles
 for each row execute function marketplace_private.protect_shop_suspension_history();
create trigger shop_suspension_offer_history before update or delete on marketplace_private.shop_suspension_offer_closures
 for each row execute function marketplace_private.protect_shop_suspension_history();
create trigger shop_suspension_message_history before update or delete on marketplace_private.shop_suspension_message_events
 for each row execute function marketplace_private.protect_shop_suspension_history();

create function marketplace_private.shop_conversation_has_order(p_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.conversation_id=p_conversation and o.order_protocol_version=2);
$$;

create function marketplace_private.assert_shop_message_send(p_conversation public.conversations,p_actor uuid,p_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare entitlement jsonb;
begin
 if p_conversation.listing_channel_snapshot is distinct from 'shop' then return;end if;
 if marketplace_private.shop_conversation_has_order(p_conversation.id) then return;end if;
 begin entitlement:=marketplace_private.shop_entitlements(p_conversation.seller_id,p_at);
 exception when others then
  raise exception 'Shop membership unavailable.' using errcode='42501';
 end;
 if entitlement->>'status' is null then raise exception 'Shop membership unavailable.' using errcode='42501';end if;
 if entitlement->>'status'='suspended' and p_actor=p_conversation.seller_id then
  raise exception 'The suspended Shop cannot send in this consultation.' using errcode='42501';
 end if;
end;$$;

create function marketplace_private.ensure_shop_suspension_cycle(p_owner uuid,p_at timestamptz)
returns marketplace_private.shop_suspension_cycles
language plpgsql security definer set search_path='' as $$
declare entitlement jsonb;shop public.shops;result marketplace_private.shop_suspension_cycles;
 cycle_id uuid;suspended timestamptz;
begin
 entitlement:=marketplace_private.shop_entitlements(p_owner,p_at);
 if entitlement->>'status' is distinct from 'suspended' then return null;end if;
 cycle_id:=nullif(entitlement->>'accessCycleId','')::uuid;
 suspended:=nullif(entitlement->>'graceEndsAt','')::timestamptz;
 if cycle_id is null or suspended is null or suspended>p_at then
  raise exception 'Suspension identity unavailable.' using errcode='42501';end if;
 select * into shop from public.shops where owner_id=p_owner for key share;
 if shop.id is null then raise exception 'Suspended Shop unavailable.' using errcode='42501';end if;
 insert into marketplace_private.shop_suspension_cycles(shop_id,owner_id,access_cycle_id,suspended_at)
 values(shop.id,p_owner,cycle_id,suspended)
 on conflict(owner_id,access_cycle_id,suspended_at) do nothing;
 select * into strict result from marketplace_private.shop_suspension_cycles
  where owner_id=p_owner and access_cycle_id=cycle_id and suspended_at=suspended for update;
 if result.state<>'open' then raise exception 'Stale suspension cycle.' using errcode='40001';end if;
 return result;
end;$$;

create function marketplace_private.insert_shop_suspension_message(
 p_cycle uuid,p_conversation uuid,p_kind text,p_at timestamptz,p_trigger uuid default null
) returns public.messages language plpgsql security definer set search_path='' as $$
declare cycle marketplace_private.shop_suspension_cycles;c public.conversations;
 event marketplace_private.shop_suspension_message_events;result public.messages;key text;body text;mid uuid:=gen_random_uuid();
 entitlement jsonb;
begin
 if p_kind not in('suspended','reminder','reopened') or p_at is null then
  raise exception 'Invalid Shop system message.' using errcode='23514';end if;
 select * into cycle from marketplace_private.shop_suspension_cycles where id=p_cycle for update;
 select * into c from public.conversations where id=p_conversation for update;
 if cycle.id is null or c.id is null or c.listing_channel_snapshot is distinct from 'shop'
  or c.seller_id is distinct from cycle.owner_id or c.buyer_id is null
  or marketplace_private.shop_conversation_has_order(c.id) then return null;end if;
 entitlement:=marketplace_private.shop_entitlements(cycle.owner_id,p_at);
 if p_kind in('suspended','reminder') then
  if cycle.state<>'open' or entitlement->>'status' is distinct from 'suspended'
   or nullif(entitlement->>'accessCycleId','')::uuid is distinct from cycle.access_cycle_id then return null;end if;
  if p_kind='reminder' and exists(select 1 from marketplace_private.shop_suspension_message_events e
    where e.suspension_cycle_id=cycle.id and e.conversation_id=c.id and e.kind in('suspended','reminder')
     and e.occurred_at>p_at-interval '24 hours') then return null;end if;
  if p_kind='suspended' and exists(select 1 from marketplace_private.shop_suspension_message_events e
    where e.suspension_cycle_id=cycle.id and e.conversation_id=c.id and e.kind='suspended') then return null;end if;
  body:='This shop is temporarily suspended. Your message has been saved. The seller can reply once the shop reopens.';
 else
  if cycle.state<>'reopened' or entitlement->>'status' not in('trial','active','grace')
   or nullif(entitlement->>'accessCycleId','')::uuid is not distinct from cycle.access_cycle_id then return null;end if;
  if not exists(select 1 from marketplace_private.shop_suspension_message_events e
    where e.suspension_cycle_id=cycle.id and e.conversation_id=c.id and e.kind in('suspended','reminder'))
   or exists(select 1 from marketplace_private.shop_suspension_message_events e
    where e.suspension_cycle_id=cycle.id and e.conversation_id=c.id and e.kind='reopened') then return null;end if;
  body:='This shop has reopened! You can now continue your conversation with the seller.';
 end if;
 key:=p_kind||':'||cycle.id::text||':'||c.id::text||case when p_trigger is null then '' else ':'||p_trigger::text end;
 insert into marketplace_private.shop_suspension_message_events(
  suspension_cycle_id,conversation_id,trigger_message_id,message_id,kind,event_key,occurred_at)
 values(cycle.id,c.id,p_trigger,mid,p_kind,key,p_at) on conflict(event_key) do nothing returning * into event;
 if event.id is null then
  select * into event from marketplace_private.shop_suspension_message_events where event_key=key;
  select * into result from public.messages where id=event.message_id;return result;
 end if;
 insert into public.messages(id,conversation_id,sender_id,client_message_id,type,content,origin)
 values(mid,c.id,c.buyer_id,mid,'TEXT',body,'marketplace_auto_reply') returning * into result;
 return result;
end;$$;

create function marketplace_private.maybe_shop_suspension_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.conversations;cycle marketplace_private.shop_suspension_cycles;prior boolean;
begin
 if new.origin='marketplace_auto_reply' then return new;end if;
 select * into c from public.conversations where id=new.conversation_id;
 if c.listing_channel_snapshot is distinct from 'shop' or new.sender_id is distinct from c.buyer_id
  or marketplace_private.shop_conversation_has_order(c.id) then return new;end if;
 begin cycle:=marketplace_private.ensure_shop_suspension_cycle(c.seller_id,new.created_at);
 exception when sqlstate '40001' then return new;
 end;
 if cycle.id is null then return new;end if;
 select exists(select 1 from marketplace_private.shop_suspension_message_events e
  where e.suspension_cycle_id=cycle.id and e.conversation_id=c.id and e.kind in('suspended','reminder')) into prior;
 perform marketplace_private.insert_shop_suspension_message(cycle.id,c.id,
  case when prior then 'reminder' else 'suspended' end,new.created_at,new.id);
 return new;
end;$$;
create trigger zz_messages_shop_suspension_reply after insert on public.messages
 for each row execute function marketplace_private.maybe_shop_suspension_reply();

-- Preserve the canonical TEXT/IMAGE allocator while adding a database-authoritative
-- send fence and a narrowly proven UU System insertion path.
create or replace function marketplace_private.prepare_text_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare target public.conversations;actor uuid:=auth.uid();submission public.image_message_submissions;system_event boolean:=false;
begin
 select * into target from public.conversations c where c.id=new.conversation_id for update;
 select exists(select 1 from marketplace_private.shop_suspension_message_events e
  where e.message_id=new.id and e.conversation_id=new.conversation_id) into system_event;
 if system_event then
  if new.origin<>'marketplace_auto_reply' or new.type<>'TEXT' or new.sender_id is distinct from target.buyer_id
   or new.content not in(
    'This shop is temporarily suspended. Your message has been saved. The seller can reply once the shop reopens.',
    'This shop has reopened! You can now continue your conversation with the seller.'
   ) or new.image_count is not null then raise exception 'Trusted Shop system message required.' using errcode='42501';end if;
 elsif actor is null or not coalesce(marketplace_private.is_western_user(),false)
  or new.sender_id is distinct from actor then raise exception 'Verified sender required.' using errcode='42501';
 end if;
 if target.id is null or (not system_event and target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
  raise exception 'Conversation not found or not accessible.' using errcode='42501';end if;
 if not system_event then perform marketplace_private.assert_shop_message_send(target,actor,clock_timestamp());end if;
 if new.type='TEXT' then
  new.content:=marketplace_private.trim_message_text(new.content);
  if new.content is null or char_length(new.content) not between 1 and 2000 or new.image_count is not null then
   raise exception 'Send 1-2000 characters of nonblank TEXT.' using errcode='23514';end if;
  if not system_event and exists(select 1 from public.image_message_submissions s where s.conversation_id=target.id
   and s.sender_id=actor and s.client_message_id=new.client_message_id) then
   raise exception 'Submission UUID reserved for IMAGE.' using errcode='23505';end if;
 elsif new.type='IMAGE' and not system_event then
  submission:=marketplace_private.lock_image_submission(new.id);
  if submission.conversation_id<>target.id or submission.client_message_id<>new.client_message_id
   or new.content is not null or new.image_count is distinct from jsonb_array_length(submission.manifest) then
   raise exception 'IMAGE must match its canonical reservation.' using errcode='23514';end if;
  perform marketplace_private.assert_image_objects(submission);
 else raise exception 'Unsupported message type.' using errcode='23514';end if;
 new.sequence:=target.last_message_sequence+1;
 new.created_at:=greatest(clock_timestamp(),target.created_at,target.last_message_at+interval '1 microsecond');
 return new;
end;$$;

create function marketplace_private.guard_shop_image_submission() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
 if tg_op='UPDATE' and new.verified_objects is not distinct from old.verified_objects then return new;end if;
 select * into c from public.conversations where id=new.conversation_id;
 if c.id is null or(tg_op='INSERT' and new.sender_id is distinct from auth.uid()) then
  raise exception 'Conversation not accessible.' using errcode='42501';end if;
 perform marketplace_private.assert_shop_message_send(c,new.sender_id,clock_timestamp());
 return new;
end;$$;
create trigger image_submission_shop_send_guard before insert or update on public.image_message_submissions
 for each row execute function marketplace_private.guard_shop_image_submission();

create or replace function marketplace_private.guard_message_origin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.origin is distinct from old.origin or old.origin='marketplace_auto_reply' then
   raise exception 'Marketplace message provenance is immutable.' using errcode='42501';end if;
  return new;
 end if;
 if new.origin='user' then return new;end if;
 if new.type<>'TEXT' then raise exception 'Server-created message required.' using errcode='42501';end if;
 if new.origin='marketplace_auto_reply' and exists(select 1 from marketplace_private.shop_suspension_message_events e
  where e.message_id=new.id and e.conversation_id=new.conversation_id) then return new;end if;
 if new.sender_id is distinct from auth.uid() or not exists(
  select 1 from marketplace_private.conversation_first_contacts f join public.conversations c on c.id=f.conversation_id
  where f.conversation_id=new.conversation_id and f.buyer_id=auth.uid() and c.buyer_id=auth.uid()
   and((new.origin='buyer_interest' and new.id=f.intro_message_id)
    or(new.origin='marketplace_auto_reply' and new.id=f.acknowledgement_message_id))) then
  raise exception 'Server-created first contact required.' using errcode='42501';end if;
 return new;
end;$$;

-- A private closure record is the only additional authority for the existing
-- audited `closed` terminal state. Existing Order/participant transitions remain.
create or replace function marketplace_private.protect_order_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Request history cannot be deleted.' using errcode='23514';end if;
 if (to_jsonb(new)-array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at','declined_at']) is distinct from
    (to_jsonb(old)-array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at','declined_at']) then
  raise exception 'Request identity and terms are immutable.' using errcode='23514';end if;
 if new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)) then raise exception 'Buyer cannot change.' using errcode='23514';end if;
 if new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then raise exception 'Seller cannot change.' using errcode='23514';end if;
 if old.protocol_version=2 and new.status is distinct from old.status then
  if old.status<>'active' or not(
   (new.status='accepted' and auth.uid()=old.recipient_user_id and exists(select 1 from public.orders o join marketplace_private.offer_accept_commands x on x.order_id=o.id where o.request_id=old.id and o.order_protocol_version=2 and o.accepted_at=new.accepted_at and x.actor_key=auth.uid()))
   or(new.status='closed' and exists(select 1 from marketplace_private.shop_suspension_offer_closures x where x.offer_id=old.id and x.closed_at=new.closed_at))
   or(new.status='closed' and exists(select 1 from public.orders o join marketplace_private.offer_accept_commands x on x.order_id=o.id where o.listing_id=old.listing_id and o.order_protocol_version=2 and o.holds_listing and o.lifecycle_status='open' and x.actor_key=auth.uid()))
   or(new.status='superseded' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='create' and x.previous_offer_id=old.id and x.offer_id=new.replacement_request_id))
   or(new.status='declined' and auth.uid()=old.recipient_user_id and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='deny' and x.offer_id=old.id))
   or(new.status='expired' and old.offer_terms->>'fulfillment'='on_campus' and (old.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp())
   or(new.status='withdrawn' and auth.uid()=old.sender_user_id and new.withdrawn_by=auth.uid() and clock_timestamp()<old.created_at+interval '5 minutes' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='withdraw' and x.offer_id=old.id))) then
   raise exception 'V2 mutation authority required.' using errcode='42501';end if;
  return new;
 end if;
 if new.status=old.status then
  if (to_jsonb(new)-array['buyer_id','seller_id','updated_at']) is distinct from(to_jsonb(old)-array['buyer_id','seller_id','updated_at']) then raise exception 'Lifecycle cannot change without a transition.' using errcode='23514';end if;
 elsif old.status<>'active' or new.status not in('superseded','cancelled','expired','accepted') then raise exception 'Invalid Request transition.' using errcode='23514';end if;
 if new.status='accepted' and old.status='active' and(auth.uid() is distinct from new.buyer_id or not exists(select 1 from public.orders o where o.request_id=new.id and o.accepted_at=new.accepted_at and o.buyer_id=new.buyer_id)) then raise exception 'Atomic Buyer Order required.' using errcode='23514';end if;
 return new;
end;$$;

create or replace function marketplace_private.emit_offer_event(r public.order_requests,previous_status text)
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare kind text;happened timestamptz;member record;details jsonb;actor uuid:=auth.uid();closure marketplace_private.shop_suspension_offer_closures;
begin
 if previous_status is null then kind:='offer_created';happened:=r.created_at;
 elsif r.status=previous_status then return r;
 elsif r.status='superseded' then kind:='offer_replaced';happened:=r.replaced_at;
 elsif r.status='withdrawn' then kind:='offer_withdrawn';happened:=r.withdrawn_at;
 elsif r.status='accepted' then kind:='offer_accepted';happened:=r.accepted_at;
 elsif r.status='declined' then kind:='offer_declined';happened:=r.declined_at;
 elsif r.status='expired' then kind:='offer_expired';happened:=r.expired_at;actor:=null;
 elsif r.status='closed' then kind:='offer_closed';happened:=r.closed_at;select * into closure from marketplace_private.shop_suspension_offer_closures where offer_id=r.id;
  if closure.offer_id is not null then actor:=null;end if;
 else raise exception 'Unsupported Offer event.' using errcode='42501';end if;
 if(actor is null and kind<>'offer_expired' and closure.offer_id is null)
  or(kind not in('offer_closed','offer_expired') and actor is distinct from r.buyer_id and actor is distinct from r.seller_id) then raise exception 'Offer actor required.' using errcode='42501';end if;
 details:=jsonb_build_object('protocolVersion',2,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id);
 if kind='offer_accepted' then details:=details||jsonb_build_object('orderId',(select id from public.orders where request_id=r.id));end if;
 if kind='offer_replaced' then details:=details||jsonb_build_object('replacementOfferId',r.replacement_request_id);end if;
 if kind='offer_created' then details:=details||jsonb_build_object('previousOfferId',(select coalesce(comparison_offer_id,previous_offer_id) from marketplace_private.offer_commands where offer_id=r.id and action='create'));end if;
 if kind='offer_withdrawn' then details:=details||jsonb_build_object('note',r.withdrawal_note);end if;
 if closure.offer_id is not null then details:=details||jsonb_build_object('reason',closure.reason,'suspensionCycleId',closure.suspension_cycle_id);end if;
 insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(r.conversation_id,r.id,actor,case when kind='offer_expired' or closure.offer_id is not null then 'system' when kind='offer_closed' then(select case when actor=o.buyer_id then 'buyer' else 'seller' end from public.orders o where o.listing_id=r.listing_id and o.holds_listing) when actor=r.buyer_id then 'buyer' else 'seller' end,kind,happened,r.id::text||':'||kind,details);
 begin
  for member in select members.id,members.role from public.conversations c cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
   join auth.users u on u.id=members.id where c.id=r.conversation_id and u.email_confirmed_at is not null and lower(u.email)~'^[^[:space:]@]+@uwo[.]ca$'
  loop perform realtime.send(jsonb_build_object('conversationId',r.conversation_id,'role',member.role,'scope','history'),'messages_changed','marketplace:messages:'||member.id::text,true);end loop;
 exception when others then raise log 'Offer invalidation skipped; SQLSTATE=%',sqlstate;end;
 return r;
end;$$;

create or replace function marketplace_private.offer_accept_eligibility(r public.order_requests) returns text
language plpgsql volatile security definer set search_path='' as $$
declare l public.listings;
begin
 if r.protocol_version<>2 or r.status<>'active' then return 'offer_not_active';end if;
 if r.offer_terms->>'fulfillment'='on_campus' and(r.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp() then return 'offer_expired';end if;
 select * into l from public.listings where id=r.listing_id;
 if l.id is null or l.published_at is null or l.status<>'available' then return 'listing_unavailable';end if;
 if r.offer_terms is null or r.listing_material_hash_at_offer is null or r.listing_material_hash_at_offer is distinct from marketplace_private.listing_media_material_hash(l.id) then return 'listing_changed';end if;
 if r.item_amount_cents>l.price_cents then return 'asking_price_lower';end if;
 return null;
end;$$;

-- Close unfinished Offers under the same Listing -> Conversation -> Offer lock
-- order used by Offer acceptance. Every candidate is rechecked after all three
-- locks are held, so a concurrently-created Order always wins as retained history.
create function marketplace_private.close_shop_suspension_offers(
 p_cycle uuid,p_owner uuid,p_at timestamptz,p_limit integer default 100
) returns integer language plpgsql security definer set search_path='' as $$
declare candidate record;l public.listings;c public.conversations;r public.order_requests;closed integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then
  raise exception 'Invalid Shop Offer closure limit.' using errcode='23514';end if;
 for candidate in
  select req.id,req.listing_id,req.conversation_id from public.order_requests req
   join public.conversations x on x.id=req.conversation_id
   where x.listing_channel_snapshot='shop' and x.seller_id=p_owner
    and req.protocol_version=2 and req.status='active'
   order by req.created_at,req.id limit p_limit
 loop
  select * into l from public.listings where id=candidate.listing_id for update skip locked;
  if l.id is null then continue;end if;
  select * into c from public.conversations where id=candidate.conversation_id for update skip locked;
  if c.id is null then continue;end if;
  select * into r from public.order_requests where id=candidate.id for update skip locked;
  if r.id is null or r.status<>'active' or r.protocol_version<>2
   or c.listing_channel_snapshot is distinct from 'shop' or c.seller_id is distinct from p_owner
   or r.listing_id is distinct from l.id or r.conversation_id is distinct from c.id
   or exists(select 1 from public.orders o where o.request_id=r.id) then continue;end if;
  insert into marketplace_private.shop_suspension_offer_closures(offer_id,suspension_cycle_id,closed_at)
   values(r.id,p_cycle,p_at) on conflict(offer_id) do nothing;
  if not found then continue;end if;
  update public.order_requests set status='closed',closed_at=p_at,updated_at=p_at where id=r.id and status='active';
  if found then closed:=closed+1;end if;
 end loop;
 return closed;
end;$$;

create function public.marketplace_shop_membership_lifecycle(p_action text,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cursor marketplace_private.shop_membership_lifecycle_cursor;owner uuid;last_owner uuid;scanned integer:=0;
 entitlement jsonb;cycle marketplace_private.shop_suspension_cycles;c public.conversations;sysmsg public.messages;
 t timestamptz:=clock_timestamp();closed integer:=0;closed_now integer:=0;messages integer:=0;reopened integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted lifecycle worker required.' using errcode='42501';end if;
 if p_action<>'process_due' or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid lifecycle work request.' using errcode='23514';end if;
 select * into cursor from marketplace_private.shop_membership_lifecycle_cursor where singleton for update skip locked;
 if cursor.singleton is null then return jsonb_build_object('busy',true,'scanned',0);end if;
 if cursor.lease_until is not null and cursor.lease_until>t then return jsonb_build_object('busy',true,'scanned',0);end if;
 update marketplace_private.shop_membership_lifecycle_cursor set lease=gen_random_uuid(),lease_until=t+interval '2 minutes' where singleton;
 for owner in select m.owner_id from marketplace_private.shop_memberships m join public.shops s on s.owner_id=m.owner_id
  where cursor.after_owner is null or m.owner_id>cursor.after_owner order by m.owner_id limit p_limit
 loop
  scanned:=scanned+1;last_owner:=owner;
  perform pg_advisory_xact_lock(hashtextextended('shop-lifecycle:'||owner::text,0));
  entitlement:=marketplace_private.shop_entitlements(owner,t);
  if entitlement->>'status'='suspended' then
   cycle:=marketplace_private.ensure_shop_suspension_cycle(owner,t);
   closed_now:=marketplace_private.close_shop_suspension_offers(cycle.id,owner,t,100);
   closed:=closed+closed_now;
   update marketplace_private.shop_suspension_cycles set offers_closed_at=coalesce(offers_closed_at,greatest(t,created_at)),
    offers_closed_count=offers_closed_count+closed_now,updated_at=greatest(t,created_at) where id=cycle.id;
   for c in select x.* from public.conversations x where x.listing_channel_snapshot='shop' and x.seller_id=owner
    and not marketplace_private.shop_conversation_has_order(x.id) order by x.id
   loop
    sysmsg:=marketplace_private.insert_shop_suspension_message(cycle.id,c.id,'suspended',t,null);
    if sysmsg.id is not null then messages:=messages+1;end if;
   end loop;
  elsif entitlement->>'status' in('trial','active','grace') then
   for cycle in select x.* from marketplace_private.shop_suspension_cycles x where x.owner_id=owner and x.state='open'
    and x.access_cycle_id is distinct from nullif(entitlement->>'accessCycleId','')::uuid order by x.created_at,x.id for update
   loop
    update marketplace_private.shop_suspension_cycles set state='reopened',reopened_at=t,updated_at=t where id=cycle.id returning * into cycle;
    reopened:=reopened+1;
    for c in select distinct x.* from public.conversations x join marketplace_private.shop_suspension_message_events e on e.conversation_id=x.id
     where e.suspension_cycle_id=cycle.id and e.kind in('suspended','reminder') order by x.id
    loop
     sysmsg:=marketplace_private.insert_shop_suspension_message(cycle.id,c.id,'reopened',t,null);
     if sysmsg.id is not null then messages:=messages+1;end if;
    end loop;
   end loop;
  end if;
 end loop;
 update marketplace_private.shop_membership_lifecycle_cursor set after_owner=case when scanned<p_limit then null else last_owner end,
  lease=null,lease_until=null,last_run_at=t where singleton;
 return jsonb_build_object('busy',false,'scanned',scanned,'offersClosed',closed,'messagesInserted',messages,'cyclesReopened',reopened,'serverTime',t);
end;$$;

revoke all on function marketplace_private.protect_shop_suspension_history(),
 marketplace_private.shop_conversation_has_order(uuid),
 marketplace_private.assert_shop_message_send(public.conversations,uuid,timestamptz),
 marketplace_private.ensure_shop_suspension_cycle(uuid,timestamptz),
 marketplace_private.insert_shop_suspension_message(uuid,uuid,text,timestamptz,uuid),
 marketplace_private.maybe_shop_suspension_reply(),marketplace_private.guard_shop_image_submission(),
 marketplace_private.close_shop_suspension_offers(uuid,uuid,timestamptz,integer)
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_shop_membership_lifecycle(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_membership_lifecycle(text,integer) to service_role;

commit;

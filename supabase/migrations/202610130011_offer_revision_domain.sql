-- Additive V2 dual-sender negotiation. Cross-protocol exclusion and V1 authority retained.
begin;
alter table public.listings add column preferred_fulfillment text not null default 'ON_CAMPUS' check(preferred_fulfillment in('ON_CAMPUS','DELIVERY'));
drop index public.order_requests_one_active;
drop index public.order_requests_conversation_one_active;
create unique index order_requests_one_active on public.order_requests(listing_origin_id,buyer_origin_id,seller_origin_id) where status='active' and protocol_version=1;
create unique index order_requests_conversation_one_active on public.order_requests(conversation_id) where status='active' and protocol_version=1;
create unique index offers_sender_one_active on public.order_requests(conversation_id,sender_user_id) where status='active' and protocol_version=2;
alter table public.order_requests add column declined_at timestamptz;
alter table public.order_requests add constraint offers_decline_metadata check((status='declined')=(declined_at is not null));
alter table marketplace_private.offer_commands add column comparison_offer_id uuid references public.order_requests(id);
alter table marketplace_private.offer_commands add column mutation_kind text not null default 'create' check(mutation_kind in('create','counter','revise'));
alter table marketplace_private.offer_commands add column comparison_terms jsonb;
alter table marketplace_private.offer_commands drop constraint offer_commands_action_check;
alter table marketplace_private.offer_commands add constraint offer_commands_action_check check(action in('create','withdraw','deny'));
do $$declare x text;begin
 select pg_get_expr(conbin,conrelid) into x from pg_constraint where conrelid='public.order_requests'::regclass and conname='order_requests_status_check';
 alter table public.order_requests drop constraint order_requests_status_check;
 execute 'alter table public.order_requests add constraint order_requests_status_check check(('||x||') or (protocol_version=2 and status=''declined''))';
 select pg_get_expr(conbin,conrelid) into x from pg_constraint where conrelid='public.order_requests'::regclass and conname='order_requests_lifecycle_metadata';
 alter table public.order_requests drop constraint order_requests_lifecycle_metadata;
 execute 'alter table public.order_requests add constraint order_requests_lifecycle_metadata check(('||x||') or (protocol_version=2 and status=''declined'' and declined_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=0))';
 select pg_get_expr(conbin,conrelid) into x from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_event_type_check';
 alter table public.transaction_events drop constraint transaction_events_event_type_check;
 execute 'alter table public.transaction_events add constraint transaction_events_event_type_check check(('||x||') or event_type in(''offer_declined'',''offer_expired''))';
end;$$;

create or replace function marketplace_private.mutate_offer_revision(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null,p_compare uuid default null,p_kind text default 'create')
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.conversations;l public.listings;r public.order_requests;prior public.order_requests;
 cmd marketplace_private.offer_commands;cid uuid;lid uuid;digest text;amount bigint;note text;new_id uuid:=gen_random_uuid();t timestamptz;basis public.order_requests;baseline jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null or p_action not in('create','withdraw','deny') or p_kind not in('create','counter','revise') then raise exception 'Offer action UUID required.' using errcode='23514';end if;
 if p_action='create' then
 p_terms:=marketplace_private.normalize_offer_terms(p_terms);
 perform marketplace_private.validate_offer_terms(p_terms);
 cid:=p_target;
 else
 select * into prior from public.order_requests where id=p_target;
 if not found or prior.protocol_version<>2 or (case when p_action='deny' then prior.recipient_user_id else prior.sender_user_id end) is distinct from actor then raise exception 'Offer participant action not permitted.' using errcode='42501';end if;
 cid:=prior.conversation_id;
 end if;
 select * into c from public.conversations where id=cid;
 if not found or c.buyer_id is null or c.seller_id is null or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Participant conversation required.' using errcode='42501';end if;
 digest:=encode(sha256(convert_to((case when p_compare is null and p_kind='create' then jsonb_build_array(p_target,p_terms,p_note) else jsonb_build_array(p_target,p_terms,p_note,p_compare,p_kind) end)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'offer_'||p_action||p_client_action_id::text,0));
 select * into cmd from marketplace_private.offer_commands where actor_key=actor and action=p_action and idempotency_key=p_client_action_id;
 if found then
 if cmd.input_digest<>digest then raise exception 'Action UUID reused for different input.' using errcode='23505';end if;
 select * into r from public.order_requests where id=cmd.offer_id;return r;
 end if;
 -- Same lock order as V1: command -> seller capability (only new Seller terms) -> Listing -> Conversation -> proposal.
 if p_action='create' and actor=c.seller_id then perform marketplace_private.require_seller_payout_ready(actor);end if;
 lid:=c.listing_id;
 select * into l from public.listings where id=lid for update;
 select * into c from public.conversations where id=cid for update;
 if not found or c.listing_id is distinct from lid or c.buyer_id is null or c.seller_id is null or l.id is null
 or l.seller_id is distinct from c.seller_id or c.listing_origin_id is distinct from l.id
 or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Conversation identity mismatch.' using errcode='42501';end if;
 perform marketplace_private.expire_conversation_offers(cid);
 t:=clock_timestamp();
 if p_action in('withdraw','deny') then
 select * into prior from public.order_requests where id=p_target for update;
 if prior.protocol_version<>2 or (case when p_action='deny' then prior.recipient_user_id else prior.sender_user_id end) is distinct from actor then raise exception 'Offer sender required.' using errcode='42501';end if;
 if prior.status<>'active' then raise exception 'Offer is no longer Active.' using errcode='23505';end if;
 if prior.offer_terms->>'fulfillment'='on_campus' and (prior.offer_terms->>'scheduled_at')::timestamptz<=t then raise exception 'Offer meetup time passed.' using errcode='23505';end if;
 if p_action='withdraw' and t>=prior.created_at+interval '5 minutes' then raise exception 'Withdrawal deadline passed.' using errcode='23505';end if;
 note:=btrim(coalesce(p_note,''));if char_length(note)>1000 then raise exception 'Withdrawal note too long.' using errcode='23514';end if;
 insert into marketplace_private.offer_commands(actor_key,action,idempotency_key,input_digest,offer_id) values(actor,p_action,p_client_action_id,digest,prior.id);
 if p_action='deny' then update public.order_requests set status='declined',declined_at=t,updated_at=t where id=prior.id returning * into r;
 else update public.order_requests set status='withdrawn',withdrawn_at=t,withdrawn_by=actor,withdrawal_note=note,updated_at=t where id=prior.id returning * into r;end if;
 else
 perform marketplace_private.validate_offer_terms(p_terms,t);
 -- No settlement/read side effects; Offers never mutate inventory or start timers.
 if l.published_at is null or l.status<>'available' then raise exception 'Published available listing required.' using errcode='23514';end if;
 amount:=(p_terms->>'item_amount_cents')::bigint;note:=btrim(coalesce(p_terms->>'note',''));
 if amount is null or amount<0 or amount>9007199254740991 or char_length(note)>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 if exists(select 1 from public.order_requests where conversation_id=cid and status='active' and protocol_version=1) then raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505';end if;
 select * into prior from public.order_requests where conversation_id=cid and status='active' and protocol_version=2 and sender_user_id=actor for update;
 if p_compare is not null then
 select * into basis from public.order_requests where id=p_compare and conversation_id=cid and protocol_version=2 for update;
 if basis.id is null or basis.status<>'active' or (p_kind='revise' and basis.sender_user_id<>actor) or (p_kind='counter' and basis.recipient_user_id<>actor) then raise exception 'Comparison Offer changed.' using errcode='23505';end if;
 elsif p_kind<>'create' then raise exception 'Comparison Offer required.' using errcode='23514';end if;
 if p_kind='revise' and basis.id is distinct from prior.id then raise exception 'Only current own Offer may be revised.' using errcode='23505';end if;
 baseline:=coalesce(basis.offer_terms, prior.offer_terms,jsonb_build_object('item_amount_cents',l.price_cents,'fulfillment',case when l.preferred_fulfillment='DELIVERY' then 'delivery' else 'on_campus' end));
 if found and prior.protocol_version<>2 then raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505';end if;
 insert into marketplace_private.offer_commands(actor_key,action,idempotency_key,input_digest,offer_id,previous_offer_id,comparison_offer_id,mutation_kind,comparison_terms) values(actor,p_action,p_client_action_id,digest,new_id,prior.id,basis.id,p_kind,baseline);
 if prior.id is not null then update public.order_requests set status='superseded',replaced_at=t,replacement_request_id=new_id,updated_at=t where id=prior.id;end if;
 -- Legacy required slots remain inert compatibility scaffolding. offer_terms alone defines V2 fulfillment.
 insert into public.order_requests(id,protocol_version,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,
 buyer_username_snapshot,seller_username_snapshot,listing_title_snapshot,listing_description_snapshot,listing_category_snapshot,listing_subcategory_snapshot,listing_condition_snapshot,
 listing_price_cents_snapshot,listing_currency_snapshot,listing_media_snapshot,item_amount_cents,fulfillment_type,shipping_cost_mode,shipping_amount_cents,seller_note,offer_terms,listing_updated_at_at_offer,created_at,updated_at)
 values(new_id,2,c.id,l.id,c.listing_origin_id,c.buyer_id,c.seller_id,c.buyer_id,c.seller_id,
 (select display_name from public.profiles where id=c.buyer_id),(select display_name from public.profiles where id=c.seller_id),l.title,l.description,l.category,l.subcategory,l.condition,
 l.price_cents,l.currency,'[]'::jsonb,amount,'shipping','included',0,note,p_terms,l.updated_at,t,t) returning * into r;
 end if;
 return r;
end;$$;

CREATE OR REPLACE FUNCTION marketplace_private.protect_order_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Request history cannot be deleted.' using errcode='23514'; end if;
  if (to_jsonb(new) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at','declined_at'])
    is distinct from (to_jsonb(old) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at','declined_at']) then
    raise exception 'Request identity and terms are immutable.' using errcode='23514';
  end if;
  if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)) then
    raise exception 'Buyer cannot change.' using errcode='23514'; end if;
  if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Seller cannot change.' using errcode='23514'; end if;
  if old.protocol_version=2 and new.status is distinct from old.status then
    if old.status<>'active' or not (
      (new.status='accepted' and auth.uid()=old.recipient_user_id and exists(select 1 from public.orders o
       join marketplace_private.offer_accept_commands x on x.order_id=o.id where o.request_id=old.id and o.order_protocol_version=2
       and o.accepted_at=new.accepted_at and x.actor_key=auth.uid()))
      or(new.status='closed' and exists(select 1 from public.orders o join marketplace_private.offer_accept_commands x on x.order_id=o.id
       where o.listing_id=old.listing_id and o.order_protocol_version=2 and o.holds_listing and o.lifecycle_status='open' and x.actor_key=auth.uid()))
      or(new.status='superseded' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='create' and x.previous_offer_id=old.id and x.offer_id=new.replacement_request_id))
      or(new.status='declined' and auth.uid()=old.recipient_user_id and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='deny' and x.offer_id=old.id))
      or(new.status='expired' and old.offer_terms->>'fulfillment'='on_campus' and (old.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp())
      or(new.status='withdrawn' and auth.uid()=old.sender_user_id and new.withdrawn_by=auth.uid() and clock_timestamp()<old.created_at+interval '5 minutes' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='withdraw' and x.offer_id=old.id))) then
      raise exception 'V2 mutation authority required.' using errcode='42501'; end if;
    return new;
  end if;
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

create or replace function marketplace_private.emit_offer_event(r public.order_requests, previous_status text) returns public.order_requests
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz; member record; details jsonb; actor uuid:=auth.uid();
begin
 if previous_status is null then kind:='offer_created';happened:=r.created_at;
 elsif r.status=previous_status then return r;
 elsif r.status='superseded' then kind:='offer_replaced';happened:=r.replaced_at;
 elsif r.status='withdrawn' then kind:='offer_withdrawn';happened:=r.withdrawn_at;
 elsif r.status='accepted' then kind:='offer_accepted';happened:=r.accepted_at;
 elsif r.status='declined' then kind:='offer_declined';happened:=r.declined_at;
 elsif r.status='expired' then kind:='offer_expired';happened:=r.expired_at;actor:=null;
 elsif r.status='closed' then kind:='offer_closed';happened:=r.closed_at;
 else raise exception 'Unsupported Offer event.' using errcode='42501';end if;
 if (actor is null and kind<>'offer_expired') or(kind not in('offer_closed','offer_expired') and actor is distinct from r.buyer_id and actor is distinct from r.seller_id) then raise exception 'Offer actor required.' using errcode='42501';end if;
 details:=jsonb_build_object('protocolVersion',2,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id);
 if kind='offer_accepted' then details:=details||jsonb_build_object('orderId',(select id from public.orders where request_id=r.id));end if;
 if kind='offer_replaced' then details:=details||jsonb_build_object('replacementOfferId',r.replacement_request_id);end if;
 if kind='offer_created' then details:=details||jsonb_build_object('previousOfferId',(select coalesce(comparison_offer_id,previous_offer_id) from marketplace_private.offer_commands where offer_id=r.id and action='create'));end if;
 if kind='offer_withdrawn' then details:=details||jsonb_build_object('note',r.withdrawal_note);end if;
 insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(r.conversation_id,r.id,actor,case when kind='offer_expired' then 'system' when kind='offer_closed' then (select case when actor=o.buyer_id then 'buyer' else 'seller' end from public.orders o where o.listing_id=r.listing_id and o.holds_listing) when actor=r.buyer_id then 'buyer' else 'seller' end,kind,happened,r.id::text||':'||kind,details);
 begin
 for member in select members.id,members.role from public.conversations c cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
 join auth.users u on u.id=members.id where c.id=r.conversation_id and u.email_confirmed_at is not null and lower(u.email)~'^[^[:space:]@]+@uwo[.]ca$'
 loop perform realtime.send(jsonb_build_object('conversationId',r.conversation_id,'role',member.role,'scope','history'),'messages_changed','marketplace:messages:'||member.id::text,true);end loop;
 exception when others then raise log 'Offer invalidation skipped; SQLSTATE=%',sqlstate;end;
 return r;
end;$$;

create or replace function marketplace_private.offer_accept_eligibility(r public.order_requests) returns text
language plpgsql stable security definer set search_path='' as $$
declare l public.listings;begin
 if r.protocol_version<>2 or r.status<>'active' then return 'offer_not_active';end if;
 if r.offer_terms->>'fulfillment'='on_campus' and (r.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp() then return 'offer_expired';end if;
 select * into l from public.listings where id=r.listing_id;
 if l.id is null or l.published_at is null or l.status<>'available' then return 'listing_unavailable';end if;
 if r.offer_terms is null or r.listing_material_hash_at_offer is null
 or r.listing_material_hash_at_offer is distinct from marketplace_private.listing_media_material_hash(l.id)
 then return 'listing_changed';end if;
 if r.item_amount_cents>l.price_cents then return 'asking_price_lower';end if;
 return null;
end;$$;

create or replace function marketplace_private.project_transaction_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;o public.orders;eid uuid;dest jsonb;kind text;target uuid;priority text:='INFORMATIONAL';
begin
select * into r from public.order_requests where id=new.request_id;
if r.protocol_version is distinct from 2 then return new;end if;
if new.order_id is not null then select * into o from public.orders where id=new.order_id;end if;
if o.id is null and new.event_type='offer_accepted' then select * into o from public.orders where request_id=r.id;end if;
dest:=case when o.id is not null then jsonb_build_object('section','orders','orderId',o.id)
else jsonb_build_object('section','messages','conversationId',new.conversation_id,'offerId',r.id) end;kind:=new.event_type;
if kind='offer_created' then
kind:=case when new.metadata->>'previousOfferId' is not null and exists(select 1 from public.order_requests prev
where prev.id=(new.metadata->>'previousOfferId')::uuid and prev.sender_user_id<>r.sender_user_id) then 'incoming_counter_offer' else 'incoming_offer' end;
target:=r.recipient_user_id;priority:='ACTION_REQUIRED';
elsif kind='offer_declined' then target:=r.sender_user_id;
elsif kind='offer_withdrawn' then target:=r.recipient_user_id;
elsif kind='offer_accepted' then target:=r.sender_user_id;
elsif kind in('meetup_proposed','meetup_confirmed','meetup_declined') then
target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
if kind='meetup_proposed' then priority:='ACTION_REQUIRED';end if;
elsif kind='order_cancelled' and new.actor_id is not null then target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
elsif kind='payment_paid' then target:=r.seller_id;
elsif kind='handoff_ready' then target:=null;priority:='ACTION_REQUIRED';
elsif kind='courier_delivered' then target:=null;
elsif kind='protection_started' then
-- One possession event already carries the useful Buyer/Seller context. Add only
-- the recipient not covered by that event, rather than duplicate both feeds.
if exists(select 1 from public.transaction_events where order_id=o.id and event_type='courier_delivered') then return new;end if;
if exists(select 1 from public.transaction_events where order_id=o.id and event_type='handoff_confirmed') then target:=r.seller_id;
elsif exists(select 1 from public.transaction_events where order_id=o.id and event_type='buyer_confirm_received') then target:=r.buyer_id;
else target:=null;end if;
elsif kind in('offer_closed','order_no_show_expired','reservation_expired','order_cancelled','order_completed') then target:=null;
elsif kind in('handoff_confirmed','courier_shipped') then target:=r.buyer_id;
elsif kind in('buyer_confirm_received','protection_case_opened') then target:=r.seller_id;
else return new;end if;
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('transaction:'||new.id,kind,new.created_at,dest) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='transaction:'||new.id;
if target is not null then
if target is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,target,priority);end if;
else
if r.buyer_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.buyer_id,case when kind='courier_delivered' then 'ACTION_REQUIRED' else priority end);end if;
if r.seller_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.seller_id,priority);end if;
end if;
if new.event_type='offer_accepted' and o.terms_snapshot->'terms'->>'fulfillment'='delivery' and r.sender_user_id=r.buyer_id then
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('checkout-available:'||o.id,'delivery_checkout_available',new.created_at,dest) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='checkout-available:'||o.id;
perform marketplace_private.deliver_notification(eid,r.buyer_id,'ACTION_REQUIRED');
end if;return new;
end;$$;
create or replace function marketplace_private.mutate_offer(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null) returns public.order_requests
language sql security definer set search_path='' as $$select marketplace_private.mutate_offer_revision(p_action,p_target,p_terms,p_client_action_id,p_note);$$;
create function public.marketplace_submit_offer(p_conversation_id uuid,p_terms jsonb,p_client_action_id uuid,p_comparison_offer_id uuid default null,p_kind text default 'create') returns public.order_requests
language sql security definer set search_path='' as $$select marketplace_private.mutate_offer_revision('create',p_conversation_id,p_terms,p_client_action_id,null,p_comparison_offer_id,p_kind);$$;
create function public.marketplace_deny_offer(p_offer_id uuid,p_client_action_id uuid) returns public.order_requests
language sql security definer set search_path='' as $$select marketplace_private.mutate_offer_revision('deny',p_offer_id,null,p_client_action_id);$$;
revoke all on function marketplace_private.mutate_offer_revision(text,uuid,jsonb,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_submit_offer(uuid,jsonb,uuid,uuid,text), public.marketplace_deny_offer(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_submit_offer(uuid,jsonb,uuid,uuid,text), public.marketplace_deny_offer(uuid,uuid) to authenticated;

create function marketplace_private.offer_changed_fields(current_terms jsonb,baseline jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(label order by position),'[]'::jsonb) from (values
 (1,'Price',current_terms->'item_amount_cents' is distinct from baseline->'item_amount_cents'),
 (2,'Fulfillment',current_terms->'fulfillment' is distinct from baseline->'fulfillment'),
 (3,'Meetup location',current_terms->'meetup_location' is distinct from baseline->'meetup_location'),
 (4,'Meetup time',current_terms->'scheduled_at' is distinct from baseline->'scheduled_at'),
 (5,'Delivery method',current_terms->'delivery_method' is distinct from baseline->'delivery_method'),
 (6,'Delivery fee',current_terms->'delivery_fee_cents' is distinct from baseline->'delivery_fee_cents'),
 (7,'Delivery area',current_terms->'delivery_area' is distinct from baseline->'delivery_area'),
 (8,'Note',coalesce(current_terms->>'note','') is distinct from coalesce(baseline->>'note',''))
 ) d(position,label,changed) where changed;
$$;
create function marketplace_private.expire_conversation_offers(p_conversation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare lid uuid;t timestamptz;begin
 select listing_id into lid from public.conversations where id=p_conversation_id;
 perform 1 from public.listings where id=lid for update;
 perform 1 from public.order_requests where conversation_id=p_conversation_id and protocol_version=2 and status='active' order by id for update;
 t:=clock_timestamp();
 update public.order_requests set status='expired',expired_at=t,updated_at=t
 where conversation_id=p_conversation_id and protocol_version=2 and status='active'
 and offer_terms->>'fulfillment'='on_campus' and (offer_terms->>'scheduled_at')::timestamptz<=t;
end;$$;
create or replace function public.marketplace_offer_history(p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.conversations;actor uuid:=auth.uid();t timestamptz;begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select * into c from public.conversations where id=p_conversation_id;
 if c.id is null or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Conversation not accessible.' using errcode='42501';end if;
 perform marketplace_private.expire_conversation_offers(c.id);t:=clock_timestamp();
 return jsonb_build_object('server_time',t,'offers',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'linked_order_id',(select id from public.orders where request_id=r.id and order_protocol_version=2),
 'accept_block_reason',marketplace_private.offer_accept_eligibility(r),
 'can_withdraw',r.status='active' and r.sender_user_id=actor and t<r.created_at+interval '5 minutes',
 'mutation_kind',coalesce(cmd.mutation_kind,'create'),
 'changed_fields',marketplace_private.offer_changed_fields(r.offer_terms,coalesce(cmd.comparison_terms,
 jsonb_build_object('item_amount_cents',r.listing_price_cents_snapshot,'fulfillment','on_campus')))) order by r.created_at,r.id)
 from public.order_requests r left join marketplace_private.offer_commands cmd on cmd.offer_id=r.id and cmd.action='create'
 where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb),
 'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'offer_id',o.request_id,
 'created_at',o.accepted_at,'status',o.lifecycle_status,'listing_title',o.listing_snapshot->>'title',
 'terms',o.terms_snapshot->'terms','buyer_id',o.buyer_origin_id,'seller_id',o.seller_origin_id)
 order by o.accepted_at,o.id) from public.orders o where o.conversation_id=c.id and o.order_protocol_version=2),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e
 join public.order_requests r on r.id=e.request_id where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb));
end;$$;
revoke all on function marketplace_private.offer_changed_fields(jsonb,jsonb),marketplace_private.expire_conversation_offers(uuid) from public,anon,authenticated,service_role;


create function public.marketplace_listing_offer_context(p_listing_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();l public.listings;cid uuid;active_id uuid;oid uuid;begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into l from public.listings where id=p_listing_id and published_at is not null;
 if l.id is null or l.seller_id=actor then raise exception 'Another Seller listing required.' using errcode='42501';end if;
 select id into cid from public.conversations where listing_origin_id=l.id and buyer_id=actor and seller_id=l.seller_id;
 select id into oid from public.orders where listing_origin_id=l.id and buyer_origin_id=actor and lifecycle_status='open' and holds_listing order by created_at desc limit 1;
 select id into active_id from public.order_requests where conversation_id=cid and protocol_version=2 and sender_user_id=actor and status='active'
 and not(offer_terms->>'fulfillment'='on_campus' and (offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp());
 return jsonb_build_object('activeOfferId',active_id,'orderId',oid,'hasHistory',exists(select 1 from public.order_requests where conversation_id=cid),'available',l.status='available');
end;$$;
revoke all on function public.marketplace_listing_offer_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_listing_offer_context(uuid) to authenticated;

commit;

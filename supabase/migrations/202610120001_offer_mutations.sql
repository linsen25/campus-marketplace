-- V2-A2: staging-only bidirectional mutations. No Accept, Orders or timers.
begin;
alter table public.order_requests add column withdrawn_at timestamptz;
alter table public.order_requests add column withdrawn_by uuid;
alter table public.order_requests add column withdrawal_note text check(char_length(withdrawal_note)<=1000);
alter table public.order_requests add column closed_at timestamptz;
alter table public.order_requests drop constraint order_requests_status_check;
alter table public.order_requests drop constraint order_requests_check1;
alter table public.order_requests add constraint order_requests_status_check check(
 (protocol_version=1 and status in('active','superseded','accepted','expired','cancelled'))
 or(protocol_version=2 and status in('active','superseded','accepted','withdrawn','expired','closed')));
alter table public.order_requests add constraint order_requests_lifecycle_metadata check(
 (status='active' and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=0)
 or(status='superseded' and replaced_at is not null and replacement_request_id is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1)
 or(status='accepted' and accepted_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1)
 or(status='expired' and expired_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1)
 or(status='cancelled' and cancelled_at is not null and cancelled_by=seller_origin_id and cancel_reason_code is not null and cancel_reason_label_snapshot is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1)
 or(status='withdrawn' and protocol_version=2 and withdrawn_at is not null and withdrawn_by=sender_user_id and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1)
 or(status='closed' and protocol_version=2 and closed_at is not null and num_nonnulls(replaced_at,accepted_at,expired_at,cancelled_at,withdrawn_at,closed_at)=1));
alter table public.order_requests add constraint order_requests_withdrawal_protocol check(
 (protocol_version=1 and num_nonnulls(withdrawn_at,withdrawn_by,withdrawal_note,closed_at)=0)
 or(protocol_version=2 and ((status='withdrawn' and withdrawn_by is not null) or(status<>'withdrawn' and num_nonnulls(withdrawn_by,withdrawal_note)=0))));
create table marketplace_private.offer_commands(
 id uuid primary key default gen_random_uuid(), actor_key uuid not null,
 action text not null check(action in('create','withdraw')), idempotency_key uuid not null,
 input_digest text not null, offer_id uuid not null references public.order_requests(id) deferrable initially deferred,
 previous_offer_id uuid references public.order_requests(id), created_at timestamptz not null default clock_timestamp(),
 unique(actor_key,action,idempotency_key));
create index offer_commands_offer on marketplace_private.offer_commands(offer_id);
create index offer_commands_previous on marketplace_private.offer_commands(previous_offer_id);
alter table marketplace_private.offer_commands enable row level security;
revoke all on marketplace_private.offer_commands from public,anon,authenticated,service_role;
alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in(
 'request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired','payment_paid','order_cancelled',
 'offer_created','offer_replaced','offer_withdrawn'));
create function marketplace_private.emit_offer_event(r public.order_requests, previous_status text) returns public.order_requests
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz; member record; details jsonb; actor uuid:=auth.uid();
begin
 if previous_status is null then kind:='offer_created';happened:=r.created_at;
 elsif r.status=previous_status then return r;
 elsif r.status='superseded' then kind:='offer_replaced';happened:=r.replaced_at;
 elsif r.status='withdrawn' then kind:='offer_withdrawn';happened:=r.withdrawn_at;
 else raise exception 'Unsupported A2 Offer event.' using errcode='42501';end if;
 if actor is null or(actor is distinct from r.buyer_id and actor is distinct from r.seller_id) then raise exception 'Offer actor required.' using errcode='42501';end if;
 details:=jsonb_build_object('protocolVersion',2,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id);
 if kind='offer_replaced' then details:=details||jsonb_build_object('replacementOfferId',r.replacement_request_id);end if;
 if kind='offer_created' then details:=details||jsonb_build_object('previousOfferId',(select previous_offer_id from marketplace_private.offer_commands where offer_id=r.id and action='create'));end if;
 if kind='offer_withdrawn' then details:=details||jsonb_build_object('note',r.withdrawal_note);end if;
 insert into public.transaction_events(conversation_id,request_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(r.conversation_id,r.id,actor,case when actor=r.buyer_id then 'buyer' else 'seller' end,kind,happened,r.id::text||':'||kind,details);
 begin
 for member in select members.id,members.role from public.conversations c cross join lateral(values(c.buyer_id,'buying'),(c.seller_id,'selling')) members(id,role)
 join auth.users u on u.id=members.id where c.id=r.conversation_id and u.email_confirmed_at is not null and lower(u.email)~'^[^[:space:]@]+@uwo[.]ca$'
 loop perform realtime.send(jsonb_build_object('conversationId',r.conversation_id,'role',member.role,'scope','history'),'messages_changed','marketplace:messages:'||member.id::text,true);end loop;
 exception when others then raise log 'Offer invalidation skipped; SQLSTATE=%',sqlstate;end;
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
  if (to_jsonb(new) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at'])
    is distinct from (to_jsonb(old) - array['status','updated_at','replaced_at','replacement_request_id','accepted_at','expired_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note','buyer_id','seller_id','withdrawn_at','withdrawn_by','withdrawal_note','closed_at']) then
    raise exception 'Request identity and terms are immutable.' using errcode='23514';
  end if;
  if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)) then
    raise exception 'Buyer cannot change.' using errcode='23514'; end if;
  if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Seller cannot change.' using errcode='23514'; end if;
  if old.protocol_version=2 and new.status is distinct from old.status then
    if old.status<>'active' or not (
      (new.status='superseded' and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='create' and x.previous_offer_id=old.id and x.offer_id=new.replacement_request_id))
      or(new.status='withdrawn' and auth.uid()=old.sender_user_id and new.withdrawn_by=auth.uid() and exists(select 1 from marketplace_private.offer_commands x where x.actor_key=auth.uid() and x.action='withdraw' and x.offer_id=old.id))) then
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
CREATE OR REPLACE FUNCTION marketplace_private.prepare_request_protocol_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 -- No client writes. Private V2 command authorizes creation; Auth resolves identity.
 if actor is null or not coalesce(marketplace_private.is_western_user(),false)
 or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id)
 or(new.sender_user_id is not null and new.sender_user_id is distinct from actor) then
 raise exception 'Authenticated proposal sender required.' using errcode='42501'; end if;
 if new.status<>'active' or not exists(select 1 from marketplace_private.offer_commands x where x.actor_key=actor and x.action='create' and x.offer_id=new.id) then
 raise exception 'V2 creation authority required.' using errcode='42501'; end if;
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
end;$function$;
CREATE OR REPLACE FUNCTION marketplace_private.order_request_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text; happened timestamptz; recipient record; details jsonb := '{}';
begin
  if new.protocol_version=2 then return marketplace_private.emit_offer_event(new,case when tg_op='INSERT' then null else old.status end); end if;
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
create function marketplace_private.mutate_offer(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null)
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.conversations;l public.listings;r public.order_requests;prior public.order_requests;
 cmd marketplace_private.offer_commands;cid uuid;lid uuid;digest text;amount bigint;note text;new_id uuid:=gen_random_uuid();t timestamptz;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null or p_action not in('create','withdraw') then raise exception 'Offer action UUID required.' using errcode='23514';end if;
 if p_action='create' then
 if p_terms is null or jsonb_typeof(p_terms)<>'object' or (p_terms-array['item_amount_cents','note'])<>'{}'::jsonb then raise exception 'Only Offer amount/note are permitted.' using errcode='23514';end if;
 cid:=p_target;
 else
 select * into prior from public.order_requests where id=p_target;
 if not found or prior.protocol_version<>2 or prior.sender_user_id is distinct from actor then raise exception 'Offer sender required.' using errcode='42501';end if;
 cid:=prior.conversation_id;
 end if;
 select * into c from public.conversations where id=cid;
 if not found or c.buyer_id is null or c.seller_id is null or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Participant conversation required.' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_target,p_terms,p_note)::text,'UTF8')),'hex');
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
 t:=clock_timestamp();
 if p_action='withdraw' then
 select * into prior from public.order_requests where id=p_target for update;
 if prior.protocol_version<>2 or prior.sender_user_id is distinct from actor then raise exception 'Offer sender required.' using errcode='42501';end if;
 if prior.status<>'active' then raise exception 'Offer is no longer Active.' using errcode='23505';end if;
 note:=btrim(coalesce(p_note,''));if char_length(note)>1000 then raise exception 'Withdrawal note too long.' using errcode='23514';end if;
 insert into marketplace_private.offer_commands(actor_key,action,idempotency_key,input_digest,offer_id) values(actor,p_action,p_client_action_id,digest,prior.id);
 update public.order_requests set status='withdrawn',withdrawn_at=t,withdrawn_by=actor,withdrawal_note=note,updated_at=t where id=prior.id returning * into r;
 else
 -- No settlement/read side effects: A2 never mutates Listings/Orders or starts timers.
 if l.published_at is null or l.status<>'available' then raise exception 'Published available listing required.' using errcode='23514';end if;
 amount:=(p_terms->>'item_amount_cents')::bigint;note:=btrim(coalesce(p_terms->>'note',''));
 if amount is null or amount<0 or amount>9007199254740991 or char_length(note)>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 select * into prior from public.order_requests where conversation_id=cid and status='active' for update;
 if found and prior.protocol_version<>2 then raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505';end if;
 insert into marketplace_private.offer_commands(actor_key,action,idempotency_key,input_digest,offer_id,previous_offer_id) values(actor,p_action,p_client_action_id,digest,new_id,prior.id);
 if prior.id is not null then update public.order_requests set status='superseded',replaced_at=t,replacement_request_id=new_id,updated_at=t where id=prior.id;end if;
 -- Existing storage columns are compatibility scaffolding only, not A2 fulfillment/Order terms.
 insert into public.order_requests(id,protocol_version,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,
 buyer_username_snapshot,seller_username_snapshot,listing_title_snapshot,listing_description_snapshot,listing_category_snapshot,listing_subcategory_snapshot,listing_condition_snapshot,
 listing_price_cents_snapshot,listing_currency_snapshot,listing_media_snapshot,item_amount_cents,fulfillment_type,shipping_cost_mode,shipping_amount_cents,seller_note,created_at,updated_at)
 values(new_id,2,c.id,l.id,c.listing_origin_id,c.buyer_id,c.seller_id,c.buyer_id,c.seller_id,
 (select display_name from public.profiles where id=c.buyer_id),(select display_name from public.profiles where id=c.seller_id),l.title,l.description,l.category,l.subcategory,l.condition,
 l.price_cents,l.currency,'[]'::jsonb,amount,'shipping','included',0,note,t,t) returning * into r;
 end if;
 return r;
end;$$;
create function public.marketplace_create_offer(p_conversation_id uuid,p_terms jsonb,p_client_action_id uuid) returns public.order_requests
language sql security definer set search_path='' as $$select marketplace_private.mutate_offer('create',p_conversation_id,p_terms,p_client_action_id);$$;
create function public.marketplace_withdraw_offer(p_offer_id uuid,p_client_action_id uuid,p_note text default null) returns public.order_requests
language sql security definer set search_path='' as $$select marketplace_private.mutate_offer('withdraw',p_offer_id,null,p_client_action_id,p_note);$$;
create function public.marketplace_offer_history(p_conversation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations;actor uuid:=auth.uid();begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select * into c from public.conversations where id=p_conversation_id;
 if not found or(actor is distinct from c.buyer_id and actor is distinct from c.seller_id) then raise exception 'Conversation not accessible.' using errcode='42501';end if;
 return jsonb_build_object('offers',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.order_requests r where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.transaction_events e join public.order_requests r on r.id=e.request_id where r.conversation_id=c.id and r.protocol_version=2),'[]'::jsonb));
end;$$;
revoke all on function marketplace_private.emit_offer_event(public.order_requests,text),marketplace_private.mutate_offer(text,uuid,jsonb,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_create_offer(uuid,jsonb,uuid),public.marketplace_withdraw_offer(uuid,uuid,text),public.marketplace_offer_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_create_offer(uuid,jsonb,uuid),public.marketplace_withdraw_offer(uuid,uuid,text),public.marketplace_offer_history(uuid) to authenticated;
commit;

-- Additive qualification follow-up: due expiry, explicit comparison, retry tombstones.
begin;
create or replace function marketplace_private.run_transaction_due_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare row record;o public.orders;r marketplace_private.notification_reminders;eligible boolean;eid uuid;t timestamptz;processed integer:=0;
begin
-- Prevent overlapping scheduler scans, while domain locks serialize caller races.
if not pg_try_advisory_xact_lock(hashtextextended('marketplace_v2_due_work',0)) then return jsonb_build_object('overlapSkipped',true);end if;
for row in select c.id from public.conversations c where exists(select 1 from public.order_requests r where r.conversation_id=c.id and r.protocol_version=2 and r.status='active' and r.offer_terms->>'fulfillment'='on_campus' and (r.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp()) order by c.listing_id,c.id loop
 perform marketplace_private.expire_conversation_offers(row.id);
end loop;
for row in select distinct listing_id from public.orders where order_protocol_version=2 and lifecycle_status='open' and holds_listing order by listing_id loop
perform marketplace_private.settle_delivery_checkout(row.listing_id);
perform marketplace_private.settle_order_meetup(row.listing_id);
perform marketplace_private.settle_order_protection(row.listing_id);
processed:=processed+1;
end loop;
for r in select * from marketplace_private.notification_reminders where delivered_at is null and suppressed_at is null and due_at<=clock_timestamp() order by due_at,identity loop
select * into o from public.orders where id=r.order_id;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=r.order_id for update;
select * into r from marketplace_private.notification_reminders where identity=r.identity for update;
if r.delivered_at is not null or r.suppressed_at is not null then continue;end if;
t:=clock_timestamp();eligible:=o.lifecycle_status='open' and o.holds_listing;
if r.confirmed_revision_id is not null then
eligible:=eligible and o.payment_status in('pending','failed') and exists(select 1 from public.order_meetup_revisions mr
where mr.id=r.confirmed_revision_id and mr.status='confirmed' and mr.scheduled_at>t
and mr.id=(select id from public.order_meetup_revisions where order_id=o.id and status='confirmed' order by revision desc limit 1));
elsif r.kind='delivery_claim_1h' then
eligible:=eligible and o.payment_status in('pending','failed') and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=o.id and c.checkout_started_at is null and c.checkout_claim_deadline_at>t);
else
eligible:=eligible and o.payment_status in('pending','failed','processing') and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=o.id and c.payment_deadline_at>t);
end if;
if eligible then
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('reminder:'||r.identity,r.kind,t,jsonb_build_object('section','orders','orderId',o.id)) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='reminder:'||r.identity;
perform marketplace_private.deliver_notification(eid,r.recipient,'ACTION_REQUIRED');
update marketplace_private.notification_reminders set delivered_at=t where identity=r.identity;
else update marketplace_private.notification_reminders set suppressed_at=t where identity=r.identity;end if;
end loop;return jsonb_build_object('ordersChecked',processed,'serverTime',clock_timestamp());
end;$$;

create or replace function marketplace_private.mutate_offer_revision(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null,p_compare uuid default null,p_kind text default 'create')
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.conversations;l public.listings;r public.order_requests;prior public.order_requests;
 cmd marketplace_private.offer_commands;cid uuid;lid uuid;digest text;amount bigint;note text;new_id uuid:=gen_random_uuid();t timestamptz;basis public.order_requests;baseline jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_kind is null or (p_kind='create' and p_compare is not null) then raise exception 'Explicit Counter or Revise comparison required.' using errcode='23514';end if;
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

create or replace function public.marketplace_send_text(p_conversation_id uuid, p_client_message_id uuid, p_content text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare target public.conversations; result public.messages; actor uuid := auth.uid(); clean text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = p_conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not found or not accessible.' using errcode = '42501';
  end if;
  clean := marketplace_private.trim_message_text(p_content);
  if p_client_message_id is null or clean is null or char_length(clean) not between 1 and 2000 then
    raise exception 'A client message UUID and 1-2000 characters of nonblank TEXT are required.' using errcode = '23514';
  end if;
  select * into result from public.messages m where m.conversation_id = target.id
    and m.sender_id = actor and m.client_message_id = p_client_message_id;
  if found then
    if result.withdrawn_at is not null then
      if not exists(select 1 from marketplace_private.message_withdrawals w where w.message_id=result.id and w.original_content=clean) then
        raise exception 'This client message UUID was used for different content.' using errcode='23505';end if;
      return result;
    end if;
    if result.type <> 'TEXT' or result.content is distinct from clean then
      raise exception 'This client message UUID was used for different content.' using errcode = '23505';
    end if;
    -- Retry neither consumes a sequence nor re-acknowledges newer incoming messages.
    return result;
  end if;
  -- Triggers allocate sequence/time and update activity/read state in this transaction.
  -- No listing join: sold/deleted listings do not block existing conversation sends.
  insert into public.messages (conversation_id,sender_id,client_message_id,type,content)
    values (target.id,actor,p_client_message_id,'TEXT',clean) returning * into result;
  return result;
end; $$;

create function marketplace_private.protect_listing_fulfillment() returns trigger
language plpgsql set search_path='' as $$
begin if old.preferred_fulfillment is distinct from new.preferred_fulfillment and old.status<>'available' then raise exception 'Only available Listing preferences may change.' using errcode='23514';end if;return new;end;$$;
create trigger listings_fulfillment_guard before update of preferred_fulfillment on public.listings for each row execute function marketplace_private.protect_listing_fulfillment();
revoke all on function marketplace_private.protect_listing_fulfillment() from public,anon,authenticated,service_role;

commit;

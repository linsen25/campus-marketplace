-- V2-B final negotiation terms ONLY. No Accept, Order, inventory mutation or timer.
begin;
alter table public.order_requests add column offer_terms jsonb;
alter table public.order_requests add column listing_updated_at_at_offer timestamptz;
-- Typed, allowlisted, finite money and Toronto schedule validation. Not arbitrary JSON.
create function marketplace_private.validate_offer_terms(v jsonb, at_time timestamptz default null) returns boolean
language plpgsql immutable set search_path='' as $$
declare amount numeric; fee numeric; scheduled timestamptz; local_time timestamp; keys text[];
begin
 if v is null or jsonb_typeof(v)<>'object' then raise exception 'Offer terms required.' using errcode='23514';end if;
 keys:=array['item_amount_cents','fulfillment','note'];
 if v->>'fulfillment'='on_campus' then keys:=keys||array['meetup_location','scheduled_at'];
 elsif v->>'fulfillment'='delivery' then keys:=keys||array['delivery_fee_cents','delivery_method'];
 else raise exception 'Choose On Campus or Delivery.' using errcode='23514';end if;
 if (v-keys)<>'{}'::jsonb or jsonb_typeof(v->'item_amount_cents') is distinct from 'number'
 or (v ? 'note' and jsonb_typeof(v->'note') is distinct from 'string') then raise exception 'Unexpected Offer terms.' using errcode='23514';end if;
 amount:=(v->>'item_amount_cents')::numeric;
 if amount<>trunc(amount) or amount<1 or amount>9007199254740991 or char_length(coalesce(v->>'note',''))>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 if v->>'fulfillment'='on_campus' then
 if jsonb_typeof(v->'meetup_location') is distinct from 'string' or char_length(btrim(v->>'meetup_location')) not between 1 and 120
 or jsonb_typeof(v->'scheduled_at') is distinct from 'string' or (v->>'scheduled_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Meetup location and zoned time required.' using errcode='23514';end if;
 scheduled:=(v->>'scheduled_at')::timestamptz;local_time:=scheduled at time zone 'America/Toronto';
 if not isfinite(scheduled) or extract(minute from local_time)::integer%15<>0 or extract(second from local_time)<>0
 or(at_time is not null and (scheduled<at_time+interval '60 minutes' or scheduled>((at_time at time zone 'America/Toronto')+interval '30 days') at time zone 'America/Toronto')) then raise exception 'Choose a 15-minute time 60 minutes to 30 days ahead.' using errcode='23514';end if;
 else
 if jsonb_typeof(v->'delivery_fee_cents') is distinct from 'number' or v->>'delivery_method' is null or v->>'delivery_method' not in('seller_delivery','courier') then raise exception 'Delivery fee and method required.' using errcode='23514';end if;
 fee:=(v->>'delivery_fee_cents')::numeric;
 if fee<>trunc(fee) or fee<0 or fee>9007199254740991 or fee+amount>9007199254740991 then raise exception 'Invalid Delivery fee.' using errcode='23514';end if;
 end if;
 return true;
end;$$;
-- NULL is retained only for pre-B historical foundation artifacts. No rewrite/backfill.
alter table public.order_requests add constraint order_requests_offer_terms check(
 (protocol_version=1 and offer_terms is null and listing_updated_at_at_offer is null)
 or(protocol_version=2 and (offer_terms is null or(marketplace_private.validate_offer_terms(offer_terms) and item_amount_cents=(offer_terms->>'item_amount_cents')::bigint))));
-- Existing immutable trigger compares all non-lifecycle columns, including these new fields.
create or replace function marketplace_private.mutate_offer(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null)
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.conversations;l public.listings;r public.order_requests;prior public.order_requests;
 cmd marketplace_private.offer_commands;cid uuid;lid uuid;digest text;amount bigint;note text;new_id uuid:=gen_random_uuid();t timestamptz;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null or p_action not in('create','withdraw') then raise exception 'Offer action UUID required.' using errcode='23514';end if;
 if p_action='create' then
 perform marketplace_private.validate_offer_terms(p_terms);
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
 perform marketplace_private.validate_offer_terms(p_terms,t);
 -- No settlement/read side effects; Offers never mutate inventory or start timers.
 if l.published_at is null or l.status<>'available' then raise exception 'Published available listing required.' using errcode='23514';end if;
 amount:=(p_terms->>'item_amount_cents')::bigint;note:=btrim(coalesce(p_terms->>'note',''));
 if amount is null or amount<0 or amount>9007199254740991 or char_length(note)>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 select * into prior from public.order_requests where conversation_id=cid and status='active' for update;
 if found and prior.protocol_version<>2 then raise exception 'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT' using errcode='23505';end if;
 insert into marketplace_private.offer_commands(actor_key,action,idempotency_key,input_digest,offer_id,previous_offer_id) values(actor,p_action,p_client_action_id,digest,new_id,prior.id);
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
revoke all on function marketplace_private.validate_offer_terms(jsonb,timestamptz) from public,anon,authenticated,service_role;
commit;

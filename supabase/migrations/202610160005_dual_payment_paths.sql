-- Dual payment paths. Additive, staging only; historical snapshots are not rewritten.
begin;



alter table public.listings add column preferred_payment_mode text not null default 'uu_pay'
 check(preferred_payment_mode in('uu_pay','external'));
alter table public.listings add constraint listings_delivery_payment_mode check(preferred_fulfillment='ON_CAMPUS' or preferred_payment_mode='uu_pay');
grant insert(preferred_payment_mode),update(preferred_payment_mode) on public.listings to authenticated;
create function marketplace_private.protect_listing_payment_mode() returns trigger
language plpgsql set search_path='' as $$begin
 if old.preferred_payment_mode is distinct from new.preferred_payment_mode and old.status<>'available' then
 raise exception 'Only available Listing preferences may change.' using errcode='23514';end if;return new;end;$$;
create trigger listings_payment_mode_guard before update of preferred_payment_mode on public.listings
for each row execute function marketplace_private.protect_listing_payment_mode();
revoke all on function marketplace_private.protect_listing_payment_mode() from public,anon,authenticated,service_role;
create function marketplace_private.payment_mode(v jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(v->>'payment_mode','uu_pay');$$;
revoke all on function marketplace_private.payment_mode(jsonb) from public,anon,authenticated,service_role;


create or replace function marketplace_private.validate_offer_terms(v jsonb, at_time timestamptz default null) returns boolean
language plpgsql immutable set search_path='' as $$
declare amount numeric; fee numeric; scheduled timestamptz; local_time timestamp; keys text[];
begin
 if v is null or jsonb_typeof(v)<>'object' then raise exception 'Offer terms required.' using errcode='23514';end if;
 if (v ? 'payment_mode') <> (v ? 'payment_mode_version')
 or (v ? 'payment_mode' and (jsonb_typeof(v->'payment_mode') is distinct from 'string'
 or v->>'payment_mode' not in('uu_pay','external') or v->'payment_mode_version' is distinct from '1'::jsonb))
 or (marketplace_private.payment_mode(v)='external' and v->>'fulfillment' is distinct from 'on_campus') then
 raise exception 'Invalid versioned payment mode.' using errcode='23514';end if;
 keys:=array['item_amount_cents','fulfillment','note','payment_mode','payment_mode_version'];
 if v->>'fulfillment'='on_campus' then keys:=keys||array['meetup_location','scheduled_at','meetup_location_provider','meetup_place_id'];
 elsif v->>'fulfillment'='delivery' then keys:=keys||array['delivery_fee_cents','delivery_method','delivery_area'];
 else raise exception 'Choose Meeting or Delivery.' using errcode='23514';end if;
 if (v-keys)<>'{}'::jsonb or jsonb_typeof(v->'item_amount_cents') is distinct from 'number'
 or (v ? 'note' and jsonb_typeof(v->'note') is distinct from 'string') then raise exception 'Unexpected Offer terms.' using errcode='23514';end if;
 amount:=(v->>'item_amount_cents')::numeric;
 if amount<>trunc(amount) or amount<1 or amount>9007199254740991 or char_length(coalesce(v->>'note',''))>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 if v->>'fulfillment'='on_campus' then
 if not marketplace_private.valid_meeting_reference(v->>'meetup_location_provider',v->>'meetup_place_id')
 or (v ? 'meetup_location_provider' and jsonb_typeof(v->'meetup_location_provider') not in ('null','string'))
 or (v ? 'meetup_place_id' and jsonb_typeof(v->'meetup_place_id') not in ('null','string')) then
 raise exception 'Invalid Meeting reference.' using errcode='23514';end if;
 if jsonb_typeof(v->'meetup_location') is distinct from 'string' or char_length(btrim(v->>'meetup_location')) not between 1 and 120
 or jsonb_typeof(v->'scheduled_at') is distinct from 'string' or (v->>'scheduled_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Meetup location and zoned time required.' using errcode='23514';end if;
 scheduled:=(v->>'scheduled_at')::timestamptz;local_time:=scheduled at time zone 'America/Toronto';
 if not isfinite(scheduled) or extract(minute from local_time)::integer%15<>0 or extract(second from local_time)<>0
 or(at_time is not null and (scheduled<at_time+interval '60 minutes' or scheduled>((at_time at time zone 'America/Toronto')+interval '30 days') at time zone 'America/Toronto')) then raise exception 'Choose a 15-minute time 60 minutes to 30 days ahead.' using errcode='23514';end if;
 else
 if jsonb_typeof(v->'delivery_fee_cents') is distinct from 'number' or v->>'delivery_method' is null or v->>'delivery_method' not in('seller_delivery','courier') then raise exception 'Delivery fee and method required.' using errcode='23514';end if;
 perform marketplace_private.normalize_delivery_area(v->'delivery_area');
 fee:=(v->>'delivery_fee_cents')::numeric;
 if fee<>trunc(fee) or fee<0 or fee>9007199254740991 or fee+amount>9007199254740991 then raise exception 'Invalid Delivery fee.' using errcode='23514';end if;
 end if;
 return true;
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
 p_terms:=jsonb_build_object('payment_mode','uu_pay','payment_mode_version',1)||p_terms;
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
 if p_action='create' and actor=c.seller_id and marketplace_private.payment_mode(p_terms)='uu_pay' then perform marketplace_private.require_seller_payout_ready(actor);end if;
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
 baseline:=coalesce(basis.offer_terms, prior.offer_terms,jsonb_build_object('item_amount_cents',l.price_cents,'payment_mode',l.preferred_payment_mode,'fulfillment',case when l.preferred_fulfillment='DELIVERY' then 'delivery' else 'on_campus' end));
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

create or replace function public.marketplace_offer_accept_preflight(p_offer_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;actor uuid:=auth.uid();cmd marketplace_private.offer_accept_commands;reason text;begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 select * into r from public.order_requests where id=p_offer_id;
 if r.id is null or r.protocol_version<>2 or r.recipient_user_id is distinct from actor or r.sender_user_id=actor
 then raise exception 'V2 Offer recipient required.' using errcode='42501';end if;
 select * into cmd from marketplace_private.offer_accept_commands where actor_key=actor and idempotency_key=p_client_action_id;
 if found then
  if cmd.offer_id<>r.id then raise exception 'Action UUID reused.' using errcode='23505';end if;
  return jsonb_build_object('orderId',cmd.order_id);
 end if;
 reason:=marketplace_private.offer_accept_eligibility(r);
 if reason is not null then return jsonb_build_object('errorCode',reason);end if;
 if marketplace_private.payment_mode(r.offer_terms)='uu_pay' then perform marketplace_private.require_seller_payout_ready(r.seller_id);end if;
 return jsonb_build_object('ready',true);
end;$$;

create or replace function public.marketplace_accept_offer(p_offer_id uuid,p_client_action_id uuid,p_media_batch uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();r public.order_requests;c public.conversations;l public.listings;
 o public.orders;cmd marketplace_private.offer_accept_commands;oid uuid:=gen_random_uuid();t timestamptz;reason text;
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
 insert into marketplace_private.offer_accept_commands(actor_key,idempotency_key,offer_id,order_id) values(actor,p_client_action_id,r.id,oid);
 insert into public.orders(id,order_protocol_version,request_id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,
 buyer_origin_id,seller_origin_id,terms_schema_version,terms_snapshot,listing_snapshot,item_amount_cents,shipping_amount_cents,
 money_status,service_fee_rule_version,holds_listing,created_at,updated_at,accepted_at)
 values(oid,2,r.id,c.id,l.id,r.listing_origin_id,r.buyer_id,r.seller_id,r.buyer_origin_id,r.seller_origin_id,2,
 jsonb_build_object('offerId',r.id,'senderId',r.sender_user_id,'recipientId',r.recipient_user_id,'terms',r.offer_terms,
 'termsVersion',2,'acceptedAt',t,'buyerName',r.buyer_username_snapshot,'sellerName',r.seller_username_snapshot),
 jsonb_build_object('listingId',l.id,'title',l.title,'description',l.description,'category',l.category,'subcategory',l.subcategory,
 'preferredPaymentMode',l.preferred_payment_mode,'preferredFulfillment',l.preferred_fulfillment,'condition',l.condition,'askingPriceCents',l.price_cents,'currency',l.currency,'sellerId',l.seller_id,
 'materialHash',r.listing_material_hash_at_offer,'mediaBatchId',p_media_batch),r.item_amount_cents,
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

create or replace function marketplace_private.offer_changed_fields(current_terms jsonb,baseline jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(label order by position),'[]'::jsonb) from (values
 (1,'Price',current_terms->'item_amount_cents' is distinct from baseline->'item_amount_cents'),
 (2,'Fulfillment',current_terms->'fulfillment' is distinct from baseline->'fulfillment'),
 (3,'Meeting location',lower(regexp_replace(btrim(coalesce(current_terms->>'meetup_location','')),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(coalesce(baseline->>'meetup_location','')),'[[:space:]]+',' ','g'))),
 (4,'Meetup time',current_terms->'scheduled_at' is distinct from baseline->'scheduled_at'),
 (5,'Delivery method',current_terms->'delivery_method' is distinct from baseline->'delivery_method'),
 (6,'Delivery fee',current_terms->'delivery_fee_cents' is distinct from baseline->'delivery_fee_cents'),
 (7,'Delivery area',current_terms->'delivery_area' is distinct from baseline->'delivery_area'),
 (9,'Payment method',marketplace_private.payment_mode(current_terms) is distinct from marketplace_private.payment_mode(baseline)),
 (8,'Note',coalesce(current_terms->>'note','') is distinct from coalesce(baseline->>'note',''))
 ) d(position,label,changed) where changed;
$$;

alter table marketplace_private.v2_order_economics drop constraint v2_order_economics_fee_rule_check;
alter table marketplace_private.v2_order_economics add constraint v2_order_economics_fee_rule_check check(
 (fee_rule='item_only_4pct_min100_max1500_v1' and buyer_service_fee_cents between 100 and 1500)
 or (fee_rule='item_only_1pct_max500_v2' and buyer_service_fee_cents=least(500,round(item_price_cents::numeric/100))::bigint)
 or (fee_rule='external_no_fee_v1' and buyer_service_fee_cents=0 and delivery_fee_cents=0));

create or replace function marketplace_private.freeze_v2_order_economics() returns trigger
language plpgsql security definer set search_path='' as $$
declare fee bigint;delivery bigint;total numeric;gross numeric;
begin
 if new.order_protocol_version<>2 then return new;end if;
 perform marketplace_private.validate_offer_terms(new.terms_snapshot->'terms');
 if new.terms_snapshot->'terms' is distinct from marketplace_private.normalize_offer_terms(new.terms_snapshot->'terms') then
  raise exception 'Accepted terms must be normalized.' using errcode='23514';end if;
 fee:=case when marketplace_private.payment_mode(new.terms_snapshot->'terms')='external' then 0 else marketplace_private.v2_buyer_service_fee(new.item_amount_cents) end;
 delivery:=case when new.terms_snapshot->'terms'->>'fulfillment'='delivery'
 then (new.terms_snapshot->'terms'->>'delivery_fee_cents')::bigint else 0 end;
 gross:=new.item_amount_cents::numeric+delivery;
 total:=gross+fee;
 if total>9007199254740991 then raise exception 'Order total exceeds safe integer range.' using errcode='23514';end if;
 insert into marketplace_private.v2_order_economics values(new.id,new.item_amount_cents,delivery,fee,total::bigint,0,
 gross::bigint,case when marketplace_private.payment_mode(new.terms_snapshot->'terms')='external' then 'external_no_fee_v1' else 'item_only_1pct_max500_v2' end,new.created_at);
 return new;
end;$$;

create table marketplace_private.external_exchanges (
 order_id uuid primary key references public.orders(id) on delete restrict,
 buyer_confirmed_at timestamptz, seller_confirmed_at timestamptz,
 disputed_at timestamptz, disputed_by uuid, dispute_note text,
 check((disputed_at is null and disputed_by is null and dispute_note is null)
 or (disputed_at is not null and disputed_by is not null and char_length(dispute_note) between 1 and 1000
 and (buyer_confirmed_at is not null or seller_confirmed_at is not null)))
);
alter table marketplace_private.external_exchanges enable row level security;
revoke all on marketplace_private.external_exchanges from public,anon,authenticated,service_role;
create function marketplace_private.seed_external_exchange() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.order_protocol_version=2 and marketplace_private.payment_mode(new.terms_snapshot->'terms')='external' then
 insert into marketplace_private.external_exchanges(order_id) values(new.id);end if;return new;end;$$;
create trigger orders_seed_external_exchange after insert on public.orders for each row execute function marketplace_private.seed_external_exchange();
create function marketplace_private.external_exchange_started(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from marketplace_private.external_exchanges where order_id=p_order_id and
 (buyer_confirmed_at is not null or seller_confirmed_at is not null));$$;
create function public.marketplace_external_exchange(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;e marketplace_private.external_exchanges;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or (auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id) then raise exception 'Participant required.' using errcode='42501';end if;
 if o.order_protocol_version<>2 or marketplace_private.payment_mode(o.terms_snapshot->'terms')<>'external' then return null;end if;
 select * into strict e from marketplace_private.external_exchanges where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'buyerConfirmedAt',e.buyer_confirmed_at,'sellerConfirmedAt',e.seller_confirmed_at,
 'disputedAt',e.disputed_at,'status',case when e.disputed_at is not null then 'disputed'
 when e.buyer_confirmed_at is not null and e.seller_confirmed_at is not null then 'confirmed'
 when e.buyer_confirmed_at is not null then 'buyer_confirmed' when e.seller_confirmed_at is not null then 'seller_confirmed' else 'awaiting_both' end);
end;$$;
create function public.marketplace_confirm_external_exchange(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;e marketplace_private.external_exchanges;t timestamptz;begin
 if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'order_flow'||p_client_action_id::text,0));
 o:=marketplace_private.lock_order_participant(p_order_id);
 if marketplace_private.payment_mode(o.terms_snapshot->'terms')<>'external' then raise exception 'External Meeting required.' using errcode='23514';end if;
 perform marketplace_private.settle_order_meetup(o.listing_id);
 select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.record_order_flow_command(o,'confirm_external',p_client_action_id,o.id::text);
 select * into strict e from marketplace_private.external_exchanges where order_id=o.id for update;
 if (auth.uid()=o.buyer_id and e.buyer_confirmed_at is not null) or (auth.uid()=o.seller_id and e.seller_confirmed_at is not null) then return public.marketplace_external_exchange(o.id);end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or e.disputed_at is not null or not marketplace_private.order_agreement_ready(o.id) then raise exception 'Exchange confirmation unavailable.' using errcode='23505';end if;
 perform marketplace_private.assert_order_progression(o);t:=clock_timestamp();
 if auth.uid()=o.buyer_id then update marketplace_private.external_exchanges set buyer_confirmed_at=t where order_id=o.id;
 else update marketplace_private.external_exchanges set seller_confirmed_at=t where order_id=o.id;end if;
 perform marketplace_private.emit_order_domain_event(o,case when auth.uid()=o.buyer_id then 'external_exchange_buyer_confirmed' else 'external_exchange_seller_confirmed' end,t,auth.uid());
 select * into e from marketplace_private.external_exchanges where order_id=o.id;
 if e.buyer_confirmed_at is not null and e.seller_confirmed_at is not null then
 update public.orders set lifecycle_status='completed',holds_listing=false,fulfillment_status='fulfilled',reservation_ended_at=t,updated_at=t where id=o.id;
 update public.listings set status='sold',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
 perform marketplace_private.emit_order_domain_event(o,'external_exchange_completed',t);
 end if;
 return public.marketplace_external_exchange(o.id);
end;$$;
create function public.marketplace_dispute_external_exchange(p_order_id uuid,p_reason text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;e marketplace_private.external_exchanges;t timestamptz;reason text:=btrim(p_reason);begin
 if p_client_action_id is null or reason is null or char_length(reason) not between 1 and 1000 then raise exception 'Reason and action UUID required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'order_flow'||p_client_action_id::text,0));
 o:=marketplace_private.lock_order_participant(p_order_id);
 if marketplace_private.payment_mode(o.terms_snapshot->'terms')<>'external' then raise exception 'External Meeting required.' using errcode='23514';end if;
 perform marketplace_private.record_order_flow_command(o,'dispute_external',p_client_action_id,encode(sha256(convert_to(jsonb_build_array(o.id,reason)::text,'UTF8')),'hex'));
 select * into strict e from marketplace_private.external_exchanges where order_id=o.id for update;
 if e.disputed_at is not null then return public.marketplace_external_exchange(o.id);end if;
 if o.lifecycle_status<>'open' or not marketplace_private.external_exchange_started(o.id)
 or (auth.uid()=o.buyer_id and e.buyer_confirmed_at is not null) or (auth.uid()=o.seller_id and e.seller_confirmed_at is not null) then raise exception 'Counterparty attestation required.' using errcode='23505';end if;
 t:=clock_timestamp();update marketplace_private.external_exchanges set disputed_at=t,disputed_by=auth.uid(),dispute_note=reason where order_id=o.id;
 perform marketplace_private.emit_order_domain_event(o,'external_exchange_disputed',t,auth.uid());
 return public.marketplace_external_exchange(o.id);
end;$$;
revoke all on function marketplace_private.seed_external_exchange(),marketplace_private.external_exchange_started(uuid),
 public.marketplace_external_exchange(uuid),public.marketplace_confirm_external_exchange(uuid,uuid),public.marketplace_dispute_external_exchange(uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_external_exchange(uuid),public.marketplace_confirm_external_exchange(uuid,uuid),public.marketplace_dispute_external_exchange(uuid,text,uuid) to authenticated;


create or replace function marketplace_private.meetup_mutable(o public.orders) returns boolean language sql stable security definer set search_path='' as $$
 select o.order_protocol_version=2 and o.terms_snapshot->'terms'->>'fulfillment'='on_campus' and o.lifecycle_status='open'
 and not marketplace_private.external_exchange_started(o.id) and o.holds_listing and o.payment_status in('pending','failed') and o.payment_paid_at is null and o.fulfillment_status='awaiting_payment';$$;

create or replace function marketplace_private.order_cancel_before_cutoff(o public.orders) returns boolean
language sql stable security definer set search_path='' as $$
 select not marketplace_private.external_exchange_started(o.id) and o.lifecycle_status='open' and o.holds_listing
 and not exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id and redeemed_at is not null)
 and not exists(select 1 from marketplace_private.order_protection where order_id=o.id)
 and not exists(select 1 from marketplace_private.courier_shipments where order_id=o.id and shipped_at is not null);
$$;

create or replace function marketplace_private.order_progression_allowed(o public.orders) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from marketplace_private.external_exchanges where order_id=o.id and disputed_at is not null) and not exists(select 1 from marketplace_private.order_cancellation_intents where order_id=o.id)
 and not exists(select 1 from marketplace_private.protection_cases where order_id=o.id);
$$;

create or replace function marketplace_private.guard_agreement_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if marketplace_private.payment_mode(new.terms_snapshot->'terms')='external' then raise exception 'External exchange has no UU payment.' using errcode='23514';end if;
 if new.order_protocol_version=2 and new.payment_status is distinct from old.payment_status
 and new.payment_status in('processing','paid') and not marketplace_private.order_agreement_ready(new.id)
 and not exists(select 1 from marketplace_private.order_cancellation_intents where order_id=new.id) then
  raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';
 end if;
 return new;
end;$$;

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin

 if tg_op='UPDATE' and old.order_protocol_version=2 and marketplace_private.payment_mode(old.terms_snapshot->'terms')='external' then
 if new.payment_status is distinct from old.payment_status or new.payment_paid_at is distinct from old.payment_paid_at
 or new.payout_status<>'not_eligible' or new.terms_snapshot is distinct from old.terms_snapshot then raise exception 'External payment authority is immutable.' using errcode='23514';end if;
 if old.lifecycle_status='open' and new.lifecycle_status='completed' then
 if new.holds_listing or new.fulfillment_status<>'fulfilled' or not marketplace_private.order_agreement_ready(old.id)
 or not exists(select 1 from marketplace_private.external_exchanges e where e.order_id=old.id and e.disputed_at is null and e.buyer_confirmed_at is not null and e.seller_confirmed_at is not null and new.reservation_ended_at=greatest(e.buyer_confirmed_at,e.seller_confirmed_at))
 or (to_jsonb(new)-array['lifecycle_status','holds_listing','fulfillment_status','reservation_ended_at','updated_at']) is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','fulfillment_status','reservation_ended_at','updated_at']) then raise exception 'Both immutable external attestations required.' using errcode='23514';end if;return new;
 elsif old.lifecycle_status='open' and new.lifecycle_status='cancelled' then
 if marketplace_private.external_exchange_started(old.id) or auth.uid() is null or new.cancelled_by is distinct from auth.uid()
 or new.cancelled_by_role is distinct from (case when auth.uid()=old.buyer_id then 'buyer' when auth.uid()=old.seller_id then 'seller' end)
 or new.holds_listing or new.cancelled_at is null or new.reservation_ended_at is distinct from new.cancelled_at
 or not exists(select 1 from marketplace_private.order_commands c where c.order_id=old.id and c.action='cancel_order' and c.actor_key=auth.uid())
 or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note']) is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note']) then raise exception 'Authoritative external cancellation required.' using errcode='23514';end if;return new;
 end if;
 end if;
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='completed' then
 perform marketplace_private.assert_order_progression(old);
 if old.payment_status<>'paid' or new.holds_listing or new.payout_status<>'eligible' or new.fulfillment_status<>'fulfilled'
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.order_protection p where p.order_id=old.id and p.completed_at=new.reservation_ended_at and p.completed_at>=p.expires_at)
 or exists(select 1 from marketplace_private.protection_cases where order_id=old.id) then raise exception 'Mature unheld Protection receipt required.' using errcode='23514';end if;
 return new;end if;

 if tg_op='UPDATE' and old.order_protocol_version=2 and old.terms_snapshot->'terms'->>'fulfillment'='delivery' and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if old.payment_status not in('pending','failed') or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.expired_at=new.expired_at and
 ((c.checkout_started_at is null and c.checkout_claim_deadline_at<=new.expired_at) or c.payment_deadline_at<=new.expired_at)) then
 raise exception 'Authoritative Delivery expiry receipt required.' using errcode='23514';end if;return new;end if;
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions mr on mr.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=mr.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and mr.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

  if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='cancelled'
   and old.payment_status in('pending','failed','paid') then
   if new.holds_listing or new.cancelled_at is null or new.reservation_ended_at is distinct from new.cancelled_at
   or new.payout_status<>'not_eligible' or not marketplace_private.order_cancel_before_cutoff(old)
   or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
   is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
   or not exists(select 1 from marketplace_private.order_cancellation_intents i
    join marketplace_private.order_settlement_authorizations a on a.order_id=i.order_id
    where i.order_id=old.id and i.state='finalized' and i.finalized_at=new.cancelled_at
    and i.requested_by=new.cancelled_by and i.requested_by_role=new.cancelled_by_role
    and i.reason=new.cancel_reason_code and i.note=new.cancel_note
    and a.authorized_at=new.cancelled_at and a.platform_retained_cents=0 and a.seller_sale_payout_cents=0)
   then raise exception 'Authoritative cancellation settlement required.' using errcode='23514';end if;
   return new;
  end if;

  if tg_op='UPDATE' and old.order_protocol_version=2 and new.payment_status is distinct from old.payment_status then
   if old.lifecycle_status<>'open' or new.lifecycle_status<>'open' or not old.holds_listing
    or old.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery')
    or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
      is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
    or not ((old.terms_snapshot->'terms'->>'fulfillment'='on_campus') or (old.terms_snapshot->'terms'->>'fulfillment'='delivery' and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.address_frozen_at is not null and c.address_snapshot is not null)))
    or not exists(select 1 from marketplace_private.campus_payment_attempts a where a.order_id=old.id and a.status=new.payment_status
      and ((old.payment_status in('pending','failed') and new.payment_status='processing' and a.finished_at is null and auth.uid()=old.buyer_id)
        or(old.payment_status='processing' and new.payment_status in('paid','failed') and a.finished_at is not null
          and (auth.jwt()->>'role')='service_role' and (auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'
          and (new.payment_status<>'paid' or new.payment_paid_at=a.finished_at))))
    or new.fulfillment_status<>(case when new.payment_status='paid' then 'awaiting_fulfillment' else 'awaiting_payment' end)
    then raise exception 'Trusted V2 payment receipt required.' using errcode='42501';end if;return new;
  end if;
  if tg_op<>'DELETE' and new.order_protocol_version=2 then
   if tg_op='INSERT' then
    select * into r from public.order_requests where id=new.request_id;
    if r.protocol_version<>2 or r.status<>'active' or r.recipient_user_id is distinct from auth.uid()
    or new.buyer_id is distinct from r.buyer_id or new.seller_id is distinct from r.seller_id
    or new.buyer_origin_id<>r.buyer_origin_id or new.seller_origin_id<>r.seller_origin_id
    or new.listing_id<>r.listing_id or new.listing_origin_id<>r.listing_origin_id or new.conversation_id<>r.conversation_id
    or new.terms_snapshot->'terms' is distinct from r.offer_terms or new.item_amount_cents<>r.item_amount_cents
    or not exists(select 1 from marketplace_private.offer_accept_commands x where x.order_id=new.id and x.offer_id=r.id and x.actor_key=auth.uid())
    then raise exception 'Atomic recipient V2 Order required.' using errcode='42501';end if;
    return new;
   end if;
   if old.order_protocol_version<>2 then raise exception 'Order protocol immutable.' using errcode='42501';end if;
   if (to_jsonb(new)-array['updated_at','buyer_id','seller_id']) is distinct from (to_jsonb(old)-array['updated_at','buyer_id','seller_id'])
    or (new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)))
    or (new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)))
    then raise exception 'V2 Order snapshot/state immutable in C2.' using errcode='42501';end if;
   return new;
  end if;
  if tg_op='UPDATE' and new.order_protocol_version is distinct from old.order_protocol_version then
   raise exception 'Order protocol immutable.' using errcode='42501';end if;
  if tg_op='DELETE' then raise exception 'Order history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='INSERT' then
    if new.cancelled_at is not null or new.cancelled_by is not null or new.cancelled_by_role is not null or new.cancel_reason_code is not null or new.cancel_reason_label_snapshot is not null or new.cancel_note is not null then
      raise exception 'Canonical initial cancellation state required.' using errcode='23514'; end if;
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
    if new.payment_status<>'pending' or new.payment_paid_at is not null or new.payout_status<>'not_eligible' or new.fulfillment_status<>'awaiting_payment' then
      raise exception 'Canonical initial financial state required.' using errcode='23514'; end if;
    return new;
  end if;
  if new.lifecycle_status='cancelled' and old.lifecycle_status='open' then
    if old.payment_status not in('pending','failed') or old.payment_paid_at is not null
      or auth.uid() is null or (old.buyer_id is distinct from auth.uid() and old.seller_id is distinct from auth.uid())
      or new.cancelled_by is distinct from auth.uid()
      or new.cancelled_by_role is distinct from (case when old.buyer_id=auth.uid() then 'buyer' else 'seller' end)
      or new.cancelled_at is null or new.expired_at is not null or new.holds_listing
      or (old.holds_listing and (new.cancelled_at>=old.reservation_expires_at or new.reservation_ended_at is distinct from new.cancelled_at))
      or (not old.holds_listing and new.reservation_ended_at is not null)
      or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
        is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note']) then
      raise exception 'Invalid Order cancellation.' using errcode='23514'; end if;
    return new;
  end if;
  if new.payment_status is distinct from old.payment_status then
    if old.payment_status<>'pending' or new.payment_status<>'paid' or old.lifecycle_status<>'open'
      or new.lifecycle_status<>'open' or not old.holds_listing or old.money_status<>'finalized'
      or new.payment_paid_at is null or new.payment_paid_at>=old.reservation_expires_at
      or old.payment_paid_at is not null or new.payout_status<>'not_eligible'
      or new.fulfillment_status<>'awaiting_fulfillment'
      or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
        is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at']) then
      raise exception 'Invalid financial transition.' using errcode='23514'; end if;
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
  elsif old.payment_status='paid' or old.lifecycle_status<>'open' or new.lifecycle_status<>'expired' or old.reservation_expires_at is null or old.reservation_expires_at>clock_timestamp() then
    raise exception 'Invalid Order transition.' using errcode='23514'; end if;
  return new;
end; $$;

create or replace function public.marketplace_cancel_order(p_order_id uuid,p_reason text,p_note text,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; actor uuid:=auth.uid(); actor_role text; label text;
  note text:=btrim(coalesce(p_note,'')); t timestamptz; digest text; cmd marketplace_private.order_commands; intent marketplace_private.order_cancellation_intents; path text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'Action UUID required.' using errcode='23514'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found or (o.buyer_id is distinct from actor and o.seller_id is distinct from actor) then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  if o.order_protocol_version=1 then return marketplace_private.cancel_legacy_order(p_order_id,p_reason,p_note,p_client_action_id);end if;
  actor_role:=case when o.buyer_id=actor then 'buyer' else 'seller' end;
  label:=case
    when p_reason='other' then 'Other'
    when actor_role='buyer' then case p_reason
      when 'buyer_changed_mind' then 'Changed my mind'
      when 'buyer_payment_issue' then 'Can''t complete payment'
      when 'buyer_scheduling_issue' then 'Scheduling issue'
      when 'buyer_terms_issue' then 'Item or terms no longer work for me' end
    else case p_reason
      when 'seller_item_unavailable' then 'Item no longer available'
      when 'seller_scheduling_issue' then 'Scheduling issue'
      when 'buyer_requested_cancellation' then 'Buyer requested cancellation'
      when 'seller_terms_issue' then 'Terms need to change' end end;
  if label is null or char_length(note)>1000 or (p_reason='other' and note='') then
    raise exception 'Valid cancellation reason/note required.' using errcode='23514'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_array(p_order_id,p_reason,note)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'cancel_order'||p_client_action_id::text,0));
  select * into cmd from marketplace_private.order_commands where actor_key=actor and action='cancel_order' and idempotency_key=p_client_action_id;
  if found then
    if cmd.input_digest<>digest then raise exception 'Action UUID reused.' using errcode='23505'; end if;
    select * into o from public.orders where id=cmd.order_id;
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  perform 1 from public.listings where id=o.listing_id for update;
  -- Settle only this Order's own unpaid hold; do not expire an unrelated holder.
  select * into o from public.orders where id=p_order_id for update;
  if o.buyer_id is distinct from actor and o.seller_id is distinct from actor then
    raise exception 'Order not accessible.' using errcode='42501'; end if;
  if o.lifecycle_status='cancelled' then
    return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp()); end if;
  if o.order_protocol_version=2 and marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' then
   perform marketplace_private.settle_order_meetup(o.listing_id);
   select * into o from public.orders where id=p_order_id for update;
   if not marketplace_private.order_cancel_before_cutoff(o) then return jsonb_build_object('errorCode','order_not_cancellable');end if;
   t:=clock_timestamp();
   insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'cancel_order',p_client_action_id,digest,o.request_id,o.id);
   update public.orders set lifecycle_status='cancelled',holds_listing=false,cancelled_at=t,cancelled_by=actor,cancelled_by_role=actor_role,
    cancel_reason_code=p_reason,cancel_reason_label_snapshot='External exchange cancelled',cancel_note=note,reservation_ended_at=t,updated_at=t where id=o.id returning * into o;
   update public.listings set status='available',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
   perform marketplace_private.emit_order_domain_event(o,'external_exchange_cancelled',t,actor);
   return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
  end if;
  select * into intent from marketplace_private.order_cancellation_intents where order_id=o.id;
  if intent.order_id is not null then
   if intent.requested_by<>actor or intent.reason<>p_reason or intent.note<>note or intent.path='full_refund_request' then
   raise exception 'Existing cancellation intent differs.' using errcode='23505';end if;
   return jsonb_build_object('order',to_jsonb(o),'serverTime',clock_timestamp());
  end if;
  if not marketplace_private.order_cancel_before_cutoff(o) or not marketplace_private.order_progression_allowed(o)
   or o.payment_status not in('pending','failed','processing','paid') then
   return jsonb_build_object('errorCode','order_not_cancellable');end if;
  if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
  select * into o from public.orders where id=p_order_id for update;
  t:=clock_timestamp();
  if o.lifecycle_status<>'open' or (o.order_protocol_version=1 and o.holds_listing and o.reservation_expires_at<=t) then
    if o.order_protocol_version=1 and o.holds_listing then perform marketplace_private.settle_listing_reservation(o.listing_id); end if;
    return jsonb_build_object('errorCode','order_not_cancellable'); end if;
  path:=case when actor_role='buyer' and o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery'
   and exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id)
   then 'delivery_compensation' else 'full_release' end;
  insert into marketplace_private.order_cancellation_intents values(o.id,actor,actor_role,t,p_reason,note,o.payment_status,
   jsonb_build_object('deliveryStarted',exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id),
   'handoffConfirmed',false,'shipped',false),path,'payment_pending',null,null,null);
  perform marketplace_private.emit_order_domain_event(o,'cancellation_requested',t,actor);
  perform marketplace_private.finalize_order_cancellation(o.id);
  select * into o from public.orders where id=o.id;
  insert into marketplace_private.order_commands(actor_key,action,idempotency_key,input_digest,request_id,order_id)
    values(actor,'cancel_order',p_client_action_id,digest,o.request_id,o.id);
  return jsonb_build_object('order',to_jsonb(o),'serverTime',t);
end; $$;

create or replace function marketplace_private.protect_listing_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.status='pending' and new.status='sold' then
 if new.reserved_order_id is not null or
 (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text']) is distinct from(to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text'])
 or not exists(select 1 from public.orders o where o.id=old.reserved_order_id and o.order_protocol_version=2 and o.listing_id=old.id and o.lifecycle_status='completed' and not o.holds_listing and ((o.payment_status='paid' and o.payout_status='eligible') or (marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' and exists(select 1 from marketplace_private.external_exchanges e where e.order_id=o.id and e.buyer_confirmed_at is not null and e.seller_confirmed_at is not null and e.disputed_at is null)))) then
 raise exception 'Completed protected V2 transaction required.' using errcode='42501';end if;return new;end if;

 if tg_op<>'DELETE' and (new.status='pending' or old.status='pending') then
  if new.status='pending' then
   if old.reserved_order_id is not null and new.reserved_order_id is distinct from old.reserved_order_id
    or not exists(select 1 from public.orders o where o.id=new.reserved_order_id and o.order_protocol_version=2
    and o.listing_id=new.id and o.seller_id=new.seller_id and o.holds_listing and o.lifecycle_status='open')
    then raise exception 'Server V2 winner required.' using errcode='42501';end if;
   return new;
  end if;
  if new.status<>'available' or new.reserved_order_id is not null
   or exists(select 1 from public.orders where id=old.reserved_order_id and holds_listing)
   then raise exception 'Server V2 release required.' using errcode='42501';end if;
  return new;
 end if;
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

CREATE OR REPLACE FUNCTION public.marketplace_order_fulfillment(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;p marketplace_private.order_protection;a marketplace_private.handoff_authorizations;c marketplace_private.protection_cases;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into p from marketplace_private.order_protection where order_id=o.id;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 return jsonb_build_object('externalExchange',public.marketplace_external_exchange(o.id),'agreement',public.marketplace_order_agreement(o.id),'orderId',o.id,'handoffReady',a.order_id is not null and a.redeemed_at is null and o.lifecycle_status='open' and marketplace_private.order_progression_allowed(o),
 'deliveryStartedAt',(select started_at from marketplace_private.seller_delivery_starts where order_id=o.id),
 'cancellation',public.marketplace_order_cancellation_state(o.id),
 'handoffConfirmedAt',a.redeemed_at,'protectionStartedAt',p.started_at,'protectionExpiresAt',p.expires_at,
 'protectionCompletedAt',p.completed_at,'protectionHold',c.id is not null,'caseState',c.state,
 'payoutEligible',o.lifecycle_status='completed' and c.id is null and o.payout_status='eligible','serverTime',clock_timestamp());
end;$function$
;


do $$declare expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_v2_foundation';
 execute 'alter table public.orders drop constraint orders_v2_foundation';
 execute 'alter table public.orders add constraint orders_v2_foundation check(('||expr||') or(order_protocol_version=2 and terms_schema_version=2 and terms_snapshot->''terms''->>''payment_mode''=''external'' and terms_snapshot->''terms''->>''fulfillment''=''on_campus'' and lifecycle_status=''completed'' and not holds_listing and payment_status=''pending'' and payment_paid_at is null and payout_status=''not_eligible'' and fulfillment_status=''fulfilled'' and money_status=''v2_pending'' and service_fee_rule_version=''not_finalized_v2'' and service_fee_amount_cents is null and total_amount_cents is null and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null and expired_at is null and cancelled_at is null and reservation_ended_at is not null))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_event_type_check';
 execute 'alter table public.transaction_events drop constraint transaction_events_event_type_check';
 execute 'alter table public.transaction_events add constraint transaction_events_event_type_check check(('||expr||') or event_type in(''external_exchange_buyer_confirmed'',''external_exchange_seller_confirmed'',''external_exchange_completed'',''external_exchange_disputed'',''external_exchange_cancelled''))';
end;$$;
create function marketplace_private.notify_external_exchange() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders;eid uuid;recipient uuid;begin
 if new.event_type not like 'external_exchange_%' then return new;end if;
 select * into o from public.orders where id=new.order_id;
 insert into marketplace_private.notification_events(source_key,event_type,destination) values('external:'||new.id,new.event_type,jsonb_build_object('section','orders','orderId',o.id)) returning id into eid;
 foreach recipient in array array[o.buyer_id,o.seller_id] loop
 if recipient is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,recipient,case when new.event_type in('external_exchange_completed','external_exchange_cancelled') then 'INFORMATIONAL' else 'ACTION_REQUIRED' end);end if;end loop;
 return new;end;$$;
create trigger transaction_external_notifications after insert on public.transaction_events for each row execute function marketplace_private.notify_external_exchange();
revoke all on function marketplace_private.notify_external_exchange() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.marketplace_start_order_payment(p_order_id uuid, p_client_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;method text;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_payment'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery') then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into a from marketplace_private.campus_payment_attempts where buyer_id=auth.uid() and command=p_client_action_id;
 if found and a.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 -- Match legacy V1 capability -> Listing -> Order, including stale V1 retries on a reused Listing.
 perform marketplace_private.lock_financial_capability(auth.uid(),'payment_method');
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.order_agreement_ready(o.id) then raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';end if;
 if marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' then raise exception 'External exchange has no UU payment.' using errcode='23514';end if;
 perform marketplace_private.assert_order_progression(o);
 select * into l from public.listings where id=o.listing_id;
 if a.id is not null then return jsonb_build_object('attemptId',a.id,'status',a.status);end if;
 -- A browser restart may lose its command. Reconcile the existing protected attempt,
 -- never create another attempt or require a new payment-method authorization.
 if o.lifecycle_status='open' and o.holds_listing and o.payment_status='processing' and o.buyer_id=auth.uid() then
  select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and buyer_id=auth.uid() and status='processing';
  if a.id is null then raise exception 'Protected attempt missing.' using errcode='23514';end if;
  return jsonb_build_object('attemptId',a.id,'status',a.status);
 end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending' or l.reserved_order_id is distinct from o.id or o.payment_status not in('pending','failed')
 or o.buyer_id is distinct from auth.uid() then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 perform 1 from marketplace_private.delivery_checkouts where order_id=o.id and checkout_started_at is not null and payment_deadline_at>clock_timestamp() and address_snapshot is not null for update;
 if not found then raise exception 'Valid checkout and matching private address required.' using errcode='23514';end if;
 end if;
 perform marketplace_private.v2_order_money(o.id);
 -- Capability is rechecked at actual payment initiation, before fulfillment.
 select status into method from marketplace_private.financial_capabilities where user_id=auth.uid() and capability='payment_method' for update;
 if method is distinct from 'set' then return jsonb_build_object('errorCode','buyer_payment_method_not_ready');end if;
 t:=clock_timestamp();
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 update marketplace_private.delivery_checkouts set address_frozen_at=coalesce(address_frozen_at,t) where order_id=o.id;
 end if;
 insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at) values(o.id,auth.uid(),p_client_action_id,'processing',t) returning * into a;
 update public.orders set payment_status='processing',updated_at=t where id=o.id;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','payment_started',t,a.id::text||':payment_started',jsonb_build_object('orderId',o.id,'source','staging_simulator'));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return jsonb_build_object('attemptId',a.id,'status',a.status);
end;$function$
;
create or replace function marketplace_private.project_transaction_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;o public.orders;eid uuid;dest jsonb;kind text:=new.event_type;target uuid;priority text:='INFORMATIONAL';
begin
 select * into r from public.order_requests where id=new.request_id;
 if r.protocol_version is distinct from 2 then return new;end if;
 select * into o from public.orders where id=new.order_id or(request_id=r.id and kind='offer_accepted');
 if marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' and kind in('order_completed','order_cancelled') then return new;end if;
 dest:=case when o.id is not null then jsonb_build_object('section','orders','orderId',o.id)
 else jsonb_build_object('section','messages','conversationId',new.conversation_id,'offerId',r.id) end;
 if kind='offer_created' then
  kind:=case when new.metadata->>'previousOfferId' is not null and exists(select 1 from public.order_requests prev
   where prev.id=(new.metadata->>'previousOfferId')::uuid and prev.sender_user_id<>r.sender_user_id) then 'incoming_counter_offer' else 'incoming_offer' end;
  target:=r.recipient_user_id;priority:='ACTION_REQUIRED';
 elsif kind in('offer_declined','offer_accepted') then target:=r.sender_user_id;
 elsif kind='offer_withdrawn' then target:=r.recipient_user_id;
 elsif kind in('meetup_proposed','meetup_confirmed','meetup_declined','order_cancelled','cancellation_requested','protection_case_opened') and new.actor_id is not null then
  target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
  if kind in('meetup_proposed','cancellation_requested','protection_case_opened') then priority:='ACTION_REQUIRED';end if;
 elsif kind in('payment_paid','buyer_confirm_received') then target:=r.seller_id;
 elsif kind in('payment_failed','seller_delivery_started','courier_shipped') then target:=r.buyer_id;
 elsif kind in('offer_closed','order_no_show_expired','reservation_expired','order_cancelled','order_completed',
 'handoff_ready','handoff_confirmed','protection_started','courier_delivered','protection_case_opened') then target:=null;
 else return new;end if;
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values('transaction:'||new.id,kind,new.created_at,dest) on conflict(source_key) do nothing;
 select id into eid from marketplace_private.notification_events where source_key='transaction:'||new.id;
 if target is not null then
  if target is distinct from new.actor_id or kind='payment_failed' then perform marketplace_private.deliver_notification(eid,target,priority);end if;
 else
  if r.buyer_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.buyer_id,priority);end if;
  if r.seller_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.seller_id,priority);end if;
 end if;
 return new;
end;$$;
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
t:=clock_timestamp();eligible:=o.lifecycle_status='open' and o.holds_listing and not marketplace_private.external_exchange_started(o.id);
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
commit;

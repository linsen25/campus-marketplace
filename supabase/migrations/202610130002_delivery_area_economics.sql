-- Additive locked-contract terms and immutable V2 economics. Staging qualification required.
begin;

create function marketplace_private.normalize_delivery_area(v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare country text; province text; city text; prefix text;
begin
 if v is null or jsonb_typeof(v)<>'object' or
 (v-array['country_code','province_code','city_label','postal_prefix'])<>'{}'::jsonb or
 jsonb_typeof(v->'country_code') is distinct from 'string' or
 jsonb_typeof(v->'province_code') is distinct from 'string' or
 jsonb_typeof(v->'city_label') is distinct from 'string' or
 jsonb_typeof(v->'postal_prefix') is distinct from 'string' then
 raise exception 'Structured coarse Delivery area required.' using errcode='23514';end if;
 country:=upper(btrim(v->>'country_code'));province:=upper(btrim(v->>'province_code'));
 city:=btrim(v->>'city_label');prefix:=upper(regexp_replace(v->>'postal_prefix','[[:space:]]','','g'));
 if country<>'CA' or province not in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
 or char_length(city) not between 1 and 120 or city ~ '[[:cntrl:]]'
 or prefix !~ '^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ]$' then
 raise exception 'Valid Canadian province, city label and postal prefix required.' using errcode='23514';end if;
 return jsonb_build_object('country_code',country,'province_code',province,'city_label',city,'postal_prefix',prefix);
end;$$;
create function marketplace_private.normalize_offer_terms(v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 if v->>'fulfillment'='delivery' then
 return jsonb_set(v,'{delivery_area}',marketplace_private.normalize_delivery_area(v->'delivery_area'));
 end if;return v;
end;$$;

-- Private, immutable one-to-one Order economics, frozen inside the Accept transaction.
-- Legacy V1 columns/fee authority and historical rows are not rewritten.
create table marketplace_private.v2_order_economics (
 order_id uuid primary key references public.orders(id) on delete restrict,
 item_price_cents bigint not null check(item_price_cents between 1 and 9007199254740991),
 delivery_fee_cents bigint not null check(delivery_fee_cents between 0 and 9007199254740991),
 buyer_service_fee_cents bigint not null check(buyer_service_fee_cents between 100 and 1500),
 buyer_total_cents bigint not null check(buyer_total_cents between 1 and 9007199254740991),
 seller_platform_fee_cents bigint not null default 0 check(seller_platform_fee_cents=0),
 seller_gross_cents bigint not null check(seller_gross_cents between 1 and 9007199254740991),
 fee_rule text not null check(fee_rule='item_only_4pct_min100_max1500_v1'),
 created_at timestamptz not null,
 check(buyer_total_cents::numeric=item_price_cents::numeric+delivery_fee_cents+buyer_service_fee_cents),
 check(seller_gross_cents::numeric=item_price_cents::numeric+delivery_fee_cents)
);
alter table marketplace_private.v2_order_economics enable row level security;
revoke all on marketplace_private.v2_order_economics from public,anon,authenticated,service_role;
create function marketplace_private.freeze_v2_order_economics() returns trigger
language plpgsql security definer set search_path='' as $$
declare m jsonb;fee bigint;delivery bigint;total numeric;
begin
 if new.order_protocol_version<>2 then return new;end if;
 perform marketplace_private.validate_offer_terms(new.terms_snapshot->'terms');
 if new.terms_snapshot->'terms' is distinct from marketplace_private.normalize_offer_terms(new.terms_snapshot->'terms') then
 raise exception 'Accepted terms must be normalized.' using errcode='23514';end if;
 m:=marketplace_private.order_money(new.item_amount_cents,0);fee:=(m->>'fee')::bigint;
 delivery:=case when new.terms_snapshot->'terms'->>'fulfillment'='delivery'
 then (new.terms_snapshot->'terms'->>'delivery_fee_cents')::bigint else 0 end;
 total:=new.item_amount_cents::numeric+delivery+fee;
 if total>9007199254740991 then raise exception 'Order total exceeds safe integer range.' using errcode='23514';end if;
 insert into marketplace_private.v2_order_economics values(new.id,new.item_amount_cents,delivery,fee,total::bigint,0,
 new.item_amount_cents+delivery,'item_only_4pct_min100_max1500_v1',new.created_at);
 return new;
end;$$;
create trigger orders_freeze_v2_economics after insert on public.orders
for each row execute function marketplace_private.freeze_v2_order_economics();
create function marketplace_private.protect_v2_order_economics() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Accepted Order economics are immutable.' using errcode='23514';end;$$;
create trigger v2_order_economics_immutable before update or delete on marketplace_private.v2_order_economics
for each row execute function marketplace_private.protect_v2_order_economics();
create function marketplace_private.v2_order_money(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e marketplace_private.v2_order_economics;
begin select * into e from marketplace_private.v2_order_economics where order_id=p_order_id;
 if not found then raise exception 'Frozen Order economics unavailable.' using errcode='23514';end if;
 return jsonb_build_object('item',e.item_price_cents,'delivery',e.delivery_fee_cents,'fee',e.buyer_service_fee_cents,
 'total',e.buyer_total_cents,'sellerFee',e.seller_platform_fee_cents,'sellerGross',e.seller_gross_cents,'feeRule',e.fee_rule);
end;$$;
create function public.marketplace_order_economics(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) or not exists(
 select 1 from public.orders where id=p_order_id and order_protocol_version=2 and (buyer_id=auth.uid() or seller_id=auth.uid())) then
 raise exception 'Verified Order participant required.' using errcode='42501';end if;
 return marketplace_private.v2_order_money(p_order_id);
end;$$;

create or replace function marketplace_private.validate_offer_terms(v jsonb, at_time timestamptz default null) returns boolean
language plpgsql immutable set search_path='' as $$
declare amount numeric; fee numeric; scheduled timestamptz; local_time timestamp; keys text[];
begin
 if v is null or jsonb_typeof(v)<>'object' then raise exception 'Offer terms required.' using errcode='23514';end if;
 keys:=array['item_amount_cents','fulfillment','note'];
 if v->>'fulfillment'='on_campus' then keys:=keys||array['meetup_location','scheduled_at'];
 elsif v->>'fulfillment'='delivery' then keys:=keys||array['delivery_fee_cents','delivery_method','delivery_area'];
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
 perform marketplace_private.normalize_delivery_area(v->'delivery_area');
 fee:=(v->>'delivery_fee_cents')::numeric;
 if fee<>trunc(fee) or fee<0 or fee>9007199254740991 or fee+amount>9007199254740991 then raise exception 'Invalid Delivery fee.' using errcode='23514';end if;
 end if;
 return true;
end;$$;

create or replace function marketplace_private.mutate_offer(p_action text,p_target uuid,p_terms jsonb,p_client_action_id uuid,p_note text default null)
returns public.order_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.conversations;l public.listings;r public.order_requests;prior public.order_requests;
 cmd marketplace_private.offer_commands;cid uuid;lid uuid;digest text;amount bigint;note text;new_id uuid:=gen_random_uuid();t timestamptz;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null or p_action not in('create','withdraw') then raise exception 'Offer action UUID required.' using errcode='23514';end if;
 if p_action='create' then
 p_terms:=marketplace_private.normalize_offer_terms(p_terms);
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

create or replace function public.marketplace_campus_payment_state(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.campus_inspections;m jsonb;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid())
 or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Order not accessible.' using errcode='42501';end if;
 select * into i from marketplace_private.campus_inspections where order_id=o.id;
 m:=marketplace_private.v2_order_money(o.id);
 return jsonb_build_object('inspectionConfirmedAt',i.confirmed_at,'itemCents',coalesce(i.item_cents,o.item_amount_cents),
 'feeCents',coalesce(i.fee_cents,(m->>'fee')::bigint),'totalCents',coalesce(i.total_cents,(m->>'total')::bigint),
 'feeRule',m->>'feeRule','serverTime',clock_timestamp());
end;$$;

create or replace function public.marketplace_confirm_campus_inspection(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.campus_inspections;m jsonb;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_inspection'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into i from marketplace_private.campus_inspections where buyer_id=auth.uid() and command=p_client_action_id;
 if found and i.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 -- All transaction progression shares Listing -> Order. No local countdown authority.
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into i from marketplace_private.campus_inspections where order_id=o.id;
 if found then return public.marketplace_campus_payment_state(o.id);end if;
 if not marketplace_private.meetup_mutable(o) or o.buyer_id is distinct from auth.uid() then raise exception 'Order not inspectable.' using errcode='23505';end if;
 t:=clock_timestamp();m:=marketplace_private.v2_order_money(o.id);
 insert into marketplace_private.campus_inspections values(o.id,auth.uid(),p_client_action_id,t,o.item_amount_cents,(m->>'fee')::bigint,(m->>'total')::bigint,'preview_cad_v1');
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','buyer_inspection_confirmed',t,o.id::text||':buyer_inspection_confirmed',jsonb_build_object('orderId',o.id));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_campus_payment_state(o.id);
end;$$;

revoke all on function marketplace_private.normalize_delivery_area(jsonb),marketplace_private.normalize_offer_terms(jsonb),
 marketplace_private.freeze_v2_order_economics(),marketplace_private.protect_v2_order_economics(),marketplace_private.v2_order_money(uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_economics(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_economics(uuid) to authenticated;
commit;

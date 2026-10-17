create temporary table bc_people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'bc_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','BC_'||left(replace(id::text,'-',''),12))
from bc_people cross join lateral(values(seller),(buyer),(outsider)) v(id);
create function pg_temp.bc_actor(id uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.bc_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is not true then raise exception 'Backend contract assertion: %',label;end if;end;$$;
create function pg_temp.bc_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
if sqlstate=expected then return;end if;raise exception 'Wrong SQLSTATE %, expected %',sqlstate,expected;end;
raise exception 'Unexpected success: %',statement;end;$$;
alter table public.listings disable trigger listings_publication_boundary;
-- Fixture media below is a rollback-only SQL receipt, not a real upload claim.

create function pg_temp.mp_listing(channel text) returns uuid language plpgsql as $$declare lid uuid;begin
 insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at,listing_channel)
 select seller,'Message provenance rollback','Synthetic',8000,'CAD','Electronics','Computers & Tablets','good','Western University',1,clock_timestamp(),channel from bc_people returning id into lid;
 return lid;
end;$$;
do $$declare lid uuid;c public.conversations;r public.conversations;msg public.messages;i integer;offer public.order_requests;terms jsonb;begin
 perform pg_temp.bc_actor((select buyer from bc_people));
 lid:=pg_temp.mp_listing('resale');c:=public.marketplace_contact_seller(lid);
 perform pg_temp.bc_assert(c.listing_channel_snapshot='resale' and c.shop_name_snapshot is null,'A Resale derived');
 lid:=pg_temp.mp_listing('shop');
 perform pg_temp.bc_reject(format('select public.marketplace_contact_seller(%L)',lid),'23514');
 perform pg_temp.bc_reject(format('select public.marketplace_find_or_create_conversation(%L)',lid),'23514');
 perform pg_temp.bc_assert(not exists(select 1 from public.conversations where listing_origin_id=lid),'C no partial thread');
 insert into public.shops(owner_id,name,category,description)select seller,'Vintage Loop','Electronics','Synthetic Shop' from bc_people;
 for i in 0..1 loop
 lid:=pg_temp.mp_listing('shop');
 if i=0 then c:=public.marketplace_contact_seller(lid);else c:=public.marketplace_find_or_create_conversation(lid);end if;
 perform pg_temp.bc_assert(c.listing_channel_snapshot='shop' and c.shop_name_snapshot='Vintage Loop','B both INSERT entrypoints');
 update public.shops set name='Chris Vintage' where owner_id=c.seller_id;
 r:=public.marketplace_contact_seller(lid);
 perform pg_temp.bc_assert(r.id=c.id and r.shop_name_snapshot='Vintage Loop','D E Contact reuse frozen');
 r:=public.marketplace_find_or_create_conversation(lid);
 perform pg_temp.bc_assert(r.id=c.id and r.shop_name_snapshot='Vintage Loop','F find/create reuse frozen');
 perform pg_temp.bc_reject(format('update public.conversations set shop_name_snapshot=%L where id=%L','Forged',c.id),'23514');
 perform pg_temp.bc_reject(format('update public.conversations set listing_channel_snapshot=%L where id=%L','resale',c.id),'23514');
 -- Shop is already hidden from Buyer by current public Listing RLS.
 execute 'set local role authenticated';
 perform pg_temp.bc_assert(not exists(select 1 from public.shops where owner_id=c.seller_id),'Buyer has no Shop read');
 perform pg_temp.bc_assert(not exists(select 1 from public.listings where id=lid),'live Shop Listing absent');
 perform pg_temp.bc_assert(exists(select 1 from public.conversations where id=c.id),'participant still reads conversation');
 msg:=public.marketplace_send_text(c.id,gen_random_uuid(),'Ordinary message after public visibility loss');
 perform pg_temp.bc_assert(exists(select 1 from public.messages where id=msg.id),'ordinary message read/write survives');
 execute 'reset role';
 update public.shops set name='Vintage Loop' where owner_id=c.seller_id;
 end loop;
 delete from public.shops where owner_id=c.seller_id;
 r:=public.marketplace_contact_seller(lid);
 perform pg_temp.bc_assert(r.id=c.id and r.shop_name_snapshot='Vintage Loop','Shop deletion does not block reuse');
 r:=public.marketplace_find_or_create_conversation(lid);
 perform pg_temp.bc_assert(r.id=c.id and r.shop_name_snapshot='Vintage Loop','find/create reuse after Shop deletion');
 -- Shared Offer protocol works when a Shop Listing is hidden only by public RLS.
 terms:=jsonb_build_object('item_amount_cents',7000,'fulfillment','on_campus','meetup_location','Library','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode','external','payment_mode_version',1);
 offer:=public.marketplace_submit_offer(c.id,terms,gen_random_uuid());
 offer:=public.marketplace_submit_offer(c.id,terms,gen_random_uuid(),offer.id,'revise');
 perform pg_temp.bc_actor(c.seller_id);
 offer:=public.marketplace_submit_offer(c.id,terms,gen_random_uuid(),offer.id,'counter');
 perform pg_temp.bc_actor(c.buyer_id);perform public.marketplace_deny_offer(offer.id,gen_random_uuid());
 select * into offer from public.order_requests where conversation_id=c.id and protocol_version=2 and status='active';
 perform public.marketplace_withdraw_offer(offer.id,gen_random_uuid(),null);
 offer:=public.marketplace_submit_offer(c.id,terms,gen_random_uuid());
 update public.listings set published_at=null where id=lid;
 perform pg_temp.bc_reject(format('select public.marketplace_submit_offer(%L,%L,%L,%L,%L)',c.id,terms,gen_random_uuid(),offer.id,'revise'),'23514');
 perform pg_temp.bc_assert(marketplace_private.offer_accept_eligibility(offer)='listing_unavailable','real Listing state still rejects Accept');
 msg:=public.marketplace_send_text(c.id,gen_random_uuid(),'Text still works when unpublished');
end;$$;
set constraints all immediate;
select 'PASS Conversation A-G both creation paths, missing Shop fail closed, rename/deletion reuse, immutable fields, owner-only Shop RLS, hidden Listing participant text read/write' result;

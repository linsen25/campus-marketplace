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
create function pg_temp.prov_accept(terms jsonb,seller_origin boolean default false,channel text default 'resale') returns public.orders
language plpgsql as $$
declare seller uuid;buyer uuid;lid uuid;cid uuid;r public.order_requests;o public.orders;
batch uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();command uuid:=gen_random_uuid();
begin
select p.seller,p.buyer into seller,buyer from bc_people p;
perform pg_temp.bc_actor(seller);
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at,listing_channel)
values(seller,'Dual payment rollback fixture','Synthetic backend qualification',greatest(50000,(terms->>'item_amount_cents')::bigint),'CAD','Electronics','Computers & Tablets','good','Western University',1,clock_timestamp(),channel) returning id into lid;
perform pg_temp.bc_actor(buyer);select id into cid from public.marketplace_find_or_create_conversation(lid);
perform pg_temp.bc_actor(case when seller_origin then seller else buyer end);
select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());
perform pg_temp.bc_actor(r.recipient_user_id);
insert into marketplace_private.order_media_batches(id,offer_id,listing_id,actor_id,buyer_id,seller_id,command_id,material_hash,state,manifest)
values(batch,r.id,lid,r.recipient_user_id,buyer,seller,command,r.listing_material_hash_at_offer,'prepared',jsonb_build_array(jsonb_build_object('id',asset,'path','synthetic','slot',1)));
insert into marketplace_private.order_media_assets(id,batch_id,source_media_id,source_path,position,mime_type,size_bytes,sha256,verified_at)
values(asset,batch,asset,'synthetic',1,'image/png',10,repeat('0',64),clock_timestamp());
insert into storage.objects(bucket_id,name,metadata) values('order-snapshot-media',batch::text||'/'||asset::text,'{"mimetype":"image/png","size":10}');
select * into o from public.marketplace_accept_offer(r.id,command,batch);return o;
end;$$;


do $$declare terms jsonb;o public.orders;r public.orders;cmd uuid;batch uuid;before_terms jsonb;digest bytea;lid uuid;cid uuid;req public.order_requests;key uuid;begin
 terms:=jsonb_build_object('item_amount_cents',10000,'fulfillment','on_campus','meetup_location','Library','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode','external','payment_mode_version',1);
 o:=pg_temp.prov_accept(terms);
 perform pg_temp.bc_assert(o.listing_snapshot->>'listingChannel'='resale' and not(o.listing_snapshot?'shopName'),'A resale explicit channel no shopName');
 perform pg_temp.bc_reject(format('select pg_temp.prov_accept(%L,false,%L)',terms,'shop'),'23514');
 insert into public.shops(owner_id,name,category,description)select seller,'Vintage Loop','Electronics','Rollback Shop' from bc_people;
 o:=pg_temp.prov_accept(terms,false,'shop');
 perform pg_temp.bc_assert(o.listing_snapshot->>'listingChannel'='shop' and o.listing_snapshot->>'shopName'='Vintage Loop','B Shop snapshot');
 before_terms:=o.terms_snapshot;
 select terms_digest into digest from marketplace_private.order_agreements where order_id=o.id;
 perform pg_temp.bc_assert(digest=sha256(convert_to(before_terms::text,'UTF8')),'Agreement digest unchanged');
 select idempotency_key into cmd from marketplace_private.offer_accept_commands where order_id=o.id;
 select id into batch from marketplace_private.order_media_batches where order_id=o.id;
 update public.shops set name='Chris Vintage' where owner_id=o.seller_id;
 select * into r from public.marketplace_accept_offer(o.request_id,cmd,batch);
 perform pg_temp.bc_assert(r.id=o.id and r.listing_snapshot=o.listing_snapshot and r.terms_snapshot=before_terms,'C H rename replay frozen');
 delete from public.shops where owner_id=o.seller_id;
 select * into r from public.marketplace_accept_offer(o.request_id,cmd,batch);
 perform pg_temp.bc_assert(r.listing_snapshot->>'shopName'='Vintage Loop','D deletion replay frozen');
 perform pg_temp.bc_actor(o.buyer_id);perform public.marketplace_confirm_order_agreement(o.id);
 perform pg_temp.bc_actor(o.seller_id);perform public.marketplace_confirm_order_agreement(o.id);
 perform pg_temp.bc_assert(marketplace_private.order_agreement_ready(o.id),'both Agreement confirmations unaffected');
 perform pg_temp.bc_assert((select terms_digest=digest from marketplace_private.order_agreements where order_id=o.id),'digest stable');
 -- Old protocol stays untouched and Resale-only. Each attempt has isolated inventory.
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','provenance_fixture','provenance_payout','Synthetic bank','1234');
 for channel in 0..1 loop
  perform pg_temp.bc_actor((select seller from bc_people));
  insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at,listing_channel)
  select seller,'Provenance V1 rollback','Synthetic',10000,'CAD','Electronics','Computers & Tablets','good','Western University',1,clock_timestamp(),case when channel=0 then 'resale' else 'shop' end from bc_people returning id into lid;
  perform pg_temp.bc_actor((select buyer from bc_people));select id into cid from public.marketplace_find_or_create_conversation(lid);
  perform pg_temp.bc_actor((select seller from bc_people));
  select * into req from public.marketplace_create_order_request(cid,jsonb_build_object('item_amount_cents',10000,'fulfillment_type','pickup','place_name','Library','scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days'),gen_random_uuid());
  perform pg_temp.bc_actor((select buyer from bc_people));key:=gen_random_uuid();
  if channel=0 then
   select * into r from public.marketplace_accept_order_request(req.id,key);
   perform pg_temp.bc_assert(r.order_protocol_version=1 and r.listing_snapshot is null and r.terms_snapshot=to_jsonb(req),'F V1 canonical snapshot retained');
   perform pg_temp.bc_assert((public.marketplace_accept_order_request(req.id,key)).id=r.id,'V1 replay');
  else
   perform pg_temp.bc_reject(format('select public.marketplace_accept_order_request(%L,%L)',req.id,key),'23514');
   perform pg_temp.bc_assert(not exists(select 1 from public.orders where request_id=req.id),'G no V1 Shop Order');
  end if;
 end loop;
end;$$;
set constraints all immediate;
select 'PASS A-H Resale/Shop provenance, missing Shop fail closed, rename/deletion replay, Agreement digest/confirmation, V1 Resale compatibility and Shop rejection' result;

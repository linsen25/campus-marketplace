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
create function pg_temp.bc_accept(terms jsonb,seller_origin boolean default false) returns public.orders
language plpgsql as $$
declare seller uuid;buyer uuid;lid uuid;cid uuid;r public.order_requests;o public.orders;
batch uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();command uuid:=gen_random_uuid();
begin
select p.seller,p.buyer into seller,buyer from bc_people p;
perform pg_temp.bc_actor(seller);
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
select seller,'BC rollback fixture','Synthetic backend qualification',greatest(50000,(terms->>'item_amount_cents')::bigint),currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
from public.listings where published_at is not null limit 1 returning id into lid;
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
do $$declare terms jsonb;area jsonb;o public.orders;r public.order_requests;m jsonb;item bigint;expected bigint;old_terms jsonb;begin
perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','bc_fixture','bc_payout','Test Bank','6789');
area:='{"country_code":"ca","province_code":"on","city_label":" London ","postal_prefix":"n6 a"}';
perform pg_temp.bc_assert(marketplace_private.normalize_delivery_area(area)='{"country_code":"CA","province_code":"ON","city_label":"London","postal_prefix":"N6A"}'::jsonb,'normalize coarse area');
perform pg_temp.bc_reject(format('select marketplace_private.normalize_delivery_area(%L::jsonb)',area||'{"street":"Private"}'),'23514');
perform pg_temp.bc_reject('select marketplace_private.normalize_delivery_area(''{"country_code":"CA","province_code":"ON","city_label":"London","postal_prefix":"D6A"}'')','23514');
terms:=jsonb_build_object('item_amount_cents',10000,'fulfillment','delivery','delivery_method','seller_delivery','delivery_fee_cents',1000,'delivery_area',area);
perform pg_temp.bc_reject(format('select marketplace_private.validate_offer_terms(%L::jsonb)',terms-'delivery_area'),'23514');
o:=pg_temp.bc_accept(terms);
select * into r from public.order_requests where id=o.request_id;
perform pg_temp.bc_assert(r.status='accepted' and r.offer_terms->'delivery_area'->>'postal_prefix'='N6A','normalized immutable accepted Offer');
perform pg_temp.bc_assert(o.terms_snapshot->'terms'->'delivery_area'=r.offer_terms->'delivery_area','Order freezes area');
m:=public.marketplace_order_economics(o.id);
perform pg_temp.bc_assert(m->>'fee'='100' and m->>'total'='11100' and m->>'sellerGross'='11000' and m->>'sellerFee'='0','item-only percentage and separate Seller economics');
perform pg_temp.bc_reject(format('update marketplace_private.v2_order_economics set buyer_service_fee_cents=440 where order_id=%L',o.id),'23514');
perform pg_temp.bc_actor((select outsider from bc_people));
perform pg_temp.bc_reject(format('select public.marketplace_order_economics(%L)',o.id),'42501');
for item,expected in values(1000::bigint,10::bigint),(45000::bigint,450::bigint),(2525::bigint,25::bigint),(10038::bigint,100::bigint),(10037::bigint,100::bigint),(80000::bigint,500::bigint) loop
terms:=jsonb_set(terms,'{item_amount_cents}',to_jsonb(item));o:=pg_temp.bc_accept(terms,true);
m:=public.marketplace_order_economics(o.id);perform pg_temp.bc_assert((m->>'fee')::bigint=expected,'minimum/cap/cent rounding');
end loop;
terms:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Synthetic campus',
'scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours');
o:=pg_temp.bc_accept(terms,true);m:=public.marketplace_order_economics(o.id);
perform pg_temp.bc_assert(m->>'delivery'='0' and m->>'total'='8080','On Campus same frozen fee');
perform public.marketplace_confirm_campus_inspection(o.id,gen_random_uuid());
perform pg_temp.bc_assert(public.marketplace_campus_payment_state(o.id)->>'totalCents'='8080','inspection reads frozen economics');
perform pg_temp.bc_assert(not has_table_privilege('authenticated','marketplace_private.v2_order_economics','SELECT') and
not has_function_privilege('authenticated','marketplace_private.v2_order_money(uuid)','EXECUTE'),'private economics access protected');
end;$$;

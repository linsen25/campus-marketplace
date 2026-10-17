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
values(seller,'Dual payment rollback fixture','Synthetic backend qualification',greatest(50000,(terms->>'item_amount_cents')::bigint),'CAD','Electronics','Computers & Tablets','good','Western University',1,clock_timestamp()) returning id into lid;
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

create function pg_temp.dual_agree(oid uuid) returns void language plpgsql as $$begin
 perform pg_temp.bc_actor((select buyer from bc_people));perform public.marketplace_confirm_order_agreement(oid);
 perform pg_temp.bc_actor((select seller from bc_people));perform public.marketplace_confirm_order_agreement(oid);
end;$$;

do $$declare o public.orders;terms jsonb;mode text;pay jsonb;cred jsonb;reply jsonb;begin
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','prov_flow','prov_payout','Test Bank','6789');
 perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','prov_flow','prov_method','Test Card','1234');
 foreach mode in array array['on_campus','seller_delivery','courier'] loop
 terms:=case when mode='on_campus' then jsonb_build_object('item_amount_cents',8000,'fulfillment',mode,'meetup_location','Library','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours') else jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method',mode,'delivery_fee_cents',1000,'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A')) end;
 o:=pg_temp.bc_accept(terms,true);perform pg_temp.dual_agree(o.id);perform pg_temp.bc_actor(o.buyer_id);
 if mode<>'on_campus' then
 perform public.marketplace_start_delivery_checkout(o.id);
 perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Rollback synthetic street"}');end if;
 pay:=public.marketplace_start_order_payment(o.id,gen_random_uuid());
 perform pg_temp.bc_assert(pay->>'status'='processing','UU Processing');
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 perform public.marketplace_resolve_campus_payment((pay->>'attemptId')::uuid,true);
 perform pg_temp.bc_assert((select payment_status='paid' from public.orders where id=o.id),'UU Paid');
 perform pg_temp.bc_actor(o.buyer_id);
 if mode='courier' then
 reply:=public.marketplace_cancel_order(o.id,'buyer_changed_mind','Rollback',gen_random_uuid());
 perform pg_temp.bc_assert(reply#>>'{order,lifecycle_status}'='cancelled','Courier paid cancel');
 perform pg_temp.bc_assert((select status='available' and reserved_order_id is null from public.listings where id=o.listing_id),'Courier cancel releases inventory');
 else
 perform pg_temp.bc_actor(o.seller_id);
 if mode='seller_delivery' then perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());end if;
 perform pg_temp.bc_actor(o.buyer_id);cred:=public.marketplace_handoff_credential(o.id);perform pg_temp.bc_actor(o.seller_id);
 reply:=public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
 perform pg_temp.bc_assert(reply->>'verified'='true','handoff verification');
 perform pg_temp.bc_assert(exists(select 1 from marketplace_private.order_protection where order_id=o.id),'Protection started');
 perform pg_temp.bc_assert((select holds_listing and payout_status='not_eligible' from public.orders where id=o.id),'Protection preserves hold, no early payout');
 end if;
 end loop;
end;$$;
set constraints all immediate;
select 'PASS UU Meeting/Seller delivery/Courier Agreement, Processing/Paid, delivery checkout, code handoff, Protection, Courier refund/cancellation and inventory' result;

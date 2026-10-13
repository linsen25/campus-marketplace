-- Entire synthetic graph and candidate schema must roll back.
create temporary table nd_people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'nd_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','ND_'||left(replace(id::text,'-',''),12))
from nd_people cross join lateral(values(seller),(buyer),(outsider)) v(id);
create function pg_temp.nd_actor(id uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.nd_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is not true then raise exception 'Notification assertion: %',label;end if;end;$$;
alter table public.listings disable trigger listings_publication_boundary;
do $$
declare seller uuid;buyer uuid;outsider uuid;lid uuid;cid uuid;r public.order_requests;
terms jsonb;notice uuid;event_id uuid;original_notice uuid;n bigint;result jsonb;
begin
 select p.seller,p.buyer,p.outsider into seller,buyer,outsider from nd_people p;
 perform public.marketplace_record_financial_capability(seller,'payout_account','ready','staging_test','nd_fixture','nd_payout','Test Bank','6789');
 perform pg_temp.nd_actor(seller);
 insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select seller,'ND rollback fixture','Synthetic notifications only',10000,currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
 from public.listings where published_at is not null limit 1 returning id into lid;
 perform pg_temp.nd_assert(lid is not null,'fixture template exists');
 perform pg_temp.nd_actor(buyer);
 select id into cid from public.marketplace_find_or_create_conversation(lid);
 terms:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Public campus test location',
 'scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours');
 select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());
 perform pg_temp.nd_assert((select count(*)=1 from public.notifications where recipient_user_id=seller and event_type='incoming_offer' and priority='ACTION_REQUIRED'),'recipient-only initial Offer');
 perform pg_temp.nd_assert(not exists(select 1 from public.notifications where recipient_user_id in(buyer,outsider)),'no actor/outsider notification');
 select domain_event_id into event_id from public.notifications where recipient_user_id=seller;
 perform marketplace_private.deliver_notification(event_id,seller,'ACTION_REQUIRED');
 perform pg_temp.nd_assert((select count(*)=1 from public.notifications where recipient_user_id=seller),'duplicate event idempotency');
 perform pg_temp.nd_actor(seller);
 select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());
 perform pg_temp.nd_assert((select count(*)=1 from public.notifications where recipient_user_id=buyer and event_type='incoming_counter_offer'),'counter recipient');
 perform public.marketplace_withdraw_offer(r.id,gen_random_uuid(),'Synthetic withdrawal');
 perform pg_temp.nd_assert((select count(*)=1 from public.notifications where recipient_user_id=buyer and event_type='offer_withdrawn'),'withdraw other participant');
 perform pg_temp.nd_actor(buyer);
 insert into public.listing_favorites(user_id,listing_id) values(buyer,lid);
 perform pg_temp.nd_actor(seller);
 update public.listings set price_cents=9500 where id=lid;
 select id into original_notice from public.notifications where recipient_user_id=buyer and event_type='price_drop';
 update public.listings set price_cents=9000 where id=lid;
 perform pg_temp.nd_assert((select count(*)=1 from public.notifications where recipient_user_id=buyer and event_type='price_drop'),'unread coalescing');
 perform pg_temp.nd_assert(exists(select 1 from public.notifications where id=original_notice and original_price_cents=10000 and latest_price_cents=9000),'original/latest prices');
 -- An intervening increase cannot make a later strict drop block the Listing write.
 update public.listings set price_cents=12000 where id=lid;
 update public.listings set price_cents=11000 where id=lid;
 perform pg_temp.nd_assert(exists(select 1 from public.notifications where id=original_notice and original_price_cents=10000 and latest_price_cents=11000),'strict drop after increase preserves original');
 perform pg_temp.nd_actor(outsider);
 begin perform public.marketplace_mark_notification_read(original_notice);
 raise exception 'Outsider read unexpectedly succeeded';exception when insufficient_privilege then null;end;
 perform pg_temp.nd_actor(buyer);
 result:=public.marketplace_mark_notification_read(original_notice);
 perform pg_temp.nd_assert(result->>'readAt' is not null,'own mark-read');
 perform public.marketplace_mark_notification_read(original_notice);
 result:=public.marketplace_notifications();
 perform pg_temp.nd_assert(jsonb_array_length(result->'notifications')=3,'own feed without recipient metadata');
 perform pg_temp.nd_actor(seller);
 update public.listings set price_cents=10500 where id=lid;
 perform pg_temp.nd_assert((select count(*)=2 from public.notifications where recipient_user_id=buyer and event_type='price_drop'),'later drop after read creates new');
 perform pg_temp.nd_assert(not exists(select 1 from public.notifications where recipient_user_id=outsider),'outsider remains empty');
 perform pg_temp.nd_assert(not exists(select 1 from public.orders where listing_id=lid),'no Order created');
 perform pg_temp.nd_assert(exists(select 1 from public.listings where id=lid and status='available'),'no reservation');
 perform pg_temp.nd_assert(not has_table_privilege('authenticated','public.notifications','INSERT') and
 not has_table_privilege('authenticated','public.notifications','UPDATE'),'no direct client writes');
 perform pg_temp.nd_assert(not has_function_privilege('authenticated','marketplace_private.deliver_notification(uuid,uuid,text)','EXECUTE'),'private projector inaccessible');
end;$$;

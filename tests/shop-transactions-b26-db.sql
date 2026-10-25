-- B26-A isolated PostgreSQL qualification. The enclosing cluster is disposable.
select public.b14_assert(
 (select enabled=false from marketplace_private.shop_transaction_admission where singleton),
 'Shop transaction admission defaults closed');
select public.b14_assert(
 not has_table_privilege('anon','marketplace_private.shop_transaction_admission','select')
 and not has_table_privilege('authenticated','marketplace_private.shop_transaction_admission','select')
 and not has_table_privilege('service_role','marketplace_private.shop_transaction_admission','select'),
 'admission configuration is not a client or service-role switch');
select public.b14_assert(
 not has_function_privilege('anon','marketplace_private.guard_new_shop_transaction()','execute')
 and not has_function_privilege('authenticated','marketplace_private.guard_new_shop_transaction()','execute')
 and not has_function_privilege('service_role','marketplace_private.guard_new_shop_transaction()','execute'),
 'private trigger function is not directly executable');

create table public.b26_scope(
 label text primary key,listing_id uuid,conversation_id uuid,offer_id uuid,order_id uuid,
 shop_name text,economics jsonb,payment_attempts bigint
);

do $$declare lid uuid;uu_lid uuid;c public.conversations;uu_c public.conversations;
 first_offer public.order_requests;r public.order_requests;uu_offer public.order_requests;o public.orders;
 offer_command uuid:=gen_random_uuid();command uuid:=gen_random_uuid();batch uuid;original_name text;economics jsonb;attempts bigint;begin
 select id into lid from public.listings where seller_id=public.b14_owner(81)
  and listing_channel='shop' and published_at is not null and status='available' order by id limit 1;
 select name into original_name from public.shops where owner_id=public.b14_owner(81);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.b14_reject(format('select public.marketplace_contact_seller(%L)',lid),'42501');
 perform public.b14_reject(format('select public.marketplace_find_or_create_conversation(%L)',lid),'42501');

 -- There is deliberately no public activation RPC. This is the controlled local
 -- activation used solely by this disposable PostgreSQL qualification.
 update marketplace_private.shop_transaction_admission
  set enabled=true,updated_at=clock_timestamp() where singleton;
 c:=public.marketplace_contact_seller(lid);
 perform public.b14_assert((public.marketplace_contact_seller(lid)).id=c.id,
  'same Buyer and Listing reuses the first Conversation');
 perform public.b14_assert(c.listing_channel_snapshot='shop' and c.shop_name_snapshot=original_name,
  'Conversation freezes trusted Shop provenance');
 first_offer:=public.marketplace_submit_offer(c.id,public.b07_terms(800,'external'),offer_command);
 perform public.b14_assert((public.marketplace_submit_offer(c.id,public.b07_terms(800,'external'),offer_command)).id=first_offer.id,
  'Offer retry returns the same shared Offer');
 r:=public.marketplace_submit_offer(c.id,public.b07_terms(850,'external'),gen_random_uuid(),first_offer.id,'revise');
 perform public.b14_assert((select status='superseded' and replacement_request_id=r.id
  from public.order_requests where id=first_offer.id),'Shop Offer revision uses the shared immutable history');
 perform public.b14_assert(r.listing_id=lid and r.seller_origin_id=public.b14_owner(81),
  'Offer inherits Listing and Seller identity');

 perform public.b07_actor(public.b14_owner(81));
 batch:=public.b07_prepare(r.id,auth.uid(),command);
 select count(*) into attempts from marketplace_private.campus_payment_attempts;
 o:=public.marketplace_accept_offer(r.id,command,batch);
 select to_jsonb(e) into economics from marketplace_private.v2_order_economics e where e.order_id=o.id;
 perform public.b14_assert(o.listing_snapshot->>'listingChannel'='shop'
  and o.listing_snapshot->>'shopName'=original_name and o.payment_status<>'paid',
  'Order freezes Shop source without claiming payment');
 perform public.b14_assert((select status='pending' and reserved_order_id=o.id from public.listings where id=lid),
  'shared inventory authority holds the Shop Listing once');
 perform public.b14_assert((select count(*) from public.orders where request_id=r.id)=1,
  'Offer acceptance creates one shared Order');
 perform public.b14_assert((public.marketplace_accept_offer(r.id,command,batch)).id=o.id,
  'Accept replay returns the same shared Order');
 perform public.b14_assert((select count(*) from marketplace_private.campus_payment_attempts)=attempts,
  'external Shop Order creates no Stripe attempt');
 insert into public.b26_scope values('external',lid,c.id,r.id,o.id,original_name,economics,attempts);

 -- uu_pay remains inside the existing seller payout/payment boundaries. Admission
 -- does not create a PaymentAttempt or turn local simulation into provider proof.
 select id into uu_lid from public.listings where seller_id=public.b14_owner(82)
  and listing_channel='shop' and published_at is not null and status='available' order by id limit 1;
 perform public.b07_actor('33333333-3333-4333-8333-333333333333');
 uu_c:=public.marketplace_find_or_create_conversation(uu_lid);
 uu_offer:=public.marketplace_submit_offer(uu_c.id,public.b07_terms(900,'uu_pay'),gen_random_uuid());
 select count(*) into attempts from marketplace_private.campus_payment_attempts;
 perform public.b07_actor(public.b14_owner(82));
 perform public.b14_reject(format('select public.marketplace_offer_accept_preflight(%L,%L)',
  uu_offer.id,gen_random_uuid()),'P0001');
 perform public.b14_assert(not exists(select 1 from public.orders where request_id=uu_offer.id)
  and (select count(*) from marketplace_private.campus_payment_attempts)=attempts,
  'uu_pay Shop Offer cannot bypass payout readiness or create payment evidence');

 update marketplace_private.shop_transaction_admission
  set enabled=false,updated_at=clock_timestamp() where singleton;
 update public.shops set name='B26 renamed Shop' where owner_id=public.b14_owner(81);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.b14_assert((public.marketplace_find_or_create_conversation(lid)).id=c.id,
  'existing Conversation remains usable after admission closes');
 perform public.b14_assert((select listing_snapshot->>'shopName'=original_name from public.orders where id=o.id),
  'Shop rename does not rewrite Order history');

 -- Existing legal Order lifecycle remains available while new inserts stay closed.
 perform public.b07_actor(public.b14_owner(81));
 perform public.marketplace_confirm_order_agreement(o.id);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.marketplace_confirm_order_agreement(o.id);
 perform public.marketplace_confirm_external_exchange(o.id,gen_random_uuid());
 perform public.b07_actor(public.b14_owner(81));
 perform public.marketplace_confirm_external_exchange(o.id,gen_random_uuid());
 perform public.b14_assert((select status='sold' from public.listings where id=lid),
  'external Shop Order completes through shared fulfillment without Stripe');
 perform public.b14_assert((select to_jsonb(e)=economics from marketplace_private.v2_order_economics e where e.order_id=o.id),
  'frozen Order economics remain unchanged');
end;$$;

-- A pre-B14 published Shop fixture has no operating membership. Even under the
-- controlled activation it cannot start a new transaction.
update marketplace_private.shop_transaction_admission
 set enabled=true,updated_at=clock_timestamp() where singleton;
select public.b07_actor('33333333-3333-4333-8333-333333333333');
select public.b14_reject(format('select public.marketplace_find_or_create_conversation(%L)',
 (select id from public.listings where seller_id='11111111-1111-4111-8111-111111111111'
  and listing_channel='shop' and published_at is not null and status='available' limit 1)),'42501');

-- Resale remains independent when Shop admission is disabled.
update marketplace_private.shop_transaction_admission
 set enabled=false,updated_at=clock_timestamp() where singleton;
do $$declare lid uuid;c public.conversations;begin
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 insert into public.listings(seller_id,listing_channel,title,description,price_cents,currency,
  category,subcategory,pickup_area,expected_image_count,meeting_location,preferred_payment_mode)
 values(auth.uid(),'resale','B26 Resale control','Independent control',1000,'CAD',
  'Electronics','Cameras','Campus',1,'Campus','external') returning id into lid;
 insert into public.listing_images(listing_id,slot) values(lid,1);
 insert into storage.objects(bucket_id,name,metadata)
  select storage_bucket,path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where listing_id=lid;
 update public.listing_images set ready=true where listing_id=lid;
 perform public.marketplace_finalize_listing(lid);
 perform public.b07_actor('33333333-3333-4333-8333-333333333333');
 c:=public.marketplace_contact_seller(lid);
 perform public.b14_assert(c.id is not null and c.listing_channel_snapshot='resale',
  'Resale Conversation is unaffected by Shop admission');
end;$$;

-- Direct table calls still cross the retained B14 trigger and cannot forge actors.
set role authenticated;
select public.b07_actor('33333333-3333-4333-8333-333333333333');
select public.b14_reject($q$insert into public.conversations(
 listing_origin_id,listing_id,buyer_id,seller_id,listing_title_snapshot,
 listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot)
 select id,id,auth.uid(),seller_id,title,price_cents,currency,category from public.listings
 where seller_id=public.b14_owner(82) and listing_channel='shop' and published_at is not null
 and status='available' limit 1$q$,'42501');
reset role;

select public.b14_assert(
 (select count(*)=3 from pg_trigger where not tgisinternal and tgenabled<>'D'
  and tgname in('b14_new_shop_conversation_guard','b14_new_shop_offer_guard','b14_new_shop_order_guard')),
 'all three B14 Shop transaction guards remain enabled');
select public.b14_assert(
 not exists(select 1 from public.orders o join public.listings l on l.id=o.listing_id
  where l.listing_channel='resale' and o.listing_snapshot->>'listingChannel'='shop'),
 'Resale Orders are never relabeled as Shop');

drop table public.b26_scope;

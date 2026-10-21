-- Native local test data only. No scheduler/payment/fulfillment commands are run.
create function public.b07_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'B07 assertion: %',label;end if;end;$$;
create function public.b07_reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;exception when others then
  if sqlstate=expected then return;end if;raise;
 end;raise exception 'B07 expected SQLSTATE %: %',expected,statement;
end;$$;

create function public.b07_actor(actor uuid) returns void language sql as $$
 select set_config('request.jwt.claim.sub',coalesce(actor::text,''),false);$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('11111111-1111-4111-8111-111111111111','b07-seller@uwo.ca',now(),'{"username":"B07_Seller"}'),
('22222222-2222-4222-8222-222222222222','b07-buyer@uwo.ca',now(),'{"username":"B07_Buyer"}'),
('33333333-3333-4333-8333-333333333333','b07-otherbuyer@uwo.ca',now(),'{"username":"B07_OtherBuyer"}'),
('44444444-4444-4444-8444-444444444444','b07-outsider@uwo.ca',now(),'{"username":"B07_Outsider"}'),
('55555555-5555-4555-8555-555555555555','b07-unverified@uwo.ca',null,'{"username":"B07_Unverified"}');
insert into public.notification_preferences(user_id,email_notifications) select id,false from public.profiles;
create table public.b07_scope(label text primary key,listing uuid,conversation uuid,offer uuid,batch uuid,command uuid,actor uuid);
grant select on public.b07_scope to anon,authenticated;
create function public.b07_fixture(label text) returns uuid language plpgsql as $$
declare lid uuid;cid uuid;begin
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 insert into public.listings(seller_id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count,meeting_location,preferred_payment_mode)
 values(auth.uid(),'B07 '||label,'Local qualification',10000,'Electronics','Cameras','Campus',2,'B07 test location','external') returning id into lid;
 insert into public.listing_images(listing_id,slot) values(lid,1),(lid,2);
 insert into storage.objects(bucket_id,name,metadata)
 select storage_bucket,path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where listing_id=lid;
 update public.listing_images set ready=true where listing_id=lid;
 perform public.marketplace_finalize_listing(lid);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 cid:=(public.marketplace_find_or_create_conversation(lid)).id;
 insert into public.b07_scope(label,listing,conversation,actor) values(label,lid,cid,auth.uid());
 return cid;
end;$$;
create function public.b07_terms(amount integer default 8000,mode text default 'external') returns jsonb language sql as $$
 select jsonb_build_object('item_amount_cents',amount,'fulfillment','on_campus','meetup_location','B07 test location',
 'scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode',mode,'payment_mode_version',1);
$$;
-- Only the local object-metadata stand-in is populated; byte SHA verification is
-- independently exercised by the real application service tests.
create function public.b07_prepare(offer uuid,actor uuid,command uuid) returns uuid language plpgsql as $$
declare manifest jsonb;a record;begin
 manifest:=public.marketplace_prepare_order_media(offer,actor,command);
 for a in select * from marketplace_private.order_media_assets where batch_id=(manifest->>'id')::uuid loop
  insert into storage.objects(bucket_id,name,metadata) values(a.bucket,a.path,'{"mimetype":"image/jpeg","size":100}') on conflict do nothing;
  perform public.marketplace_verify_order_media(a.id,'image/jpeg',100,repeat('a',64));
 end loop;
 return (manifest->>'id')::uuid;
end;$$;

do $$<<b07>> declare cid uuid;other_cid uuid;t jsonb;bad jsonb;a public.order_requests;b public.order_requests;r public.order_requests;
 cmd uuid;h jsonb;batch uuid;oid uuid;copyhash text;lid uuid;state jsonb;begin
 cid:=public.b07_fixture('negotiation');t:=public.b07_terms();cmd:=gen_random_uuid();
 select * into a from public.marketplace_submit_offer(cid,t,cmd);
 perform public.b07_assert(a.sender_user_id=auth.uid() and a.recipient_user_id='11111111-1111-4111-8111-111111111111','Buyer sender, Seller recipient');
 perform public.b07_assert((public.marketplace_submit_offer(cid,t,cmd)).id=a.id,'create replay identity');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',cid,public.b07_terms(7000),cmd),'23505');
 perform public.b07_assert((select status='available' and reserved_order_id is null from public.listings where id=a.listing_id),'Offer never holds inventory');
 perform public.b07_reject(format('select public.marketplace_offer_accept_preflight(%L,%L)',a.id,gen_random_uuid()),'42501');
 perform public.b07_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',a.id,gen_random_uuid(),gen_random_uuid()),'42501');
 perform public.b07_reject(format('select public.marketplace_deny_offer(%L,%L)',a.id,gen_random_uuid()),'42501');
 -- Counter and Revise affect only the submitting party's previous active proposal.
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 select * into b from public.marketplace_submit_offer(cid,public.b07_terms(9000),gen_random_uuid(),a.id,'counter');
 perform public.b07_assert((select status='active' from public.order_requests where id=a.id),'counter preserves opponent');
 perform public.b07_assert((select count(*)=1 from public.notifications where event_type='incoming_counter_offer' and recipient_user_id='22222222-2222-4222-8222-222222222222' and destination->>'offerId'=b.id::text),'counter notification recipient/classification');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L,%L,%L)',cid,t,gen_random_uuid(),a.id,'revise'),'23505');
 select * into r from public.marketplace_submit_offer(cid,public.b07_terms(8500),gen_random_uuid(),b.id,'revise');
 perform public.b07_assert((select status='superseded' and replacement_request_id=r.id from public.order_requests where id=b.id),'revision links immutable old record');
 perform public.b07_assert((select comparison_terms=b.offer_terms from marketplace_private.offer_commands where offer_id=r.id),'comparison freezes baseline');
 perform public.b07_assert(marketplace_private.offer_changed_fields(r.offer_terms,b.offer_terms)?'Price','changed fields authoritative');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L,%L,%L)',cid,t,gen_random_uuid(),b.id,'revise'),'23505');
 other_cid:=public.b07_fixture('wrong-comparison');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L,%L,%L)',other_cid,t,gen_random_uuid(),r.id,'counter'),'23505');
 -- Recipient only Deny, sender only Withdraw; repeats never emit another event.
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');cmd:=gen_random_uuid();
 perform public.marketplace_deny_offer(r.id,cmd);perform public.marketplace_deny_offer(r.id,cmd);
 perform public.b07_assert((select count(*)=1 from public.transaction_events where request_id=r.id and event_type='offer_declined'),'deny event once');
 perform public.b07_assert((select count(*)=1 from public.notifications where event_type='offer_declined' and destination->>'offerId'=r.id::text),'deny notice once');
 cmd:=gen_random_uuid();perform public.marketplace_withdraw_offer(a.id,cmd);perform public.marketplace_withdraw_offer(a.id,cmd);
 perform public.b07_assert((select count(*)=1 from public.transaction_events where request_id=a.id and event_type='offer_withdrawn'),'withdraw event once');
 perform public.b07_reject(format('select public.marketplace_withdraw_offer(%L,%L)',r.id,gen_random_uuid()),'42501');
 -- Actor and numeric/time/payment-mode boundaries from CURRENT validator.
 perform public.b07_actor('44444444-4444-4444-8444-444444444444');
 perform public.b07_reject(format('select public.marketplace_offer_history(%L)',cid),'42501');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',cid,t,gen_random_uuid()),'42501');
 perform public.b07_actor('55555555-5555-4555-8555-555555555555');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',cid,t,gen_random_uuid()),'42501');
 perform public.b07_actor(null);perform public.b07_reject(format('select public.marketplace_offer_history(%L)',cid),'42501');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(t,'{item_amount_cents}','0'),jsonb_set(t,'{item_amount_cents}','-1'),jsonb_set(t,'{item_amount_cents}','1.5'),
  jsonb_set(t,'{item_amount_cents}','9007199254740992'),jsonb_set(t,'{item_amount_cents}','"8000"'),
  t||'{"buyer_id":"forged"}',jsonb_set(t,'{payment_mode}','"fake"'),jsonb_set(t,'{payment_mode_version}','2'),
  jsonb_set(t,'{scheduled_at}',to_jsonb(date_trunc('hour',clock_timestamp())+interval '15 minutes')),
  jsonb_set(t,'{scheduled_at}',to_jsonb(date_trunc('hour',clock_timestamp())+interval '31 days')),
  jsonb_set(t,'{scheduled_at}',to_jsonb(date_trunc('hour',clock_timestamp())+interval '3 hours 1 minute'))
 )) loop
  perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',other_cid,bad,gen_random_uuid()),'23514');
 end loop;
 bad:=jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method','courier','delivery_fee_cents',100,
 'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A'),
 'payment_mode','external','payment_mode_version',1);
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',other_cid,bad,gen_random_uuid()),'23514');
 -- Seller readiness is required only for uu_pay. Buyer needs no payment method here.
 select * into a from public.marketplace_submit_offer(other_cid,public.b07_terms(8000,'uu_pay'),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_reject(format('select public.marketplace_offer_accept_preflight(%L,%L)',a.id,gen_random_uuid()),'P0001');
 perform public.b07_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,%L)',other_cid,public.b07_terms(9000,'uu_pay'),gen_random_uuid()),'P0001');
 -- Missing/incomplete media fails atomically: no Order, no command, inventory unchanged.
 cid:=public.b07_fixture('media-atomicity');select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');cmd:=gen_random_uuid();
 perform public.b07_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',a.id,cmd,gen_random_uuid()),'42501');
 state:=public.marketplace_prepare_order_media(a.id,auth.uid(),cmd);batch:=(state->>'id')::uuid;
 perform public.b07_assert((select bool_and(source_bucket='listing-images-private') from marketplace_private.order_media_assets where batch_id=batch),'new private source frozen');
 perform public.b07_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',a.id,cmd,batch),'23514');
 perform public.b07_assert(not exists(select 1 from public.orders where request_id=a.id),'no incomplete Order');
 perform public.b07_assert(not exists(select 1 from marketplace_private.offer_accept_commands where idempotency_key=cmd),'failed accept command rolled back');
 perform public.b07_assert((select status='available' from public.listings where id=a.listing_id),'failed accept does not hold inventory');
 batch:=public.b07_prepare(a.id,auth.uid(),cmd);
 perform public.b07_assert((public.marketplace_prepare_order_media(a.id,auth.uid(),cmd)->>'id')::uuid=batch,'prepare retry same batch');
 select id into oid from public.marketplace_accept_offer(a.id,cmd,batch);
 perform public.b07_assert((public.marketplace_accept_offer(a.id,cmd,batch)).id=oid,'accept replay same Order');
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,cmd)->>'orderId'=oid::text,'preflight replay before media/payout work');
 perform public.b07_assert((select count(*)=2 from marketplace_private.order_snapshot_media where order_id=oid),'all media bound atomically');
 perform public.b07_assert((select listing_snapshot->>'listingChannel'='resale' and terms_snapshot->'terms'=t and payment_status<>'paid' from public.orders where id=oid),'frozen terms/channel and no payment');
 perform public.b07_assert(public.marketplace_claim_order_media_cleanup(batch) is null,'bound batch cannot be cleaned');
 update public.b07_scope set offer=a.id,batch=b07.batch,command=cmd where label='media-atomicity';
 -- Material changes and asking-price drops cannot be accepted; unrelated Listing untouched.
 cid:=public.b07_fixture('stale-material');select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 update public.listings set description='Changed material' where id=a.listing_id;
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,gen_random_uuid())->>'errorCode'='listing_changed','stale material blocked');
 cid:=public.b07_fixture('price-drop');select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 update public.listings set price_cents=7000 where id=a.listing_id;
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,gen_random_uuid())->>'errorCode'='asking_price_lower','asking price lower blocked');
 perform public.b07_assert((select count(*)=1 from public.orders),'no extra Order from stale offers');
end;$$;

-- Use real SQL roles for table/function/row-level boundaries.
set role authenticated;select public.b07_actor('44444444-4444-4444-8444-444444444444');
select public.b07_assert((select count(*)=0 from public.order_requests),'outsider RLS');
select public.b07_assert((select count(*)=0 from public.orders),'outsider Order RLS');
select public.b07_reject('update public.order_requests set status=''accepted''','42501');
select public.b07_reject('select * from marketplace_private.offer_commands','42501');
select public.b07_reject('select public.marketplace_prepare_order_media(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())','42501');
reset role;
select public.b07_assert(not has_function_privilege('anon','public.marketplace_submit_offer(uuid,jsonb,uuid,uuid,text)','execute'),'anon cannot submit');
select public.b07_assert(not has_table_privilege('authenticated','marketplace_private.order_media_assets','select'),'private media paths not readable');

-- Local time-boundary fixtures: only this isolated cluster advances test rows.
-- The live immutable triggers/functions are restored before any command is tested.
do $$declare cid uuid;a public.order_requests;t jsonb;h jsonb;batch uuid;lease jsonb;begin
 cid:=public.b07_fixture('expiry');t:=public.b07_terms();
 select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 set constraints all immediate;
 alter table public.order_requests disable trigger order_request_immutable;
 update public.order_requests set offer_terms=jsonb_set(offer_terms,'{scheduled_at}',to_jsonb(date_trunc('hour',clock_timestamp())-interval '1 hour')) where id=a.id;
 alter table public.order_requests enable trigger order_request_immutable;
 set constraints all deferred;
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 h:=public.marketplace_offer_history(cid);h:=public.marketplace_offer_history(cid);
 perform public.b07_assert((select status='expired' from public.order_requests where id=a.id),'Meeting scheduled-time expiry');
 perform public.b07_assert((select count(*)=1 from public.transaction_events where request_id=a.id and event_type='offer_expired'),'expiry event once');
 perform public.b07_assert((select status='available' and reserved_order_id is null from public.listings where id=a.listing_id),'Offer expiry never releases another hold');
 cid:=public.b07_fixture('withdraw-boundary');select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 set constraints all immediate;
 alter table public.order_requests disable trigger order_request_immutable;
 update public.order_requests set created_at=clock_timestamp()-interval '5 minutes' where id=a.id;
 alter table public.order_requests enable trigger order_request_immutable;
 set constraints all deferred;
 perform public.b07_reject(format('select public.marketplace_withdraw_offer(%L,%L)',a.id,gen_random_uuid()),'23505');
 -- Delivery does not acquire an invented timer or an external-payment escape.
 t:=jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method','seller_delivery','delivery_fee_cents',100,
 'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A'),
 'payment_mode','uu_pay','payment_mode_version',1);
 cid:=public.b07_fixture('delivery-no-ttl');select * into a from public.marketplace_submit_offer(cid,t,gen_random_uuid());
 set constraints all immediate;
 alter table public.order_requests disable trigger order_request_immutable;
 update public.order_requests set created_at=clock_timestamp()-interval '40 days' where id=a.id;
 alter table public.order_requests enable trigger order_request_immutable;
 set constraints all deferred;
 h:=public.marketplace_offer_history(cid);
 perform public.b07_assert((select status='active' from public.order_requests where id=a.id),'Delivery no arbitrary Offer TTL');
 -- Expired unbound partial media: deletion failure cannot produce a false receipt.
 cid:=public.b07_fixture('cleanup');select * into a from public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 batch:=(public.marketplace_prepare_order_media(a.id,auth.uid(),gen_random_uuid())->>'id')::uuid;
 insert into storage.objects(bucket_id,name,metadata) select bucket,path,'{"mimetype":"image/jpeg","size":100}' from marketplace_private.order_media_assets where batch_id=batch limit 1;
 update marketplace_private.order_media_batches set expires_at=clock_timestamp()-interval '1 second' where id=batch;
 lease:=public.marketplace_claim_order_media_cleanup(batch);
 perform public.b07_assert(lease is not null,'expired unbound batch claim');
 perform public.b07_reject(format('select public.marketplace_finish_order_media_cleanup(%L,%L)',batch,lease->>'lease'),'23514');
 delete from storage.objects where bucket_id='order-snapshot-media' and name in(select path from marketplace_private.order_media_assets where batch_id=batch);
 perform public.marketplace_finish_order_media_cleanup(batch,(lease->>'lease')::uuid);
 perform public.b07_assert((select state='deleted' from marketplace_private.order_media_batches where id=batch),'cleanup verified complete');
 perform public.b07_assert((select count(*)=2 from marketplace_private.order_media_assets where batch_id=batch),'cleanup keeps tracked path tombstones');
 perform public.b07_assert((select count(*)=2 from marketplace_private.order_snapshot_media where order_id=(select order_id from marketplace_private.order_media_batches where id=(select s.batch from public.b07_scope s where label='media-atomicity'))),'cleanup leaves bound media intact');
end;$$;

-- Recipient symmetry and the real Seller readiness predicate, with local-only
-- provider-independent capability rows. No Stripe/provider request is executed.
do $$declare cid uuid;a public.order_requests;batch uuid;cmd uuid;oid uuid;r public.orders;begin
 cid:=public.b07_fixture('seller-origin');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 a:=public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');cmd:=gen_random_uuid();
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,cmd)->>'ready'='true','Buyer recipient accepts Seller proposal');
 batch:=public.b07_prepare(a.id,auth.uid(),cmd);r:=public.marketplace_accept_offer(a.id,cmd,batch);
 perform public.b07_assert(r.buyer_id=auth.uid() and r.seller_id=a.sender_user_id,'correct identities with Seller sender');
 -- Normal uu_pay acceptance requires Seller Ready, but not Buyer payment setup.
 perform public.marketplace_record_financial_capability('11111111-1111-4111-8111-111111111111','payout_account','ready','b07_local','local-owner','local-instrument','B07 fixture',null);
 cid:=public.b07_fixture('uu-pay-ready');
 a:=public.marketplace_submit_offer(cid,public.b07_terms(8000,'uu_pay'),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');cmd:=gen_random_uuid();
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,cmd)->>'ready'='true','Ready Seller permits uu_pay Offer accept');
 batch:=public.b07_prepare(a.id,auth.uid(),cmd);r:=public.marketplace_accept_offer(a.id,cmd,batch);oid:=r.id;
 perform public.b07_assert(r.payment_status='pending' and r.payout_status='not_eligible','Accept does not pay or pay out');
 perform public.b07_assert((select count(*)=0 from marketplace_private.financial_capabilities where capability='payment_method'),'Buyer payment setup deferred to payment task');
 perform public.b07_assert((select buyer_service_fee_cents=80 and fee_rule='item_only_1pct_max500_v2' from marketplace_private.v2_order_economics where order_id=oid),'existing frozen fee authority reused');
 perform public.marketplace_record_financial_capability('11111111-1111-4111-8111-111111111111','payout_account','unset',null,null,null,null,null);
 perform public.b07_assert(public.marketplace_offer_accept_preflight(a.id,cmd)->>'orderId'=oid::text,'completed command replays despite later readiness change');
 perform public.b07_assert((public.marketplace_accept_offer(a.id,cmd,batch)).id=oid,'Accept replay bypasses new readiness check');
 perform public.b07_reject(format('select public.marketplace_offer_accept_preflight(%L,%L)',
 (select id from public.order_requests where conversation_id=(select conversation from public.b07_scope where label='stale-material')),cmd),'23505');
 perform public.b07_reject(format('update public.order_requests set offer_terms=%L::jsonb where id=%L',public.b07_terms(7000),a.id),'23514');
 perform public.b07_reject(format('update public.orders set terms_snapshot=''{}''::jsonb where id=%L',oid),'42501');
 perform public.b07_reject(format('update public.orders set listing_snapshot=''{}''::jsonb where id=%L',oid),'42501');
 perform public.b07_assert((select count(*)=2 from marketplace_private.order_snapshot_media where order_id=oid),'replay preserves frozen bound media');
end;$$;

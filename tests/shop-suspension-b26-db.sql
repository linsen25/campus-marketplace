-- B26-B isolated PostgreSQL qualification. The enclosing cluster is disposable.
select public.b14_assert(
 not has_table_privilege('anon','marketplace_private.shop_suspension_cycles','select')
 and not has_table_privilege('authenticated','marketplace_private.shop_suspension_cycles','select')
 and not has_table_privilege('service_role','marketplace_private.shop_suspension_cycles','select')
 and not has_function_privilege('anon','public.marketplace_shop_membership_lifecycle(text,integer)','execute')
 and not has_function_privilege('authenticated','public.marketplace_shop_membership_lifecycle(text,integer)','execute')
 and has_function_privilege('service_role','public.marketplace_shop_membership_lifecycle(text,integer)','execute'),
 'B26-B lifecycle storage is private and its RPC is service-role-only');

select public.b14_assert(
 marketplace_private.shop_entitlements(public.b14_owner(82),
  (select starts_at+interval '1 second' from marketplace_private.shop_membership_terms where owner_id=public.b14_owner(82) order by starts_at limit 1))->>'status'='active'
 and marketplace_private.shop_entitlements(public.b14_owner(83),
  (select starts_at+interval '1 second' from marketplace_private.shop_membership_terms where owner_id=public.b14_owner(83) order by starts_at limit 1))->>'status'='trial'
 and marketplace_private.shop_entitlements(public.b14_owner(87),
  (select ends_at+interval '1 second' from marketplace_private.shop_membership_terms where owner_id=public.b14_owner(87) order by ends_at desc limit 1))->>'status'='grace',
 'Active, Trial and Grace remain operating states');
select public.b14_assert(
 marketplace_private.shop_entitlements(public.b14_owner(87),
  (select ends_at+interval '432000 seconds'-interval '1 microsecond' from marketplace_private.shop_membership_terms where owner_id=public.b14_owner(87) order by ends_at desc limit 1))->>'status'='grace'
 and marketplace_private.shop_entitlements(public.b14_owner(87),
  (select ends_at+interval '432000 seconds' from marketplace_private.shop_membership_terms where owner_id=public.b14_owner(87) order by ends_at desc limit 1))->>'status'='suspended',
 'Grace lasts the full 120 hours and Suspended begins at the exact boundary');

create table public.b26b_scope(
 label text primary key,conversation_id uuid,offer_id uuid,cycle_id uuid,buyer_message uuid
);

update marketplace_private.shop_transaction_admission set enabled=true,updated_at=clock_timestamp() where singleton;
-- Owner 90 is reserved for B26 lifecycle qualification and has no earlier term,
-- so its single disposable cycle can cross the 120-hour boundary without
-- rewriting or overlapping historical B12 membership periods.
insert into public.shops(owner_id,name,category,description)
 values(public.b14_owner(90),'B26 lifecycle Shop','Electronics','Suspension lifecycle');
select public.b14_buy(90,'pro',clock_timestamp()-interval '1 month');
do $$declare lid uuid;c public.conversations;r public.order_requests;m public.messages;manifest jsonb;item jsonb;
 submission public.image_message_submissions;object_id uuid;term_start timestamptz;term_id uuid;
 buyer uuid:='44444444-4444-4444-8444-444444444444';begin
 perform public.b07_actor(public.b14_owner(90));lid:=public.marketplace_finalize_listing(public.b14_draft(90));
 perform public.b07_actor(buyer);c:=public.marketplace_contact_seller(lid);
 r:=public.marketplace_submit_offer(c.id,public.b07_terms(700,'external'),gen_random_uuid());
 perform public.marketplace_send_text(c.id,gen_random_uuid(),'Grace Buyer message');
 perform public.b07_actor(public.b14_owner(90));
 perform public.marketplace_send_text(c.id,gen_random_uuid(),'Grace Seller message');
 submission:=public.marketplace_prepare_image_message(c.id,gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('original_name','grace.png','mime_type','image/png','size_bytes',100,'sha256',repeat('a',64))));
 perform public.b14_assert(submission.id is not null,
  'Grace Seller can prepare an IMAGE message');

 -- Move this disposable fixture across the already-tested 120-hour boundary.
 select starts_at,id into term_start,term_id from marketplace_private.shop_membership_terms
  where owner_id=public.b14_owner(90) order by ends_at desc limit 1;
 update marketplace_private.shop_membership_terms set ends_at=greatest(term_start+interval '1 second',clock_timestamp()-interval '432001 seconds')
  where id=term_id;
 perform public.b14_assert(marketplace_private.shop_entitlements(public.b14_owner(90),clock_timestamp())->>'status'='suspended',
  'fixture is authoritatively Suspended');
 perform public.b14_reject(format('select public.marketplace_send_text(%L,%L,%L)',c.id,gen_random_uuid(),'blocked Seller'),'42501');
 perform public.b14_reject(format('select public.marketplace_prepare_image_message(%L,%L,%L)',c.id,gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('original_name','blocked.png','mime_type','image/png','size_bytes',100,'sha256',repeat('b',64)))),'42501');
 -- A reservation made before expiry cannot advance its verified-byte receipt
 -- after suspension; finalize is separately fenced by message insertion.
 item:=submission.manifest->0;
 insert into storage.objects(bucket_id,name,metadata) values('chat-images',item->>'storage_path',
  jsonb_build_object('mimetype',item->>'mime_type','size',item->>'size_bytes')) returning id into object_id;
 perform set_config('request.jwt.claim.role','service_role',false);
 perform public.b14_reject(format('select public.marketplace_record_verified_chat_image(%L,%L,%L,%L,%L)',
  submission.id,(item->>'id')::uuid,submission.sender_id,object_id,item->>'sha256'),'42501');
 perform set_config('request.jwt.claim.role','',false);
 perform public.b07_actor(buyer);
 m:=public.marketplace_send_text(c.id,gen_random_uuid(),'Suspended Buyer TEXT is preserved');
 perform public.b14_assert((select count(*)=1 from public.messages where conversation_id=c.id and origin='marketplace_auto_reply'
  and content='This shop is temporarily suspended. Your message has been saved. The seller can reply once the shop reopens.'),
  'first suspended Buyer message is saved with one UU System notice');
 select x.manifest into manifest from public.marketplace_prepare_image_message(c.id,gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('original_name','buyer.png','mime_type','image/png','size_bytes',100,'sha256',repeat('c',64)))) x;
 perform public.b14_assert(jsonb_array_length(manifest)=1,'Suspended Buyer can prepare IMAGE bytes');
 insert into public.b26b_scope(label,conversation_id,offer_id,buyer_message) values('consultation',c.id,r.id,m.id);
end;$$;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select public.b14_reject('select public.marketplace_shop_membership_lifecycle(''process_due'',20)','42501');
reset role;
select set_config('request.jwt.claim.role','service_role',false);
select public.marketplace_shop_membership_lifecycle('process_due',50);
select set_config('request.jwt.claim.role','',false);

update public.b26b_scope s set cycle_id=x.id from marketplace_private.shop_suspension_cycles x
 where s.label='consultation' and x.owner_id=public.b14_owner(90) and x.state='open';
select public.b14_assert(
 (select status='closed' and closed_at is not null from public.order_requests where id=(select offer_id from public.b26b_scope where label='consultation'))
 and exists(select 1 from marketplace_private.shop_suspension_offer_closures x where x.offer_id=(select offer_id from public.b26b_scope where label='consultation'))
 and exists(select 1 from public.transaction_events e where e.request_id=(select offer_id from public.b26b_scope where label='consultation')
  and e.event_type='offer_closed' and e.actor_role='system' and e.metadata->>'reason'='shop_membership_suspended'),
 'Suspension closes the unfinished Offer with retained system audit evidence');

-- Initial transition and repeated worker scans are idempotent. The rolling window
-- permits one later reminder, while identical trigger retries remain deduplicated.
select set_config('request.jwt.claim.role','service_role',false);
select public.marketplace_shop_membership_lifecycle('process_due',50);
select set_config('request.jwt.claim.role','',false);
select public.b14_assert((select count(*)=1 from marketplace_private.shop_suspension_message_events
 where suspension_cycle_id=(select cycle_id from public.b26b_scope where label='consultation') and kind='suspended'),
 'repeated lifecycle work does not duplicate the Suspension notice');
select marketplace_private.insert_shop_suspension_message(
 (select cycle_id from public.b26b_scope where label='consultation'),
 (select conversation_id from public.b26b_scope where label='consultation'),'reminder',clock_timestamp()+interval '24 hours 1 second',
 (select buyer_message from public.b26b_scope where label='consultation'));
select marketplace_private.insert_shop_suspension_message(
 (select cycle_id from public.b26b_scope where label='consultation'),
 (select conversation_id from public.b26b_scope where label='consultation'),'reminder',clock_timestamp()+interval '24 hours 2 seconds',
 (select buyer_message from public.b26b_scope where label='consultation'));
select public.b14_assert((select count(*)=1 from marketplace_private.shop_suspension_message_events
 where suspension_cycle_id=(select cycle_id from public.b26b_scope where label='consultation') and kind='reminder'),
 'rolling 24-hour reminder window and event identity prevent duplicate reminders');

-- Reactivation creates a new B12 access cycle; old Offers stay terminal and one
-- reopening message is emitted only for conversations that received a suspension notice.
select public.b14_buy(90,'pro',clock_timestamp());
select set_config('request.jwt.claim.role','service_role',false);
select public.marketplace_shop_membership_lifecycle('process_due',50);
select public.marketplace_shop_membership_lifecycle('process_due',50);
select set_config('request.jwt.claim.role','',false);
select public.b14_assert(
 (select state='reopened' and reopened_at is not null from marketplace_private.shop_suspension_cycles where id=(select cycle_id from public.b26b_scope where label='consultation'))
 and (select count(*)=1 from marketplace_private.shop_suspension_message_events where suspension_cycle_id=(select cycle_id from public.b26b_scope where label='consultation') and kind='reopened')
 and (select status='closed' from public.order_requests where id=(select offer_id from public.b26b_scope where label='consultation')),
 'reactivation sends one notice and never revives the old Offer');
select public.b07_actor(public.b14_owner(90));
select public.marketplace_send_text((select conversation_id from public.b26b_scope where label='consultation'),gen_random_uuid(),'Seller replies after reopening');

-- A completed Shop Order conversation remains available to both parties even if
-- its Seller later becomes Suspended; it receives no consultation auto-message.
do $$declare c uuid;term_start timestamptz;term_id uuid;before_count bigint;begin
 select o.conversation_id into c from public.orders o join public.listings l on l.id=o.listing_id
  where l.seller_id=public.b14_owner(81) and o.order_protocol_version=2 order by o.created_at limit 1;
 select starts_at,id into term_start,term_id from marketplace_private.shop_membership_terms
  where owner_id=public.b14_owner(81) order by ends_at desc limit 1;
 update marketplace_private.shop_membership_terms set ends_at=greatest(term_start+interval '1 second',clock_timestamp()-interval '432001 seconds')
  where id=term_id;
 select count(*) into before_count from public.messages where conversation_id=c and origin='marketplace_auto_reply';
 perform public.b07_actor(public.b14_owner(81));perform public.marketplace_send_text(c,gen_random_uuid(),'Suspended Seller Order support');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');perform public.marketplace_send_text(c,gen_random_uuid(),'Buyer Order support');
 perform public.b14_assert((select count(*) from public.messages where conversation_id=c and origin='marketplace_auto_reply')=before_count,
  'Order-linked Shop conversation stays bilateral and receives no consultation suspension reply');
end;$$;

-- Resale remains outside every Shop lifecycle branch.
do $$declare c public.conversations;begin
 select * into c from public.conversations where listing_channel_snapshot='resale' order by created_at desc limit 1;
 perform public.b07_actor(c.seller_id);perform public.marketplace_send_text(c.id,gen_random_uuid(),'Resale Seller unaffected');
 perform public.b07_actor(c.buyer_id);perform public.marketplace_send_text(c.id,gen_random_uuid(),'Resale Buyer unaffected');
 perform public.b14_assert(not exists(select 1 from marketplace_private.shop_suspension_message_events where conversation_id=c.id),
  'Resale conversation receives no Shop lifecycle event');
end;$$;

update marketplace_private.shop_transaction_admission set enabled=false,updated_at=clock_timestamp() where singleton;
select public.b14_assert(
 (select enabled=false from marketplace_private.shop_transaction_admission where singleton),
 'B26-A admission remains default-closed after B26-B qualification');

drop table public.b26b_scope;

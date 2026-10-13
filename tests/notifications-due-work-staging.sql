do $$declare o public.orders;terms jsonb;r public.order_meetup_revisions;other public.order_meetup_revisions;cmd uuid;cred jsonb;n bigint;begin
terms:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Synthetic campus',
'scheduled_at',date_trunc('hour',clock_timestamp())+interval '26 hours');
o:=pg_temp.bc_accept(terms,true);
select * into r from public.order_meetup_revisions where order_id=o.id and status='confirmed';
perform pg_temp.bc_assert((select count(*)=4 from marketplace_private.notification_reminders where order_id=o.id),'24h and 1h reminders for both');
-- Age only isolated synthetic reminder receipts to exercise due delivery.
update marketplace_private.notification_reminders set created_at=clock_timestamp()-interval '2 hours',due_at=clock_timestamp()-interval '1 minute' where order_id=o.id and kind='meetup_24h';
perform marketplace_private.run_transaction_due_work();perform marketplace_private.run_transaction_due_work();
perform pg_temp.bc_assert((select count(*)=2 from public.notifications where event_type='meetup_24h' and destination->>'orderId'=o.id::text),'reminders idempotent both participants');
-- New confirmed revision leaves old confirmed history intact; old reminders must suppress.
perform pg_temp.bc_actor((select buyer from bc_people));
perform public.marketplace_order_meetup_action(o.id,'propose',null,jsonb_build_object('location','Synthetic new campus','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours'),gen_random_uuid());
select * into other from public.order_meetup_revisions where order_id=o.id and status='pending';
perform pg_temp.bc_actor((select seller from bc_people));
perform public.marketplace_order_meetup_action(o.id,'confirm',other.id,null,gen_random_uuid());
update marketplace_private.notification_reminders set created_at=clock_timestamp()-interval '2 hours',due_at=clock_timestamp()-interval '1 minute' where order_id=o.id and confirmed_revision_id=r.id and delivered_at is null;
perform marketplace_private.run_transaction_due_work();
perform pg_temp.bc_assert((select count(*)=2 from marketplace_private.notification_reminders where order_id=o.id and confirmed_revision_id=r.id and suppressed_at is not null),'old confirmed schedule suppressed');
perform pg_temp.bc_assert((select count(*)=2 from marketplace_private.notification_reminders where order_id=o.id and confirmed_revision_id=other.id and kind='meetup_1h'),'new schedule future 1h reminder');
perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.notification_reminders where confirmed_revision_id=other.id and kind='meetup_24h'),'no retroactive 24h reminder');
terms:='{"item_amount_cents":10000,"fulfillment":"delivery","delivery_method":"seller_delivery","delivery_fee_cents":1000,"delivery_area":{"country_code":"CA","province_code":"ON","city_label":"London","postal_prefix":"N6A"}}';
o:=pg_temp.bc_accept(terms,false);
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where event_type='delivery_checkout_available' and recipient_user_id=o.buyer_id and destination->>'orderId'=o.id::text and priority='ACTION_REQUIRED'),'Buyer-origin checkout immediate action');
update marketplace_private.notification_reminders set created_at=clock_timestamp()-interval '12 hours',due_at=clock_timestamp()-interval '1 minute' where order_id=o.id;
perform marketplace_private.run_transaction_due_work();
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where event_type='delivery_claim_1h' and destination->>'orderId'=o.id::text),'one claim reminder');
perform pg_temp.bc_actor((select buyer from bc_people));perform public.marketplace_start_delivery_checkout(o.id);
perform pg_temp.bc_assert(not exists(select 1 from public.notifications where event_type='delivery_payment_10m' and destination->>'orderId'=o.id::text),'no immediate self checkout reminder');
update marketplace_private.notification_reminders set created_at=clock_timestamp()-interval '30 minutes',due_at=clock_timestamp()-interval '1 minute' where order_id=o.id and kind='delivery_payment_10m';
perform marketplace_private.run_transaction_due_work();perform marketplace_private.run_transaction_due_work();
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where event_type='delivery_payment_10m' and destination->>'orderId'=o.id::text),'one payment reminder');
o:=pg_temp.bc_paid('on_campus');
perform pg_temp.bc_assert((select count(*)=2 from public.notifications where event_type='handoff_ready' and destination->>'orderId'=o.id::text and priority='ACTION_REQUIRED'),'handoff ready both actions after Paid');
perform pg_temp.bc_actor((select buyer from bc_people));cred:=public.marketplace_handoff_credential(o.id);
perform pg_temp.bc_actor((select seller from bc_people));perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where event_type='handoff_confirmed' and destination->>'orderId'=o.id::text and recipient_user_id=o.buyer_id),'handoff Buyer only');
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where event_type='protection_started' and destination->>'orderId'=o.id::text and recipient_user_id=o.seller_id),'Protection coalesced Buyer possession notification');
perform pg_temp.bc_assert(not has_function_privilege('authenticated','public.marketplace_run_transaction_due_work()','EXECUTE'),'worker inaccessible to normal client');
end;$$;

-- Run with only bc_people/bc_accept helpers in one rollback-only transaction.
do $$
declare o public.orders;reply jsonb;credential jsonb;message_id uuid:=gen_random_uuid();n bigint;
begin
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','nf_fixture','nf_payout','Test Bank','6789');
 perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','nf_fixture','nf_method','Test Card','1234');
 o:=pg_temp.bc_accept(jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Synthetic notification campus','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours'),true);
 perform pg_temp.bc_assert((select count(*)=2 from public.notifications where destination->>'orderId'=o.id::text and event_type='agreement_confirmation_required'),'both Agreement participants notified');
 perform pg_temp.bc_actor(o.buyer_id);
 perform public.marketplace_confirm_order_agreement(o.id);
 perform public.marketplace_confirm_order_agreement(o.id);
 perform pg_temp.bc_assert((select count(*)=1 from public.notifications where destination->>'orderId'=o.id::text and event_type='agreement_other_confirmed' and recipient_user_id=o.seller_id),'one other-party confirmation, not own');
 perform pg_temp.bc_actor(o.seller_id);perform public.marketplace_confirm_order_agreement(o.id);perform public.marketplace_confirm_order_agreement(o.id);
 perform pg_temp.bc_assert((select count(*)=2 from public.notifications where destination->>'orderId'=o.id::text and event_type='agreement_complete'),'both completion notifications idempotent');
 perform pg_temp.bc_actor(o.buyer_id);
 perform public.marketplace_confirm_campus_inspection(o.id,gen_random_uuid());
 reply:=public.marketplace_start_order_payment(o.id,gen_random_uuid());
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 perform public.marketplace_resolve_campus_payment((reply->>'attemptId')::uuid,true);
 perform pg_temp.bc_assert(exists(select 1 from public.notifications where destination->>'orderId'=o.id::text and event_type='payment_paid' and recipient_user_id=o.seller_id),'authoritative Paid notification');
 perform pg_temp.bc_actor(o.buyer_id);credential:=public.marketplace_handoff_credential(o.id);
 perform pg_temp.bc_actor(o.seller_id);perform public.marketplace_verify_handoff(o.id,'code',credential->>'code',gen_random_uuid());
 perform pg_temp.bc_assert(exists(select 1 from public.notifications where destination->>'orderId'=o.id::text and event_type='handoff_confirmed'),'authoritative handoff notification');
 perform pg_temp.bc_assert(exists(select 1 from public.notifications where destination->>'orderId'=o.id::text and event_type='protection_started'),'authoritative Protection notification');
 perform pg_temp.bc_actor(o.buyer_id);perform public.marketplace_send_text(o.conversation_id,message_id,'Synthetic notification message');
 perform pg_temp.bc_assert(exists(select 1 from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id where e.source_key='message:'||(select id from public.messages where client_message_id=message_id)::text and n.recipient_user_id=o.seller_id and n.event_type='new_message'),'message recipient notified');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.event_type='new_message'),'no per-message email');
 perform pg_temp.bc_assert(not exists(select 1 from public.notifications n where n.destination::text like '%qrToken%' or n.destination::text like '%Synthetic notification message%'),'no credential/chat content in notifications');
 perform pg_temp.bc_assert(not exists(select 1 from public.notifications n where n.recipient_user_id=(select outsider from bc_people)),'outsider excluded');
end;$$;
select jsonb_build_object('passed',true,'scope','real Agreement/Payment/Handoff/Protection/Message RPCs; synthetic rollback-only') result;

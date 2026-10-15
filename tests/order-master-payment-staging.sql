-- Included after the rollback-only bc_accept/actor/assert fixture helpers.
do $$
declare o public.orders; reply jsonb; attempt uuid; command uuid:=gen_random_uuid();
begin
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','master_fixture','master_payout','Test Bank','6789');
 perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','master_fixture','master_method','Test Card','1234');
 o:=pg_temp.bc_accept(jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus',
 'meetup_location','Rollback campus','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours'),true);
 perform pg_temp.bc_actor((select buyer from bc_people));
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.campus_inspections where order_id=o.id),'no fabricated inspection');
 perform pg_temp.bc_assert(public.marketplace_handoff_credential(o.id)->>'available'='false','no unpaid credential');
 perform pg_temp.bc_actor((select seller from bc_people));
 perform pg_temp.bc_reject(format('select public.marketplace_start_order_payment(%L,%L)',o.id,command),'42501');
 perform pg_temp.bc_actor((select outsider from bc_people));
 perform pg_temp.bc_reject(format('select public.marketplace_start_order_payment(%L,%L)',o.id,command),'42501');
 perform pg_temp.bc_actor((select buyer from bc_people));
 reply:=public.marketplace_start_order_payment(o.id,command);attempt:=(reply->>'attemptId')::uuid;
 perform pg_temp.bc_assert(attempt is not null and reply->>'status'='processing','Buyer pays before inspection');
 perform pg_temp.bc_assert(public.marketplace_start_order_payment(o.id,command)->>'attemptId'=attempt::text,'payment retry same attempt');
 perform pg_temp.bc_assert(public.marketplace_start_order_payment(o.id,gen_random_uuid())->>'attemptId'=attempt::text,'restart reconciles protected attempt');
 perform pg_temp.bc_assert(public.marketplace_handoff_credential(o.id)->>'available'='false','Processing has no credential');
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 perform public.marketplace_resolve_campus_payment(attempt,true);
 perform pg_temp.bc_assert((select payment_status='paid' and payment_paid_at is not null and holds_listing from public.orders where id=o.id),'authoritative Paid');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.campus_inspections where order_id=o.id),'Paid requires no fabricated inspection');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.order_protection where order_id=o.id),'Paid does not start Protection');
 perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='payment_paid'),'one payment event');
 perform pg_temp.bc_assert((select count(*)=1 from marketplace_private.campus_payment_attempts where order_id=o.id),'one payment attempt');
 perform pg_temp.bc_actor((select buyer from bc_people));
 perform pg_temp.bc_assert(public.marketplace_handoff_credential(o.id)->>'available'='true','Paid Buyer credential available');
 perform pg_temp.bc_assert(public.marketplace_campus_payment_state(o.id)->>'inspectionConfirmedAt' is null,'history unchanged');
end;$$;

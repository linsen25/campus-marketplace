-- Append after notifications-domain-staging.sql, inside a rolled-back transaction.
do $$
declare d marketplace_private.notification_deliveries; result jsonb; initial timestamptz;
begin
 perform pg_temp.nd_assert(not exists(select 1 from marketplace_private.notification_deliveries delivery join public.notifications n on n.id=delivery.notification_id
 where n.event_type in('new_message','price_drop','offer_withdrawn')),'no message/price/withdraw email');
 select x.* into d from marketplace_private.notification_deliveries x join public.notifications n on n.id=x.notification_id
 where n.recipient_user_id in(select seller from nd_people) limit 1;
 perform pg_temp.nd_assert(d.id is not null,'email outbox created transactionally');
 perform pg_temp.nd_assert(not has_table_privilege('authenticated','marketplace_private.notification_deliveries','SELECT')
 and not has_function_privilege('authenticated','public.marketplace_claim_email_deliveries(integer,uuid)','EXECUTE'),'no client delivery authority');
 update marketplace_private.notification_deliveries set test_only=true where id=d.id;
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 result:=public.marketplace_claim_email_deliveries(1,d.id);
 perform pg_temp.nd_assert(jsonb_array_length(result)=1,'one delivery claimed');
 select * into d from marketplace_private.notification_deliveries where id=d.id;
 perform pg_temp.nd_assert(jsonb_array_length(public.marketplace_claim_email_deliveries(1,d.id))=0,'live lease cannot be claimed again');
 result:=public.marketplace_prepare_email(d.id,d.lease_id,'{"from":"Fixture","to":["fixture@example.invalid"],"subject":"Fixture","html":"<p>Fixture</p>","text":"Fixture"}');
 perform pg_temp.nd_assert(public.marketplace_prepare_email(d.id,d.lease_id,'{"from":"Changed","to":[],"subject":"Changed","html":"Changed","text":"Changed"}')=result,'frozen envelope retained');
 perform pg_temp.nd_assert(not public.marketplace_finish_email(d.id,gen_random_uuid(),null,'timeout',true),'stale worker fenced');
 perform pg_temp.nd_assert(public.marketplace_finish_email(d.id,d.lease_id,null,'timeout',true),'retryable timeout');
 perform pg_temp.nd_assert(exists(select 1 from marketplace_private.notification_deliveries where id=d.id and status='retryable' and attempt_count=1 and next_attempt_at>clock_timestamp()),'retry scheduled');
 update marketplace_private.notification_deliveries set next_attempt_at=clock_timestamp()-interval '1 second' where id=d.id;
 perform public.marketplace_claim_email_deliveries(1,d.id);
 select * into d from marketplace_private.notification_deliveries where id=d.id;
 perform pg_temp.nd_assert(public.marketplace_finish_email(d.id,d.lease_id,'synthetic-provider-id',null,false),'success persisted');
 perform pg_temp.nd_assert(jsonb_array_length(public.marketplace_claim_email_deliveries(1,d.id))=0,'sent cannot be claimed');
 perform pg_temp.nd_actor((select seller from nd_people));
 perform public.marketplace_mark_all_notifications_read();
 perform pg_temp.nd_assert(not exists(select 1 from public.notifications where recipient_user_id=(select seller from nd_people) and read_at is null),'mark all own only');
end;$$;
do $$declare d marketplace_private.notification_deliveries;begin
 select delivery.* into d from marketplace_private.notification_deliveries delivery
 join public.notifications n on n.id=delivery.notification_id
 where delivery.status='pending' and n.recipient_user_id in(select buyer from nd_people) limit 1;
 perform pg_temp.nd_assert(d.id is not null,'disposable audit fixture exists');
 update marketplace_private.notification_deliveries set attempt_count=1,status='permanent_failure',last_error_code='sender_restricted' where id=d.id;
 delete from public.notifications where id=d.notification_id;
 perform pg_temp.nd_assert(exists(select 1 from marketplace_private.notification_deliveries where id=d.id
 and notification_id is null and notification_identity=d.notification_id and attempt_count=1
 and status='permanent_failure' and last_error_code='sender_restricted'),'cleanup retains original attempted failure audit');
end;$$;
select jsonb_build_object('passed',true,'scope','synthetic rollback-only notification/outbox/privacy/idempotency/audit retention') result;

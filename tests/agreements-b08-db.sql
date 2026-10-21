-- Executed only in the existing loopback-only native PostgreSQL test harness.
-- No immutable trigger is disabled, no remote service or payment is invoked.
create table public.b08_orders(label text primary key, id uuid, baseline jsonb);
grant select on public.b08_orders to authenticated;
create function public.b08_fixture(label text,mode text default 'external') returns uuid language plpgsql as $$
declare c uuid;r public.order_requests;o public.orders;b uuid;cmd uuid:=gen_random_uuid();begin
 c:=public.b07_fixture('B08 '||label);
 r:=public.marketplace_submit_offer(c,public.b07_terms(8000,mode),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 b:=public.b07_prepare(r.id,auth.uid(),cmd);
 o:=public.marketplace_accept_offer(r.id,cmd,b);
 insert into public.b08_orders values(label,o.id,to_jsonb(o));
 return o.id;
end;$$;

do $$declare oid uuid;v jsonb;before_time text;begin
 oid:=public.b08_fixture('sequential');
 v:=public.marketplace_order_agreement(oid);
 perform public.b07_assert(not (v->>'complete')::boolean and v->>'buyerConfirmedAt' is null and v->>'sellerConfirmedAt' is null,'new Agreement needs both');
 perform public.b07_assert((select terms_digest=sha256(convert_to(terms_snapshot::text,'UTF8')) from marketplace_private.order_agreements a join public.orders o on o.id=a.order_id where o.id=oid),'digest freezes actual Order');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 v:=public.marketplace_confirm_order_agreement(oid);before_time:=v->>'buyerConfirmedAt';
 perform public.b07_assert(before_time is not null and not (v->>'complete')::boolean and v->>'sellerConfirmedAt' is null,'Buyer cannot confirm Seller');
 perform public.b07_assert(public.marketplace_confirm_order_agreement(oid)->>'buyerConfirmedAt'=before_time,'Buyer replay keeps server time');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 v:=public.marketplace_confirm_order_agreement(oid);
 perform public.b07_assert((v->>'complete')::boolean and v->>'buyerConfirmedAt'=before_time and v->>'sellerConfirmedAt' is not null,'both same frozen Agreement complete');
 perform public.b07_assert((public.marketplace_confirm_order_agreement(oid)-'serverTime')=(v-'serverTime'),'Seller replay returns same confirmation receipt');
 perform public.b07_assert((select to_jsonb(o)=b.baseline from public.orders o join public.b08_orders b on b.id=o.id where o.id=oid),'confirm never edits Order/payment/inventory/terms');
 perform public.b07_assert((select count(*)=2 from public.notifications where event_type='agreement_complete' and destination->>'orderId'=oid::text),'completion notification once per actor');
 perform public.b07_assert((select count(*)=1 from public.notifications where event_type='agreement_other_confirmed' and destination->>'orderId'=oid::text),'one-sided notification once');
 perform public.b07_assert((select status='pending' and reserved_order_id=oid from public.listings where id=(select listing_id from public.orders where id=oid)),'held inventory unchanged');
 perform public.b07_assert((select count(*)=2 from marketplace_private.order_snapshot_media where order_id=oid),'bound media unchanged');
end;$$;

set role authenticated;
select public.b07_actor('44444444-4444-4444-8444-444444444444');
select public.b07_reject('select public.marketplace_confirm_order_agreement((select id from public.b08_orders where label=''sequential''))','42501');
select public.b07_reject('select public.marketplace_order_agreement((select id from public.b08_orders where label=''sequential''))','42501');
select public.b07_reject('select * from marketplace_private.order_agreements','42501');
select public.b07_actor('55555555-5555-4555-8555-555555555555');
select public.b07_reject('select public.marketplace_confirm_order_agreement((select id from public.b08_orders where label=''sequential''))','42501');
select public.b07_actor(null);
select public.b07_reject('select public.marketplace_confirm_order_agreement((select id from public.b08_orders where label=''sequential''))','42501');
reset role;
select public.b07_assert(not has_function_privilege('anon','public.marketplace_confirm_order_agreement(uuid)','execute'),'anon lacks execute');

-- Rollback is failure injection only in this test-owned transaction, no trigger bypass.
select public.b08_fixture('rollback');
begin;
select public.b07_actor('22222222-2222-4222-8222-222222222222');
select public.marketplace_confirm_order_agreement((select id from public.b08_orders where label='rollback'));
rollback;
select public.b07_assert((select buyer_confirmed_at is null and seller_confirmed_at is null from marketplace_private.order_agreements where order_id=(select id from public.b08_orders where label='rollback')),'failed transaction leaves no partial confirmation');
select public.b07_assert(not exists(select 1 from public.notifications where event_type='agreement_other_confirmed' and destination->>'orderId'=(select id::text from public.b08_orders where label='rollback')),'failed transaction leaves no notification');

-- Local trusted readiness fixture only; no provider, payment start or success.
select set_config('request.jwt.claim.role','service_role',false);
select public.marketplace_record_financial_capability('11111111-1111-4111-8111-111111111111','payout_account','ready','b08_local','local-owner','local-instrument','B08 local fixture',null);
select set_config('request.jwt.claim.role','authenticated',false);
do $$declare oid uuid;begin
 oid:=public.b08_fixture('uu-pay','uu_pay');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.b07_reject(format('select public.marketplace_start_order_payment(%L,gen_random_uuid())',oid),'23514');
 perform public.marketplace_confirm_order_agreement(oid);
 perform public.b07_reject(format('select public.marketplace_start_order_payment(%L,gen_random_uuid())',oid),'23514');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.marketplace_confirm_order_agreement(oid);
 perform public.b07_assert(marketplace_private.order_agreement_ready(oid),'UU Agreement ready only after both');
 perform public.b07_assert((select to_jsonb(o)=b.baseline from public.orders o join public.b08_orders b on b.id=o.id where o.id=oid),'UU confirmation never starts payment');
end;$$;

do $$declare oid uuid;begin
 oid:=public.b08_fixture('closed');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.marketplace_cancel_order(oid,'buyer_changed_mind','B08 local cancellation',gen_random_uuid());
 perform public.b07_reject(format('select public.marketplace_confirm_order_agreement(%L)',oid),'23505');
 perform public.b07_assert(not marketplace_private.order_agreement_ready(oid),'closed Order cannot gain Agreement confirmations');
end;$$;

select public.b07_assert(not exists(select 1 from marketplace_private.order_settlement_authorizations),'no financial settlement');
select public.b07_assert(not exists(select 1 from marketplace_private.campus_payment_attempts),'no payment attempt created');
select public.b07_assert(not exists(select 1 from marketplace_private.notification_deliveries),'no external email queued');
select public.b07_assert(not exists(select 1 from pg_trigger where tgrelid in('public.orders'::regclass,'public.order_requests'::regclass,'public.transaction_events'::regclass,'marketplace_private.v2_order_economics'::regclass) and tgenabled='D'),'all immutable triggers remain enabled');

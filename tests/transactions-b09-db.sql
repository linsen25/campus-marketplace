-- Test-only fixtures in the established isolated native PostgreSQL harness.
-- No scheduler invocation, clock rewrite, disabled trigger or remote financial call.
create table public.b09_scope(label text primary key,order_id uuid,listing_id uuid);
grant select on public.b09_scope to authenticated;
create function public.b09_make(label text,mode text default 'external',fulfillment text default 'on_campus') returns uuid language plpgsql as $$
declare cid uuid;t jsonb;r public.order_requests;o public.orders;b uuid;cmd uuid:=gen_random_uuid();begin
 cid:=public.b07_fixture('B09 '||label);t:=public.b07_terms(8000,mode);
 if fulfillment<>'on_campus' then t:=jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method',fulfillment,'delivery_fee_cents',1000,
 'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A'),'payment_mode',mode,'payment_mode_version',1);end if;
 r:=public.marketplace_submit_offer(cid,t,gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');b:=public.b07_prepare(r.id,auth.uid(),cmd);
 o:=public.marketplace_accept_offer(r.id,cmd,b);
 perform public.marketplace_confirm_order_agreement(o.id);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');perform public.marketplace_confirm_order_agreement(o.id);
 insert into public.b09_scope values(label,o.id,o.listing_id);return o.id;
end;$$;

do $$declare oid uuid;v jsonb;cmd uuid:=gen_random_uuid();begin
 oid:=public.b09_make('external-complete');
 v:=public.marketplace_confirm_external_exchange(oid,cmd);
 perform public.b07_assert(v->>'status'='buyer_confirmed','one participant cannot complete');
 perform public.b07_assert(public.marketplace_confirm_external_exchange(oid,cmd)=v,'same action replay');
 perform public.b07_assert(public.marketplace_confirm_external_exchange(oid,gen_random_uuid())=v,'repeat attestation immutable');
 perform public.b07_assert(not marketplace_private.meetup_mutable(o) and not marketplace_private.order_cancel_before_cutoff(o),'one attestation closes cancellation/expiry eligibility') from public.orders o where id=oid;
 perform public.b07_assert(public.marketplace_cancel_order(oid,'buyer_changed_mind','',gen_random_uuid())->>'errorCode'='order_not_cancellable','cancel cannot erase attestation');
 perform public.b07_reject(format('select public.marketplace_start_order_payment(%L,gen_random_uuid())',oid),'23514');
 perform public.b07_reject(format('select public.marketplace_generate_handoff_qr(%L,gen_random_uuid())',oid),'23514');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_assert(public.marketplace_confirm_external_exchange(oid,gen_random_uuid())->>'status'='confirmed','dual exchange completes');
 perform public.b07_assert((select lifecycle_status='completed' and not holds_listing and payment_status='pending' and payment_paid_at is null and payout_status='not_eligible' from public.orders where id=oid),'external completion never Paid or payout');
 perform public.b07_assert((select status='sold' and reserved_order_id is null from public.listings where id=(select listing_id from public.orders where id=oid)),'only both attestations sell');
 perform public.b07_assert((select buyer_service_fee_cents=0 from marketplace_private.v2_order_economics where order_id=oid),'external zero fee');
end;$$;

do $$declare oid uuid;cmd uuid:=gen_random_uuid();v jsonb;begin
 oid:=public.b09_make('external-dispute');
 perform public.b07_reject(format('select public.marketplace_dispute_external_exchange(%L,''No exchange'',gen_random_uuid())',oid),'23505');
 perform public.marketplace_confirm_external_exchange(oid,gen_random_uuid());
 perform public.b07_reject(format('select public.marketplace_dispute_external_exchange(%L,''No exchange'',gen_random_uuid())',oid),'23505');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 v:=public.marketplace_dispute_external_exchange(oid,'No exchange',cmd);
 perform public.b07_assert(v->>'status'='disputed','non-financial disagreement');
 perform public.b07_assert(public.marketplace_dispute_external_exchange(oid,'No exchange',cmd)=v,'dispute retry');
 perform public.b07_reject(format('select public.marketplace_confirm_external_exchange(%L,gen_random_uuid())',oid),'23505');
 perform public.b07_assert((select lifecycle_status='open' and holds_listing from public.orders where id=oid),'dispute retains inventory');
 oid:=public.b09_make('external-cancel');
 perform public.marketplace_cancel_order(oid,'buyer_changed_mind','Local only',gen_random_uuid());
 perform public.b07_assert((select lifecycle_status='cancelled' and not holds_listing from public.orders where id=oid),'zero attestation cancellation');
 perform public.b07_assert((select status='available' and reserved_order_id is null from public.listings where id=(select listing_id from public.orders where id=oid)),'cancel releases only own inventory');
 perform public.b07_reject(format('select public.marketplace_confirm_external_exchange(%L,gen_random_uuid())',oid),'23505');
 perform public.b07_assert(not exists(select 1 from marketplace_private.order_settlement_authorizations),'external never financial settlement');
 perform public.b07_assert(not exists(select 1 from marketplace_private.order_protection),'external never Protection');
 perform public.b07_assert(not exists(select 1 from marketplace_private.handoff_authorizations),'external never handoff');
end;$$;

set role authenticated;
select public.b07_actor('44444444-4444-4444-8444-444444444444');
select public.b07_reject('select public.marketplace_confirm_external_exchange((select order_id from public.b09_scope limit 1),gen_random_uuid())','42501');
select public.b07_reject('select public.marketplace_external_exchange((select order_id from public.b09_scope limit 1))','42501');
select public.b07_reject('select * from marketplace_private.external_exchanges','42501');
select public.b07_actor(null);
select public.b07_reject('select public.marketplace_confirm_external_exchange((select order_id from public.b09_scope limit 1),gen_random_uuid())','42501');
reset role;

-- LOCAL SIMULATOR ONLY: native RPC outcomes, no Stripe/network/provider operation.
select set_config('request.jwt.claim.role','service_role',false);
select public.marketplace_record_financial_capability('11111111-1111-4111-8111-111111111111','payout_account','ready','b09_local','owner','instrument','Local simulated payout',null);
select public.marketplace_record_financial_capability('22222222-2222-4222-8222-222222222222','payment_method','set','b09_local','owner','instrument','Local simulated card','1234');
select set_config('request.jwt.claim.role','authenticated',false);
create function public.b09_paid(label text,fulfillment text default 'on_campus') returns uuid language plpgsql as $$
declare oid uuid;p jsonb;begin
 oid:=public.b09_make(label,'uu_pay',fulfillment);
 if fulfillment<>'on_campus' then
  perform public.marketplace_start_delivery_checkout(oid);
  perform public.marketplace_save_delivery_address(oid,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Local fixture street"}');
 end if;
 p:=public.marketplace_start_order_payment(oid,gen_random_uuid());
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false);
 perform public.marketplace_resolve_campus_payment((p->>'attemptId')::uuid,true);
 perform set_config('request.jwt.claims','{}',false);return oid;
end;$$;

do $$declare oid uuid;cred jsonb;qr jsonb;r jsonb;cmd uuid;wrong text;i integer;begin
 oid:=public.b09_paid('uu-handoff');cred:=public.marketplace_handoff_credential(oid);
 wrong:=lpad((((cred->>'code')::integer+1)%1000000)::text,6,'0');
 qr:=public.marketplace_generate_handoff_qr(oid,gen_random_uuid());
 perform public.b07_reject(format('select public.marketplace_verify_handoff(%L,''code'',%L,gen_random_uuid())',oid,cred->>'code'),'42501');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_reject(format('select public.marketplace_handoff_credential(%L)',oid),'42501');
 for i in 1..5 loop perform public.marketplace_verify_handoff(oid,'code',wrong,gen_random_uuid());end loop;
 perform public.b07_assert(public.marketplace_verify_handoff(oid,'code',cred->>'code',gen_random_uuid())->>'errorCode'='numeric_temporarily_locked','numeric lock persists');
 cmd:=gen_random_uuid();r:=public.marketplace_verify_handoff(oid,'qr',qr->>'qrToken',cmd);
 perform public.b07_assert((r->>'verified')::boolean,'QR independent of numeric lock');
 perform public.b07_assert(public.marketplace_verify_handoff(oid,'qr',qr->>'qrToken',cmd)=r,'handoff replay');
 perform public.b07_assert(public.marketplace_verify_handoff(oid,'code',cred->>'code',gen_random_uuid())->>'errorCode'='handoff_already_redeemed','redeemed channel locked');
 perform public.b07_assert((select expires_at=started_at+interval '24 hours' from marketplace_private.order_protection where order_id=oid),'24h Protection authority');
 perform public.b07_reject(format('select public.marketplace_open_protection_case(%L,''WRONG_ITEM'',gen_random_uuid())',oid),'42501');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');cmd:=gen_random_uuid();r:=public.marketplace_open_protection_case(oid,'WRONG_ITEM',cmd);
 perform public.b07_assert(public.marketplace_open_protection_case(oid,'WRONG_ITEM',cmd)=r,'Buyer case idempotent');
 perform public.b07_assert(public.marketplace_cancel_order(oid,'buyer_changed_mind','',gen_random_uuid())->>'errorCode'='order_not_cancellable','post-handoff cancel closed');
 perform public.b07_assert((select lifecycle_status='open' and holds_listing and payout_status='not_eligible' from public.orders where id=oid),'case/Protection keeps item held and no payout');
end;$$;

do $$declare oid uuid;cmd uuid;cred jsonb;r jsonb;begin
 oid:=public.b09_paid('uu-seller-delivery','seller_delivery');
 perform public.b07_reject(format('select public.marketplace_start_seller_delivery(%L,gen_random_uuid())',oid),'42501');
 perform public.b07_reject(format('select public.marketplace_generate_handoff_qr(%L,gen_random_uuid())',oid),'23505');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');cmd:=gen_random_uuid();r:=public.marketplace_start_seller_delivery(oid,cmd);
 perform public.b07_assert(public.marketplace_start_seller_delivery(oid,cmd)=r,'Seller delivery idempotent milestone');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');cred:=public.marketplace_handoff_credential(oid);
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b07_assert(public.marketplace_verify_handoff(oid,'code',cred->>'code',gen_random_uuid())->>'verified'='true','Seller delivery requires start then handoff');
 oid:=public.b09_paid('uu-courier','courier');
 perform public.b07_reject(format('select public.marketplace_generate_handoff_qr(%L,gen_random_uuid())',oid),'23514');
 perform public.b07_reject(format('select public.marketplace_record_courier_shipment(%L,''Local carrier'',''Local tracking'',gen_random_uuid())',oid),'42501');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');cmd:=gen_random_uuid();
 r:=public.marketplace_record_courier_shipment(oid,'Local carrier','Local tracking',cmd);
 perform public.b07_assert(public.marketplace_record_courier_shipment(oid,'Local carrier','Local tracking',cmd)=r,'shipment receipt once');
 perform public.b07_assert(not exists(select 1 from marketplace_private.order_protection where order_id=oid),'shipment alone not possession');
 perform public.b07_reject(format('select public.marketplace_confirm_courier_received(%L,gen_random_uuid())',oid),'42501');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');cmd:=gen_random_uuid();r:=public.marketplace_confirm_courier_received(oid,cmd);
 perform public.b07_assert(public.marketplace_confirm_courier_received(oid,cmd)=r,'Buyer receipt idempotent');
 perform public.b07_assert((select expires_at=started_at+interval '24 hours' from marketplace_private.order_protection where order_id=oid),'receipt starts protection');
 perform public.b07_assert((select lifecycle_status='open' and holds_listing and payout_status='not_eligible' from public.orders where id=oid),'receipt not completed or payout');
 perform public.b07_assert((select count(*)=1 from public.transaction_events where order_id=oid and event_type='buyer_confirm_received'),'receipt event once');
end;$$;

select public.b07_assert(not exists(select 1 from marketplace_private.notification_deliveries),'no actual email queued');
select public.b07_assert(not exists(select 1 from pg_trigger where tgrelid in('public.orders'::regclass,'public.order_requests'::regclass,'public.transaction_events'::regclass,'marketplace_private.v2_order_economics'::regclass) and tgenabled='D'),'all immutable triggers remain enabled');

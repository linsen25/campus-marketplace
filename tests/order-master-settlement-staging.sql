create function pg_temp.master_order(mode text,pay boolean default true) returns public.orders language plpgsql as $$
declare o public.orders;terms jsonb;r jsonb;
begin
 terms:=case when mode='on_campus' then jsonb_build_object('item_amount_cents',8000,'fulfillment',mode,'meetup_location','Rollback campus','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours')
 else jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method',mode,'delivery_fee_cents',1000,
 'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A')) end;
 o:=pg_temp.bc_accept(terms,true);perform pg_temp.bc_actor((select buyer from bc_people));
 if mode<>'on_campus' then perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Rollback synthetic street"}');end if;
 r:=public.marketplace_start_order_payment(o.id,gen_random_uuid());
 if pay then
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 perform public.marketplace_resolve_campus_payment((r->>'attemptId')::uuid,true);end if;
 select * into o from public.orders where id=o.id;return o;
end;$$;
do $$declare o public.orders;mode text;actor uuid;key uuid;reply jsonb;credential jsonb;attempt uuid;paid boolean;i integer;
begin
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','master_fixture','master_payout','Test Bank','6789');
 perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','master_fixture','master_method','Test Card','1234');
 foreach mode in array array['on_campus','seller_delivery','courier'] loop
  foreach actor in array array[(select buyer from bc_people),(select seller from bc_people)] loop
   o:=pg_temp.master_order(mode);perform pg_temp.bc_actor(actor);key:=gen_random_uuid();
   reply:=public.marketplace_cancel_order(o.id,case when actor=o.buyer_id then 'buyer_changed_mind' else 'seller_scheduling_issue' end,'Rollback fixture',key);
   perform pg_temp.bc_assert(reply->'order'->>'lifecycle_status'='cancelled','paid cancellation before cutoff');
   perform public.marketplace_cancel_order(o.id,case when actor=o.buyer_id then 'buyer_changed_mind' else 'seller_scheduling_issue' end,'Rollback fixture',key);
   perform pg_temp.bc_assert((select buyer_release_cents=secured_cents and seller_delivery_compensation_cents=0 and platform_retained_cents=0 and platform_reversed_cents=80 from marketplace_private.order_settlement_authorizations where order_id=o.id),'full authorized release and reversed fee');
   perform pg_temp.bc_assert((select status='available' and reserved_order_id is null from public.listings where id=o.listing_id),'listing released');
   perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='order_cancelled'),'one terminal event');
   perform pg_temp.bc_assert((select status='accepted' from public.order_requests where id=o.request_id),'Request remains Accepted');
  end loop;
 end loop;
 -- Processing cancellation is preserved, then automatically finalizes on either result.
 foreach paid in array array[false,true] loop
  o:=pg_temp.master_order('on_campus',false);perform pg_temp.bc_actor(o.buyer_id);key:=gen_random_uuid();
  perform public.marketplace_cancel_order(o.id,'buyer_changed_mind','Processing cancellation',key);
  perform public.marketplace_cancel_order(o.id,'buyer_changed_mind','Processing cancellation',key);
  perform pg_temp.bc_assert(public.marketplace_order_cancellation_state(o.id)->>'state'='payment_pending','pending accepted intent');
  perform pg_temp.bc_reject(format('select public.marketplace_start_order_payment(%L,%L)',o.id,gen_random_uuid()),'23505');
  select id into attempt from marketplace_private.campus_payment_attempts where order_id=o.id;
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment(attempt,paid);
  perform pg_temp.bc_assert((select lifecycle_status='cancelled' and not holds_listing from public.orders where id=o.id),'automatic cancellation after terminal payment');
  perform pg_temp.bc_assert((select secured_cents=case when paid then 8080 else 0 end and buyer_release_cents=secured_cents from marketplace_private.order_settlement_authorizations where order_id=o.id),'correct secured/release amounts');
  perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id),'delayed Paid cannot enable handoff');
 end loop;
 -- Start delivery is Seller-only and idempotent. Ordinary Buyer cancellation compensates delivery only.
 o:=pg_temp.master_order('seller_delivery');perform pg_temp.bc_actor(o.buyer_id);
 perform pg_temp.bc_reject(format('select public.marketplace_start_seller_delivery(%L,%L)',o.id,gen_random_uuid()),'42501');
 perform pg_temp.bc_actor(o.seller_id);key:=gen_random_uuid();
 reply:=public.marketplace_start_seller_delivery(o.id,key);
 perform pg_temp.bc_assert(public.marketplace_start_seller_delivery(o.id,key)=reply,'same authoritative start timestamp');
 perform pg_temp.bc_actor(o.buyer_id);perform public.marketplace_cancel_order(o.id,'buyer_changed_mind','Ordinary',gen_random_uuid());
 perform pg_temp.bc_assert((select secured_cents=9080 and buyer_release_cents=8080 and seller_delivery_compensation_cents=1000 and platform_retained_cents=0 and seller_sale_payout_cents=0 from marketplace_private.order_settlement_authorizations where order_id=o.id),'delivery compensation is not sale payout');
 -- Seller initiation after start returns all funds.
 o:=pg_temp.master_order('seller_delivery');perform pg_temp.bc_actor(o.seller_id);
 perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
 perform public.marketplace_cancel_order(o.id,'seller_scheduling_issue','Seller failure',gen_random_uuid());
 perform pg_temp.bc_assert((select buyer_release_cents=9080 and seller_delivery_compensation_cents=0 from marketplace_private.order_settlement_authorizations where order_id=o.id),'Seller failure full release');
 -- A Buyer allegation/mutual selection never self-awards money; Seller agrees or Case holds.
 for i in 1..3 loop
  o:=pg_temp.master_order('seller_delivery');perform pg_temp.bc_actor(o.seller_id);
  perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(o.buyer_id);credential:=public.marketplace_handoff_credential(o.id);
  reply:=public.marketplace_request_delivery_full_refund(o.id,case when i=3 then 'mutual' else 'seller_fault' end,'Request context',gen_random_uuid());
  perform pg_temp.bc_assert(reply->>'state'='awaiting_seller' and reply->'settlement'='null'::jsonb,'allegation is evidence only');
  perform pg_temp.bc_assert(public.marketplace_handoff_credential(o.id)->>'available'='false','pending request hides credentials');
  perform pg_temp.bc_actor(o.seller_id);
  perform pg_temp.bc_reject(format('select public.marketplace_verify_handoff(%L,''code'',%L,%L)',o.id,credential->>'code',gen_random_uuid()),'23505');
  reply:=public.marketplace_respond_delivery_cancellation(o.id,case when i=2 then 'dispute' else 'agree' end,gen_random_uuid());
  if i=2 then
   perform pg_temp.bc_assert(reply->>'state'='disputed' and reply->'settlement'='null'::jsonb,'disagreement is unresolved hold');
   perform pg_temp.bc_assert((select phase='pre_handoff_cancellation' and state='resolution_required' from marketplace_private.protection_cases where order_id=o.id),'reuse Case authority');
   perform pg_temp.bc_assert((select lifecycle_status='open' and holds_listing and payout_status='not_eligible' from public.orders where id=o.id),'held transaction cannot payout/complete');
  else
   perform pg_temp.bc_assert((select buyer_release_cents=9080 and seller_delivery_compensation_cents=0 from marketplace_private.order_settlement_authorizations where order_id=o.id),'agreed full refund authorization');
  end if;
 end loop;
 -- Authoritative possession/shipment cutoffs remain closed.
 o:=pg_temp.master_order('on_campus');perform pg_temp.bc_actor(o.buyer_id);credential:=public.marketplace_handoff_credential(o.id);
 perform pg_temp.bc_actor(o.seller_id);perform public.marketplace_verify_handoff(o.id,'code',credential->>'code',gen_random_uuid());
 perform pg_temp.bc_assert(public.marketplace_cancel_order(o.id,'seller_scheduling_issue','Too late',gen_random_uuid())->>'errorCode'='order_not_cancellable','handoff cutoff');
 o:=pg_temp.master_order('courier');perform pg_temp.bc_actor(o.seller_id);
 perform public.marketplace_record_courier_shipment(o.id,'Synthetic carrier','TEST',gen_random_uuid());
 perform pg_temp.bc_assert(public.marketplace_cancel_order(o.id,'seller_scheduling_issue','Too late',gen_random_uuid())->>'errorCode'='order_not_cancellable','shipment cutoff');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.order_protection where order_id=o.id),'Shipped is not possession');
end;$$;

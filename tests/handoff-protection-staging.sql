create function pg_temp.bc_paid(fulfillment text) returns public.orders language plpgsql as $$
declare terms jsonb;o public.orders;reply jsonb;begin
if fulfillment='on_campus' then
terms:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Synthetic campus',
'scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours');
else terms:=jsonb_build_object('item_amount_cents',10000,'fulfillment','delivery','delivery_method',fulfillment,'delivery_fee_cents',1000,
'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A'));end if;
o:=pg_temp.bc_accept(terms,true);
if fulfillment='on_campus' then perform public.marketplace_confirm_campus_inspection(o.id,gen_random_uuid());
else perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Rollback synthetic street"}');end if;
reply:=public.marketplace_start_order_payment(o.id,gen_random_uuid());
perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
perform public.marketplace_resolve_campus_payment((reply->>'attemptId')::uuid,true);
select * into o from public.orders where id=o.id;return o;
end;$$;
do $$declare o public.orders;cred jsonb;reply jsonb;cmd uuid;wrong text;v text;i integer;case_id uuid;deadline timestamptz;begin
perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','bc_fixture','bc_method','Test Card','1234');
foreach v in array array['on_campus','seller_delivery'] loop
o:=pg_temp.bc_paid(v);perform pg_temp.bc_actor((select buyer from bc_people));
cred:=public.marketplace_handoff_credential(o.id);
perform pg_temp.bc_assert(cred->>'available'='true' and cred->>'qrToken' ~ '^[0-9a-f]{64}$' and cred->>'code' ~ '^[0-9]{6}$','Buyer receives independent opaque QR and numeric fallback');
perform pg_temp.bc_reject(format('select public.marketplace_verify_handoff(%L,''qr'',%L,%L)',o.id,cred->>'qrToken',gen_random_uuid()),'42501');
perform pg_temp.bc_actor((select outsider from bc_people));perform pg_temp.bc_reject(format('select public.marketplace_handoff_credential(%L)',o.id),'42501');
perform pg_temp.bc_actor((select seller from bc_people));perform pg_temp.bc_reject(format('select public.marketplace_handoff_credential(%L)',o.id),'42501');
wrong:=lpad((((cred->>'code')::integer+1)%1000000)::text,6,'0');
for i in 1..5 loop reply:=public.marketplace_verify_handoff(o.id,'code',wrong,gen_random_uuid());
perform pg_temp.bc_assert(reply->>'verified'='false','incorrect numeric code rejected');end loop;
reply:=public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
perform pg_temp.bc_assert(reply->>'errorCode'='numeric_temporarily_locked','fifth failure locks numeric for 15 minutes');
perform pg_temp.bc_assert(exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id and numeric_failures=5 and numeric_locked_until>=numeric_window_started_at+interval '15 minutes'),'committed failure/rate evidence');
cmd:=gen_random_uuid();reply:=public.marketplace_verify_handoff(o.id,'qr',cred->>'qrToken',cmd);
perform pg_temp.bc_assert(reply->>'verified'='true','QR remains independently usable under numeric lock');
perform pg_temp.bc_assert(public.marketplace_verify_handoff(o.id,'qr',cred->>'qrToken',cmd)=reply,'same command verification replay');
perform pg_temp.bc_assert(public.marketplace_verify_handoff(o.id,'qr',cred->>'qrToken',gen_random_uuid())->>'errorCode'='handoff_already_redeemed','QR new-command replay rejected');
perform pg_temp.bc_assert(public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid())->>'errorCode'='handoff_already_redeemed','both channels invalidated');
perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='handoff_confirmed') and
(select count(*)=1 from public.transaction_events where order_id=o.id and event_type='protection_started'),'handoff/protection exactly once');
perform pg_temp.bc_assert(exists(select 1 from marketplace_private.order_protection where order_id=o.id and expires_at=started_at+interval '24 hours'),'exact 24-hour server deadline');
perform marketplace_private.settle_order_protection(o.listing_id);
perform pg_temp.bc_assert(exists(select 1 from public.orders where id=o.id and lifecycle_status='open' and payout_status='not_eligible'),'no early payout/completion');
perform pg_temp.bc_actor((select buyer from bc_people));
perform pg_temp.bc_assert(public.marketplace_handoff_credential(o.id)->>'available'='false','redeemed credentials no longer exposed');
if v='on_campus' then
cmd:=gen_random_uuid();reply:=public.marketplace_open_protection_case(o.id,'WRONG_ITEM',cmd);
perform pg_temp.bc_assert(public.marketplace_open_protection_case(o.id,'WRONG_ITEM',cmd)=reply,'case idempotency');
perform pg_temp.bc_reject(format('select public.marketplace_open_protection_case(%L,''ITEM_NOT_RECEIVED'',%L)',o.id,gen_random_uuid()),'23505');
update marketplace_private.order_protection set started_at=clock.t-interval '25 hours',expires_at=clock.t-interval '1 hour' from(select clock_timestamp() t) clock where order_id=o.id;
perform marketplace_private.settle_order_protection(o.listing_id);
perform pg_temp.bc_assert(exists(select 1 from public.orders where id=o.id and lifecycle_status='open' and holds_listing and payout_status='not_eligible'),'case hold blocks mature completion/payout');
else
update marketplace_private.order_protection set started_at=clock.t-interval '25 hours',expires_at=clock.t-interval '1 hour' from(select clock_timestamp() t) clock where order_id=o.id;
perform marketplace_private.settle_order_protection(o.listing_id);perform marketplace_private.settle_order_protection(o.listing_id);
perform pg_temp.bc_assert(exists(select 1 from public.orders where id=o.id and lifecycle_status='completed' and not holds_listing and payout_status='eligible'),'mature unheld Protection completes once');
perform pg_temp.bc_assert(exists(select 1 from public.listings where id=o.listing_id and status='sold' and reserved_order_id is null),'only completed transaction sells Listing');
perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='order_completed'),'completion event cardinality');
perform pg_temp.bc_assert(exists(select 1 from public.order_requests where id=o.request_id and status='accepted'),'accepted Offer retained');
perform pg_temp.bc_reject(format('select public.marketplace_open_protection_case(%L,''WRONG_ITEM'',%L)',o.id,gen_random_uuid()),'23505');
end if;
end loop;
perform pg_temp.bc_assert(not has_table_privilege('authenticated','marketplace_private.handoff_key','SELECT') and not has_table_privilege('service_role','marketplace_private.handoff_authorizations','SELECT'),'safe private cryptographic storage');
perform pg_temp.bc_assert(not exists(select 1 from public.transaction_events where metadata ? 'qrToken' or metadata ? 'code'),'no credential event leak');
end;$$;

-- Disposable-only B31 concurrency fixtures.  This file runs in the same
-- session as delivery-area-economics-staging.sql, after its helper functions.
-- It intentionally creates no production schema objects outside this test DB.
create table public.b31_concurrency_fixture(
  name text primary key,
  order_id uuid not null,
  listing_id uuid not null,
  buyer_id uuid not null,
  seller_id uuid not null,
  command_id uuid not null
);

do $$
declare
  terms jsonb := jsonb_build_object(
    'item_amount_cents',10000,'fulfillment','delivery',
    'delivery_method','seller_delivery','delivery_fee_cents',1000,
    'delivery_area',jsonb_build_object('country_code','CA','province_code','ON',
      'city_label','London','postal_prefix','N6A')
  );
  o public.orders;
  cred jsonb;
  receipt_cmd uuid := gen_random_uuid();
  buyer uuid := (select buyer from bc_people);
  seller uuid := (select seller from bc_people);
begin
  -- Order used by two independent sessions for duplicate Buyer Receipt.
  o := pg_temp.bc_accept(terms,true);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_save_delivery_address(o.id,
    '{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','b31_concurrency','b31_method','Test Card','1234');
  perform public.marketplace_start_order_payment(o.id,gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment((select id from marketplace_private.campus_payment_attempts where order_id=o.id),true);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(buyer);
  cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  insert into public.b31_concurrency_fixture values('receipt',o.id,o.listing_id,buyer,seller,receipt_cmd);

  -- Separate matured order used by two independent settlement sessions.
  o := pg_temp.bc_accept(terms,true);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_save_delivery_address(o.id,
    '{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','b31_concurrency','b31_method2','Test Card','1234');
  perform public.marketplace_start_order_payment(o.id,gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment((select id from marketplace_private.campus_payment_attempts where order_id=o.id),true);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(buyer);
  cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor(seller);
  perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
  update marketplace_private.order_protection p
     set started_at=c.t-interval '48 hours 1 second',
         expires_at=c.t-interval '1 second',
         buyer_confirmed_at=c.t-interval '48 hours 1 second',
         release_eligible_at=c.t-interval '1 second'
    from (select clock_timestamp() t) c
   where p.order_id=o.id;
  -- Transfer lease fixture: establish the same trusted test-mode seller
  -- binding and payment evidence that claim_due validates before leasing.
  insert into marketplace_private.stripe_bindings(
    user_id,kind,platform,mode,owner_ref,status,label,last4,synced_at)
  values(seller,'payout_account','acct_b31platform','test','acct_b31seller',
    'ready','B31 synthetic seller','6789',clock_timestamp())
  on conflict(user_id,kind,platform,mode) do update set
    owner_ref=excluded.owner_ref,status=excluded.status,label=excluded.label,
    last4=excluded.last4,synced_at=excluded.synced_at;
  update marketplace_private.campus_payment_attempts a
     set provider='stripe',provider_mode='test',provider_platform='acct_b31platform',
         provider_purpose='marketplace_order',provider_operation_id=gen_random_uuid(),
         provider_idempotency_key='uu:test:acct_b31platform:order:b31settle',
         provider_customer_ref='cus_b31buyer',provider_instrument_ref='pm_b31card',
         provider_seller_account_ref='acct_b31seller',
         provider_amount_cents=(select buyer_total_cents from marketplace_private.v2_order_economics where order_id=o.id),
         provider_currency='CAD',provider_transfer_group='uu_order_'||o.id::text,
         provider_reference='pi_b31settle',provider_bound_at=clock_timestamp(),
         provider_status='succeeded',provider_observed_at=clock_timestamp(),
         provider_evidence_id='evt_b31settle',provider_reconcile_state='applied'
   where a.order_id=o.id and a.status='paid';
  insert into public.b31_concurrency_fixture values('settlement',o.id,o.listing_id,buyer,seller,gen_random_uuid());

  -- Independent open protection-case order.  The case is created later while
  -- its protection window is still open, then time is advanced in the test.
  o := pg_temp.bc_accept(terms,true);
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','b31_concurrency','b31_method3','Test Card','1234');
  perform public.marketplace_start_order_payment(o.id,gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment((select id from marketplace_private.campus_payment_attempts where order_id=o.id),true);
  perform pg_temp.bc_actor(seller); perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(buyer); cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
  insert into public.b31_concurrency_fixture values('case',o.id,o.listing_id,buyer,seller,gen_random_uuid());

  -- Separate case-vs-settlement race order. It remains open until the CI step
  -- advances its protection timestamps after due-work has finished.
  o := pg_temp.bc_accept(terms,true);
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','b31_concurrency','b31_method5','Test Card','1234');
  perform public.marketplace_start_order_payment(o.id,gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment((select id from marketplace_private.campus_payment_attempts where order_id=o.id),true);
  perform pg_temp.bc_actor(seller); perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(buyer); cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
  insert into public.b31_concurrency_fixture values('case_race',o.id,o.listing_id,buyer,seller,gen_random_uuid());

  -- Independent prepared-refund order, already mature after receipt.
  o := pg_temp.bc_accept(terms,true);
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor(buyer);
  perform public.marketplace_save_delivery_address(o.id,'{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','b31_concurrency','b31_method4','Test Card','1234');
  perform public.marketplace_start_order_payment(o.id,gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  perform public.marketplace_resolve_campus_payment((select id from marketplace_private.campus_payment_attempts where order_id=o.id),true);
  perform pg_temp.bc_actor(seller); perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());
  perform pg_temp.bc_actor(buyer); cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor(seller); perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  perform pg_temp.bc_actor(buyer); perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
  update marketplace_private.order_protection p
     set started_at=c.t-interval '48 hours 1 second',expires_at=c.t-interval '1 second',
         buyer_confirmed_at=c.t-interval '48 hours 1 second',release_eligible_at=c.t-interval '1 second'
    from (select clock_timestamp() t)c where p.order_id=o.id;
  insert into marketplace_private.order_refund_operations(
    order_id,payment_attempt_id,provider,provider_mode,provider_platform,payment_intent_ref,
    amount_cents,currency,operation_id,idempotency_key,state)
  values(o.id,(select id from marketplace_private.campus_payment_attempts where order_id=o.id and status='paid'),
    'stripe','test','acct_b31platform','pi_b31refund',1,'CAD',
    '00000000-0000-0000-0000-00000000b312'::uuid,
    'uu:test:acct_b31platform:refund:00000000-0000-0000-0000-00000000b312','prepared');
  insert into public.b31_concurrency_fixture values('refund',o.id,o.listing_id,buyer,seller,gen_random_uuid());
end $$;

select name,order_id,listing_id,buyer_id,seller_id,command_id
  from public.b31_concurrency_fixture order by name;

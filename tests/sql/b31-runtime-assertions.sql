-- B31 rollback-only runtime assertions. The workflow prepends the existing
-- delivery-area fixture, which provides bc_people, bc_actor, bc_accept and
-- bc_reject in the same PostgreSQL session.
create function pg_temp.b31_paid_delivery() returns public.orders
language plpgsql as $$
declare
  terms jsonb := jsonb_build_object(
    'item_amount_cents', 10000,
    'fulfillment', 'delivery',
    'delivery_method', 'seller_delivery',
    'delivery_fee_cents', 1000,
    'delivery_area', jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A')
  );
  o public.orders;
  payment jsonb;
begin
  o := pg_temp.bc_accept(terms, true);
  -- Agreement confirmation is a required precondition for address/payment.
  perform pg_temp.bc_actor((select buyer from bc_people));
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor((select seller from bc_people));
  perform public.marketplace_confirm_order_agreement(o.id);
  perform pg_temp.bc_actor((select buyer from bc_people));
  perform public.marketplace_save_delivery_address(o.id, '{"country_code":"CA","province_code":"ON","city":"London","postal_code":"N6A1A1","street":"Synthetic Test St"}'::jsonb);
  perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','b31_runtime','b31_method','Test Card','1234');
  payment := public.marketplace_start_order_payment(o.id, gen_random_uuid());
  perform set_config('request.jwt.claims', '{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}', true);
  perform public.marketplace_resolve_campus_payment((payment->>'attemptId')::uuid, true);
  select * into o from public.orders where id=o.id;
  -- Seller-delivery handoff credentials are unavailable until the seller
  -- records the authoritative delivery-start milestone.
  perform pg_temp.bc_actor((select seller from bc_people));
  perform public.marketplace_start_seller_delivery(o.id, gen_random_uuid());
  return o;
end; $$;

do $$
declare
  o public.orders;
  cred jsonb;
  handoff_command uuid := gen_random_uuid();
  receipt_command uuid := gen_random_uuid();
  reply jsonb;
begin
  -- Paid order: only the buyer can confirm, and confirmation starts 48 hours.
  o := pg_temp.b31_paid_delivery();
  perform pg_temp.bc_actor((select buyer from bc_people));
  cred := public.marketplace_handoff_credential(o.id);
  -- Buyer identity is valid, but delivery/handoff is not yet confirmed.
  perform pg_temp.bc_reject(format('select public.marketplace_confirm_buyer_receipt(%L,%L)',o.id,gen_random_uuid()),'23505');
  perform pg_temp.bc_actor((select seller from bc_people));
  reply := public.marketplace_verify_handoff(o.id,'code',cred->>'code',handoff_command);
  perform pg_temp.bc_assert(reply->>'verified'='true','seller handoff verification succeeds');
  perform pg_temp.bc_assert(exists(
    select 1 from marketplace_private.order_protection
    where order_id=o.id and buyer_confirmed_at is null and expires_at=started_at+interval '24 hours'
  ),'legacy handoff keeps a 24-hour pre-receipt record');
  perform pg_temp.bc_reject(format('select public.marketplace_confirm_buyer_receipt(%L,%L)',o.id,gen_random_uuid()),'42501');
  perform pg_temp.bc_actor((select outsider from bc_people));
  perform pg_temp.bc_reject(format('select public.marketplace_confirm_buyer_receipt(%L,%L)',o.id,gen_random_uuid()),'42501');
  perform pg_temp.bc_actor((select buyer from bc_people));
  reply := public.marketplace_confirm_buyer_receipt(o.id,receipt_command);
  perform pg_temp.bc_assert(reply->>'received'='true' and (reply->>'releaseEligibleAt')::timestamptz=(reply->>'confirmedAt')::timestamptz+interval '48 hours','buyer receipt starts 48-hour clock');
  perform pg_temp.bc_assert(public.marketplace_confirm_buyer_receipt(o.id,receipt_command)->>'idempotent'='true','receipt replay is idempotent');
  begin
    update marketplace_private.order_protection
      set release_eligible_at=buyer_confirmed_at+interval '47 hours'
      where order_id=o.id;
    raise exception 'shortened release window unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  -- 47:59 remains held; exactly 48 hours is eligible and settles once.
  update marketplace_private.order_protection p
    set started_at=c.t-interval '47 hours 59 minutes', expires_at=c.t+interval '1 minute',
        buyer_confirmed_at=c.t-interval '47 hours 59 minutes', release_eligible_at=c.t+interval '1 minute'
    from (select clock_timestamp() t) c where p.order_id=o.id;
  perform marketplace_private.settle_order_protection(o.listing_id);
  perform pg_temp.bc_assert((select lifecycle_status='open' and payout_status='not_eligible' from public.orders where id=o.id),'47:59 remains protected');
  update marketplace_private.order_protection p
    set started_at=c.t-interval '48 hours 1 second', expires_at=c.t-interval '1 second',
        buyer_confirmed_at=c.t-interval '48 hours 1 second', release_eligible_at=c.t-interval '1 second'
    from (select clock_timestamp() t) c where p.order_id=o.id;
  perform marketplace_private.settle_order_protection(o.listing_id);
  perform marketplace_private.settle_order_protection(o.listing_id);
  perform pg_temp.bc_assert((select lifecycle_status='completed' and payout_status='eligible' and not holds_listing from public.orders where id=o.id),'48-hour release settles once');

  -- Unpaid orders cannot enter receipt protection.
  o := pg_temp.bc_accept(jsonb_build_object('item_amount_cents',8000,'fulfillment','delivery','delivery_method','seller_delivery','delivery_fee_cents',1000,'delivery_area',jsonb_build_object('country_code','CA','province_code','ON','city_label','London','postal_prefix','N6A')), true);
  perform pg_temp.bc_actor((select buyer from bc_people));
  begin
    perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
    raise exception 'unpaid receipt unexpectedly succeeded';
  exception when others then
    if sqlstate not in ('23505','42501') then raise; end if;
  end;

  -- An active protection case blocks an otherwise mature release.
  o := pg_temp.b31_paid_delivery();
  perform pg_temp.bc_actor((select buyer from bc_people));
  cred := public.marketplace_handoff_credential(o.id);
  perform pg_temp.bc_actor((select seller from bc_people));
  perform public.marketplace_verify_handoff(o.id,'code',cred->>'code',gen_random_uuid());
  perform pg_temp.bc_actor((select buyer from bc_people));
  perform public.marketplace_confirm_buyer_receipt(o.id,gen_random_uuid());
  reply := public.marketplace_open_protection_case(o.id,'WRONG_ITEM',gen_random_uuid());
  perform pg_temp.bc_assert(reply->>'state'='resolution_required','protection case opens');
  update marketplace_private.order_protection p
    set started_at=c.t-interval '48 hours 1 second', expires_at=c.t-interval '1 second',
        buyer_confirmed_at=c.t-interval '48 hours 1 second', release_eligible_at=c.t-interval '1 second'
    from (select clock_timestamp() t) c where p.order_id=o.id;
  perform marketplace_private.settle_order_protection(o.listing_id);
  perform pg_temp.bc_assert((select lifecycle_status='open' and holds_listing and payout_status='not_eligible' from public.orders where id=o.id),'active case blocks release');
end $$;

set constraints all immediate;
rollback;

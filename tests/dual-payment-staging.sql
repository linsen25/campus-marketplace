create temporary table bc_people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'bc_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','BC_'||left(replace(id::text,'-',''),12))
from bc_people cross join lateral(values(seller),(buyer),(outsider)) v(id);
create function pg_temp.bc_actor(id uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.bc_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is not true then raise exception 'Backend contract assertion: %',label;end if;end;$$;
create function pg_temp.bc_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
if sqlstate=expected then return;end if;raise exception 'Wrong SQLSTATE %, expected %',sqlstate,expected;end;
raise exception 'Unexpected success: %',statement;end;$$;
alter table public.listings disable trigger listings_publication_boundary;
-- Fixture media below is a rollback-only SQL receipt, not a real upload claim.
create function pg_temp.bc_accept(terms jsonb,seller_origin boolean default false) returns public.orders
language plpgsql as $$
declare seller uuid;buyer uuid;lid uuid;cid uuid;r public.order_requests;o public.orders;
batch uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();command uuid:=gen_random_uuid();
begin
select p.seller,p.buyer into seller,buyer from bc_people p;
perform pg_temp.bc_actor(seller);
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
values(seller,'Dual payment rollback fixture','Synthetic backend qualification',greatest(50000,(terms->>'item_amount_cents')::bigint),'CAD','Electronics','Computers & Tablets','good','Western University',1,clock_timestamp()) returning id into lid;
perform pg_temp.bc_actor(buyer);select id into cid from public.marketplace_find_or_create_conversation(lid);
perform pg_temp.bc_actor(case when seller_origin then seller else buyer end);
select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());
perform pg_temp.bc_actor(r.recipient_user_id);
insert into marketplace_private.order_media_batches(id,offer_id,listing_id,actor_id,buyer_id,seller_id,command_id,material_hash,state,manifest)
values(batch,r.id,lid,r.recipient_user_id,buyer,seller,command,r.listing_material_hash_at_offer,'prepared',jsonb_build_array(jsonb_build_object('id',asset,'path','synthetic','slot',1)));
insert into marketplace_private.order_media_assets(id,batch_id,source_media_id,source_path,position,mime_type,size_bytes,sha256,verified_at)
values(asset,batch,asset,'synthetic',1,'image/png',10,repeat('0',64),clock_timestamp());
insert into storage.objects(bucket_id,name,metadata) values('order-snapshot-media',batch::text||'/'||asset::text,'{"mimetype":"image/png","size":10}');
select * into o from public.marketplace_accept_offer(r.id,command,batch);return o;
end;$$;

create function pg_temp.dual_agree(oid uuid) returns void language plpgsql as $$begin
 perform pg_temp.bc_actor((select buyer from bc_people));perform public.marketplace_confirm_order_agreement(oid);
 perform pg_temp.bc_actor((select seller from bc_people));perform public.marketplace_confirm_order_agreement(oid);
end;$$;
do $$declare terms jsonb;o public.orders;o2 public.orders;r jsonb;k uuid:=gen_random_uuid();begin
 terms:=jsonb_build_object('item_amount_cents',10000,'fulfillment','on_campus','meetup_location','Synthetic location','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode','external','payment_mode_version',1);
 perform pg_temp.bc_assert(marketplace_private.payment_mode('{}')='uu_pay','legacy defaults UU');
 perform pg_temp.bc_reject(format('select marketplace_private.validate_offer_terms(%L)',jsonb_set(terms,'{fulfillment}','"delivery"')),'23514');
 perform pg_temp.bc_reject(format('select marketplace_private.validate_offer_terms(%L)',terms||'{"payment_mode_version":2}'),'23514');

 perform pg_temp.bc_assert(marketplace_private.offer_changed_fields(terms,terms-'payment_mode'-'payment_mode_version') ? 'Payment method','new versus legacy changed method');
 perform pg_temp.bc_assert(not(marketplace_private.offer_changed_fields(jsonb_set(terms,'{payment_mode}','"uu_pay"'),terms-'payment_mode'-'payment_mode_version') ? 'Payment method'),'UU legacy comparison unchanged');
 -- Neither synthetic participant has a financial capability. Seller-origin independent Offer/Accept must work.
 o:=pg_temp.bc_accept(terms,true);
 r:=public.marketplace_order_economics(o.id);
 perform pg_temp.bc_assert(r->>'fee'='0' and r->>'total'='10000','zero external fee');
 perform pg_temp.bc_reject(format('select public.marketplace_confirm_external_exchange(%L,%L)',o.id,k),'23505');
 perform pg_temp.dual_agree(o.id);
 perform pg_temp.bc_actor((select outsider from bc_people));
 perform pg_temp.bc_reject(format('select public.marketplace_confirm_external_exchange(%L,%L)',o.id,k),'42501');
 perform pg_temp.bc_actor((select buyer from bc_people));
 r:=public.marketplace_confirm_external_exchange(o.id,k);
 perform pg_temp.bc_assert(r->>'status'='buyer_confirmed','one-party explicit state');
 perform pg_temp.bc_assert(public.marketplace_confirm_external_exchange(o.id,k)=r,'retry idempotent');
 perform pg_temp.bc_assert(not marketplace_private.meetup_mutable(o),'no expiry or reschedule after attestation');
 perform pg_temp.bc_assert(not marketplace_private.order_cancel_before_cutoff(o),'no cancellation after attestation');
 perform pg_temp.bc_assert(public.marketplace_cancel_order(o.id,'buyer_changed_mind','',gen_random_uuid())->>'errorCode'='order_not_cancellable','cancel blocked');
 perform pg_temp.bc_reject(format('select public.marketplace_start_order_payment(%L,%L)',o.id,gen_random_uuid()),'23514');
 perform pg_temp.bc_actor((select seller from bc_people));r:=public.marketplace_confirm_external_exchange(o.id,gen_random_uuid());
 perform pg_temp.bc_assert(r->>'status'='confirmed','both attestations');
 select * into o2 from public.orders where id=o.id;
 perform pg_temp.bc_assert(o2.lifecycle_status='completed' and not o2.holds_listing and o2.payment_status='pending' and o2.payment_paid_at is null and o2.payout_status='not_eligible','Completed without Paid/payout');
 perform pg_temp.bc_assert((select status='sold' and reserved_order_id is null from public.listings where id=o.listing_id),'sold only after both');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.order_protection where order_id=o.id) and not exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id) and not exists(select 1 from marketplace_private.order_settlement_authorizations where order_id=o.id),'no protection/handoff/settlement');
 -- Zero confirmations: cancellation releases inventory without settlement authorization.
 o:=pg_temp.bc_accept(terms);perform pg_temp.bc_actor((select buyer from bc_people));
 r:=public.marketplace_cancel_order(o.id,'buyer_changed_mind','',gen_random_uuid());
 perform pg_temp.bc_assert(r#>>'{order,lifecycle_status}'='cancelled','zero-confirmation cancellation');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.order_settlement_authorizations where order_id=o.id),'cancel no refund authorization');

 -- Legacy/default UU path retains its financial gate and frozen fee.
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','dual_fixture','dual_payout','Synthetic bank','1234');
 o:=pg_temp.bc_accept(terms-'payment_mode'-'payment_mode_version');
 perform pg_temp.bc_assert(o.terms_snapshot#>>'{terms,payment_mode}'='uu_pay','new legacy-shaped input stamped UU');
 perform pg_temp.bc_assert(public.marketplace_order_economics(o.id)->>'fee'='100','UU versioned fee retained');
 -- Synthetic schedule mutation only to exercise past-grace expiry without waiting.
 o:=pg_temp.bc_accept(terms);
 set constraints all immediate;
 alter table public.order_meetup_revisions disable trigger order_meetup_guard;
 alter table public.order_meetup_revisions disable trigger order_meetup_event;
 update public.order_meetup_revisions set scheduled_at=date_trunc('hour',clock_timestamp())-interval '2 hours' where order_id=o.id;
 alter table public.order_meetup_revisions enable trigger order_meetup_guard;
 alter table public.order_meetup_revisions enable trigger order_meetup_event;
 set constraints all deferred;
 perform marketplace_private.settle_order_meetup(o.listing_id);
 perform pg_temp.bc_assert((select lifecycle_status='expired' and not holds_listing from public.orders where id=o.id),'zero-confirmation no-show expiry releases hold');
 o:=pg_temp.bc_accept(terms);perform pg_temp.dual_agree(o.id);perform pg_temp.bc_actor((select buyer from bc_people));
 perform public.marketplace_confirm_external_exchange(o.id,gen_random_uuid());
 set constraints all immediate;
 alter table public.order_meetup_revisions disable trigger order_meetup_guard;
 alter table public.order_meetup_revisions disable trigger order_meetup_event;
 update public.order_meetup_revisions set scheduled_at=date_trunc('hour',clock_timestamp())-interval '2 hours' where order_id=o.id;
 alter table public.order_meetup_revisions enable trigger order_meetup_guard;
 alter table public.order_meetup_revisions enable trigger order_meetup_event;
 set constraints all deferred;
 perform marketplace_private.settle_order_meetup(o.listing_id);
 perform pg_temp.bc_assert((select lifecycle_status='open' and holds_listing from public.orders where id=o.id),'one-confirmation no-show does not release');
 -- Disagreement cannot silently resolve/release/sell or produce financial protection.
 o:=pg_temp.bc_accept(terms);perform pg_temp.dual_agree(o.id);
 perform pg_temp.bc_actor((select seller from bc_people));perform public.marketplace_confirm_external_exchange(o.id,gen_random_uuid());
 perform pg_temp.bc_actor((select buyer from bc_people));r:=public.marketplace_dispute_external_exchange(o.id,'Exchange did not occur',gen_random_uuid());
 perform pg_temp.bc_assert(r->>'status'='disputed','nonfinancial disagreement');
 perform pg_temp.bc_reject(format('select public.marketplace_confirm_external_exchange(%L,%L)',o.id,gen_random_uuid()),'23505');
 perform pg_temp.bc_assert((select holds_listing and lifecycle_status='open' from public.orders where id=o.id),'dispute holds inventory');
 perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.protection_cases where order_id=o.id),'no financial Case');
 perform pg_temp.bc_assert(not has_table_privilege('authenticated','marketplace_private.external_exchanges','SELECT'),'private confirmation storage');
end;$$;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
select 'PASS dual payment validation, zero readiness/fee, mutual Agreement, external attestations, completion/inventory, cancellation, dispute, private access' result;

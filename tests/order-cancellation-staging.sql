-- Entire fixture graph is transaction-local; canonical demo accounts/capabilities untouched.
begin;
create temporary table people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
 select id,'cancel_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','Cancel_'||left(replace(id::text,'-',''),12))
 from people cross join lateral(values(seller),(buyer),(outsider)) v(id);
select public.marketplace_record_financial_capability(seller,'payout_account','ready','staging_test','cancel_owner','cancel_payout','Test Bank','6789') from people;
select public.marketplace_record_financial_capability(buyer,'payment_method','set','staging_test','cancel_owner','cancel_method','Test Card','4242') from people;
create temporary table fixtures(label text primary key,oid uuid,lid uuid,rid uuid,cid uuid);
create function pg_temp.ensure(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'Cancellation test: %',label; end if; end;$$;
create function pg_temp.actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.fixture(label text,pending boolean default false) returns uuid language plpgsql as $$
declare lid uuid; cid uuid; r public.order_requests; o public.orders; again public.orders; accept_key uuid:=gen_random_uuid();
begin
  perform pg_temp.actor((select seller from people));
  insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
    select (select seller from people),'Cancellation rollback fixture','Rollback only',price_cents,currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
      from public.listings where title like '%Nike%' limit 1 returning id into lid;
  perform pg_temp.actor((select buyer from people));
  select id into cid from public.marketplace_find_or_create_conversation(lid);
  perform pg_temp.actor((select seller from people));
  select * into r from public.marketplace_create_order_request(cid,
    jsonb_build_object('item_amount_cents',8000,'fulfillment_type','shipping','shipping_cost_mode',case when pending then 'pending' else 'included' end),gen_random_uuid());
  perform pg_temp.actor((select buyer from people));
  select * into o from public.marketplace_accept_order_request(r.id,accept_key);
  select * into again from public.marketplace_accept_order_request(r.id,accept_key);
  perform pg_temp.ensure(o.id=again.id and o.reservation_expires_at is not distinct from again.reservation_expires_at,'Accept idempotent Order identity/deadline');
  perform pg_temp.ensure((select count(*)=1 from public.orders where request_id=r.id),'one authoritative Order');
  perform pg_temp.ensure((select status='accepted' from public.order_requests where id=r.id),'Request Accepted');
  perform pg_temp.ensure((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='order_created'),'one Order creation event');
  insert into fixtures values(label,o.id,lid,r.id,cid);
  return o.id;
end;$$;
-- Only synthetic listing publication omits image fixtures. Restored before rollback.
alter table public.listings disable trigger listings_publication_boundary;
do $$declare oid uuid; response jsonb; original jsonb; key uuid:=gen_random_uuid(); before_messages bigint; label text; pending boolean;
begin
  select count(*) into before_messages from public.messages;
  for label,pending in select * from(values('buyer',false),('seller',false),('pending',true)) v loop
    oid:=pg_temp.fixture(label,pending);
    perform pg_temp.actor((select outsider from people));
    begin perform public.marketplace_cancel_order(oid,'other','test',gen_random_uuid()); raise exception 'Outsider accepted'; exception when insufficient_privilege then null; end;
    perform pg_temp.actor((select buyer from people));
    begin perform public.marketplace_cancel_order(oid,'seller_item_unavailable','',gen_random_uuid()); raise exception 'Wrong role reason accepted'; exception when check_violation then null; end;
    begin perform public.marketplace_cancel_order(oid,'other',' ',gen_random_uuid()); raise exception 'Other blank accepted'; exception when check_violation then null; end;
    if label='seller' then perform pg_temp.actor((select seller from people)); end if;
    response:=public.marketplace_cancel_order(oid,case when label='seller' then 'seller_item_unavailable' else 'buyer_changed_mind' end,'Testing cancellation',key);
    original:=response->'order';
    perform pg_temp.ensure(original->>'lifecycle_status'='cancelled','Buyer/Seller/pending cancellation');
    perform pg_temp.ensure((select status='accepted' from public.order_requests where id=(original->>'request_id')::uuid),'Request remains Accepted');
    perform pg_temp.ensure((select status='available' and reserved_order_id is null from public.listings where id=(original->>'listing_id')::uuid),'Listing released/available');
    perform pg_temp.ensure((select count(*)=1 from public.transaction_events where order_id=oid and event_type='order_cancelled'),'one immutable event');
    response:=public.marketplace_cancel_order(oid,case when label='seller' then 'seller_item_unavailable' else 'buyer_changed_mind' end,'Testing cancellation',key);
    perform pg_temp.ensure(response->'order'=original,'same-key idempotency timestamp/reason');
    response:=public.marketplace_cancel_order(oid,'other','Different later reason',gen_random_uuid());
    perform pg_temp.ensure(response->'order'=original,'different retry cannot rewrite history');
    perform pg_temp.ensure(public.marketplace_order_detail(oid)->'order'=original,'history detail accessible');
    perform marketplace_private.settle_listing_reservation((original->>'listing_id')::uuid);
    perform pg_temp.ensure((select lifecycle_status='cancelled' from public.orders where id=oid),'Cancel before expiry remains cancelled');
    key:=gen_random_uuid();
  end loop;
  oid:=pg_temp.fixture('cancel-first');
  response:=public.marketplace_cancel_order(oid,'other','Cancel first',gen_random_uuid());
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  response:=public.marketplace_simulate_order_payment_success(oid,(select buyer from people),gen_random_uuid());
  perform pg_temp.ensure(response->>'errorCode'='order_not_payment_ready','Cancel winner rejects payment');
  oid:=pg_temp.fixture('payment-first');
  perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
  response:=public.marketplace_simulate_order_payment_success(oid,(select buyer from people),gen_random_uuid());
  perform pg_temp.ensure(response->'order'->>'payment_status'='paid','Payment first succeeds');
  perform pg_temp.actor((select seller from people));
  response:=public.marketplace_cancel_order(oid,'other','After paid',gen_random_uuid());
  perform pg_temp.ensure(response->>'errorCode'='order_not_cancellable','Paid winner rejects Cancel');
  perform pg_temp.ensure((select holds_listing and lifecycle_status='open' and payment_status='paid' from public.orders where id=oid),'Paid reservation preserved');
  perform pg_temp.ensure((select count(*)=before_messages from public.messages),'No cancellation TEXT message');
end;$$;
-- Isolated expired synthetic Order; exact deadlines cannot be forged by app users.
select pg_temp.fixture('expiry-first');
set constraints all immediate;
alter table public.orders disable trigger orders_immutable;
with t as(select clock_timestamp()-interval '31 minutes' started)
update public.orders set created_at=t.started,accepted_at=t.started,reservation_started_at=t.started,reservation_expires_at=t.started+interval '30 minutes'
from t where id=(select oid from fixtures where label='expiry-first');
alter table public.orders enable trigger orders_immutable;
select pg_temp.actor((select buyer from people));
select pg_temp.ensure(public.marketplace_cancel_order((select oid from fixtures where label='expiry-first'),'other','Expired',gen_random_uuid())->>'errorCode'='order_not_cancellable','Expiry winner rejects cancellation');
select pg_temp.ensure((select lifecycle_status='expired' from public.orders where id=(select oid from fixtures where label='expiry-first')),'Expiry committed inside boundary');
select pg_temp.ensure((select count(*)=1 from public.transaction_events where order_id=(select oid from fixtures where label='expiry-first') and event_type='reservation_expired'),'single terminal expiry event');
select pg_temp.ensure((select count(*)=0 from public.orders where lifecycle_status='cancelled' and payment_status='paid'),'never Paid + Cancelled');
select pg_temp.ensure(not has_function_privilege('anon','public.marketplace_cancel_order(uuid,text,text,uuid)','execute'),'anonymous denied');
select pg_temp.ensure(has_function_privilege('authenticated','public.marketplace_cancel_order(uuid,text,text,uuid)','execute'),'authenticated guarded RPC');
alter table public.listings enable trigger listings_publication_boundary;
rollback;

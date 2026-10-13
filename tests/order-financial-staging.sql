-- All mutations, including real demo Request isolation, roll back.
begin;
create temporary table accept_people as select
 (select id from public.profiles where username='Demo_seller_a') seller,
 (select id from public.profiles where username='Demo_buyer_a') buyer,
 (select id from public.profiles where username='Demo_buyer_b') other_buyer,
 (select id from public.profiles where username='Demo_seller_b') outsider;
create temporary table accept_scope(cid uuid,listing_id uuid,buyer_id uuid);
alter table public.listings disable trigger listings_publication_boundary;
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select seller_id,'Accept rollback fixture','Rollback-only backend test',price_cents,currency,category,subcategory,condition,pickup_area,1,now() from public.listings where title like '%Nike%' and seller_id=(select seller from accept_people) limit 1;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
insert into accept_scope select c.id,c.listing_id,c.buyer_id from public.marketplace_find_or_create_conversation((select id from public.listings where title='Accept rollback fixture')) c;
select set_config('request.jwt.claims',jsonb_build_object('sub',other_buyer,'role','authenticated')::text,true) from accept_people;
insert into accept_scope select c.id,c.listing_id,c.buyer_id from public.marketplace_find_or_create_conversation((select id from public.listings where title='Accept rollback fixture')) c;
create temporary table accept_ids(name text primary key,id uuid);
grant all on accept_people,accept_scope,accept_ids to authenticated;
create function pg_temp.ensure(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'Accept test: %',label; end if; end; $$;
create function pg_temp.fail_with(statement text,expected text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=expected then return; end if; raise exception 'Unexpected SQLSTATE %, expected %',sqlstate,expected; end; raise exception 'Missing expected failure: %',expected; end; $$;
select pg_temp.ensure((select count(*)=2 from accept_scope),'two real participants');
select public.marketplace_record_financial_capability((select seller from accept_people),'payout_account','ready','staging_test','test_owner','test_payout','Test Bank','6789');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from accept_people;
do $$ declare r public.order_requests; term jsonb; cid uuid; begin
 for r in select * from public.order_requests where conversation_id in(select s.cid from accept_scope s) and status='active' loop perform public.marketplace_cancel_order_request(r.id,'other','Rollback isolation',gen_random_uuid()); end loop;
 term:=jsonb_build_object('item_amount_cents',8000,'fulfillment_type','pickup','place_name','UCC rollback test','scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days');
 for cid in select s.cid from accept_scope s loop select * into r from public.marketplace_create_order_request(cid,term,gen_random_uuid()); insert into accept_ids values(case when r.buyer_id=(select buyer from accept_people) then 'request' else 'competing' end,r.id); end loop;
 perform pg_temp.fail_with(format('select public.marketplace_accept_order_request(%L,%L)',(select id from accept_ids where name='request'),gen_random_uuid()),'42501');
end; $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
do $$ declare o public.orders; again public.orders; key uuid:=gen_random_uuid(); rid uuid; begin
 select id into rid from accept_ids where name='request';
 select * into o from public.marketplace_accept_order_request(rid,key);
 select * into again from public.marketplace_accept_order_request(rid,key);
 perform pg_temp.ensure(o.id=again.id and o.reservation_expires_at=again.reservation_expires_at,'idempotent Order/deadline');
 perform pg_temp.ensure(o.holds_listing and o.reservation_expires_at=o.reservation_started_at+interval '30 minutes' and o.payment_status='pending','server reservation no payment');
 perform pg_temp.ensure((select status='accepted' and created_at=(o.terms_snapshot->>'created_at')::timestamptz from public.order_requests where id=rid),'accepted original position');
 perform pg_temp.ensure(exists(select 1 from jsonb_array_elements(public.marketplace_order_workspace('purchases')->'orders') x where x->>'id'=o.id::text),'Buyer Purchases');
 perform pg_temp.ensure(jsonb_array_length(public.marketplace_order_workspace('sales')->'orders')=0,'Buyer not Sales');
 perform pg_temp.fail_with(format('select public.marketplace_accept_order_request(%L,%L)',rid,gen_random_uuid()),'23505');
 perform pg_temp.fail_with(format('update public.orders set reservation_expires_at=now() where id=%L',o.id),'42501');
 insert into accept_ids values('order',o.id);
end; $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',other_buyer,'role','authenticated')::text,true) from accept_people;
select pg_temp.fail_with(format('select public.marketplace_accept_order_request(%L,%L)',(select id from accept_ids where name='competing'),gen_random_uuid()),'23505');
select pg_temp.ensure((select count(*)=0 from public.orders),'loser sees no Order');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from accept_people;
select pg_temp.ensure((select count(*)=0 from public.orders),'outsider RLS');
select pg_temp.fail_with(format('select public.marketplace_order_detail(%L)',(select id from accept_ids where name='order')),'42501');
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from accept_people;
select pg_temp.ensure((select count(*)=1 from public.orders where listing_id in(select listing_id from accept_scope)),'Seller same Order');
select pg_temp.fail_with(format('select public.marketplace_cancel_order_request(%L,''other'','''',%L)',(select id from accept_ids where name='request'),gen_random_uuid()),'23505');
select pg_temp.fail_with(format('select public.marketplace_replace_order_request(%L,''{}'',%L)',(select id from accept_ids where name='request'),gen_random_uuid()),'23505');
select pg_temp.fail_with(format('update public.listings set status=''sold'' where id=%L',(select listing_id from accept_scope limit 1)),'23514');
select pg_temp.fail_with(format('update public.listings set title=''changed'' where id=%L',(select listing_id from accept_scope limit 1)),'23514');
select pg_temp.fail_with(format('delete from public.listings where id=%L',(select listing_id from accept_scope limit 1)),'23514');
reset role;
-- Expiry fixture changes are administrative and transaction-local; immutable production paths remain tested above.
set constraints all immediate;
alter table public.orders disable trigger orders_immutable;
-- Use one clock for the exact timestamp equality constraint.
with t as(select clock_timestamp()-interval '31 minutes' started) update public.orders set created_at=t.started,accepted_at=t.started,reservation_started_at=t.started,reservation_expires_at=t.started+interval '30 minutes' from t where id=(select id from accept_ids where name='order');
set constraints all immediate;
alter table public.orders enable trigger orders_immutable;
select marketplace_private.settle_listing_reservation((select listing_id from accept_scope limit 1));
select pg_temp.ensure((select lifecycle_status='expired' and not holds_listing from public.orders where id=(select id from accept_ids where name='order')),'server expired Order');
select pg_temp.ensure((select status='available' and reserved_order_id is null from public.listings where id=(select listing_id from accept_scope limit 1)),'inventory released');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from accept_people;
do $$ declare r public.order_requests; begin
 select * into r from public.marketplace_create_order_request((select cid from accept_scope where buyer_id=(select buyer from accept_people)), '{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"pending"}',gen_random_uuid());
 insert into accept_ids values('pending',r.id);
end; $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
do $$ declare o public.orders; begin select * into o from public.marketplace_accept_order_request((select id from accept_ids where name='pending'),gen_random_uuid());
 perform pg_temp.ensure(not o.holds_listing and o.money_status='shipping_pending' and o.shipping_amount_cents is null and o.total_amount_cents is null and o.reservation_expires_at is null and o.reservation_started_at is null,'pending shipping no inventory/timer/false zero');
 perform pg_temp.ensure((select status='available' from public.listings where id=o.listing_id),'pending listing remains available');
end; $$;
reset role;
select pg_temp.ensure((select count(*)=2 from public.transaction_events where event_type='order_created' and conversation_id in(select cid from accept_scope)),'exact Order creation events');
select pg_temp.fail_with('select marketplace_private.order_money(9007199254740991,1)','23514');

reset role;
create function pg_temp.set_payout(p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.marketplace_record_financial_capability((select seller from pg_temp.accept_people),'payout_account',p_status,
  case when p_status='unset' then null else 'staging_test' end,
  case when p_status='unset' then null else 'test_owner' end,
  case when p_status='unset' then null else 'test_payout' end,
  case when p_status='unset' then null else 'Test Bank' end,
  case when p_status='unset' then null else '6789' end);
end; $$;
alter table public.listings disable trigger listings_publication_boundary;
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select seller_id,'Payout gate rollback fixture','Rollback-only',price_cents,currency,category,subcategory,condition,pickup_area,1,now() from public.listings where title like '%Nike%' and seller_id=(select seller from accept_people) limit 1;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
create temporary table payout_scope as select c.id cid,c.listing_id lid from public.marketplace_find_or_create_conversation((select id from public.listings where title='Payout gate rollback fixture')) c;
grant all on payout_scope to authenticated;
set constraints all deferred;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from accept_people;
do $$ declare term jsonb:='{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"pending"}'; r public.order_requests; replacement public.order_requests; retry public.order_requests; create_key uuid:=gen_random_uuid(); replace_key uuid:=gen_random_uuid(); st text; before_count bigint; before_events bigint; cid uuid:=(select p.cid from payout_scope p); begin
 perform pg_temp.fail_with(format('select marketplace_private.require_seller_payout_ready(%L)',auth.uid()),'42501');
 perform pg_temp.fail_with(format('select marketplace_private.lock_financial_capability(%L,''payout_account'')',auth.uid()),'42501');
 perform pg_temp.fail_with(format('select marketplace_private.mutate_order_request(''create'',%L,%L,%L)',cid,term,gen_random_uuid()),'42501');
 for st in select unnest(array['unset','needs_attention']) loop
  perform pg_temp.set_payout(st);
  select count(*) into before_count from public.order_requests where conversation_id=cid;
  select count(*) into before_events from public.transaction_events where conversation_id=cid;
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L,%L)',cid,term,gen_random_uuid()),'P0001');
  perform pg_temp.ensure((select count(*)=before_count from public.order_requests where conversation_id=cid),'denied create zero rows');
  perform pg_temp.ensure((select count(*)=before_events from public.transaction_events where conversation_id=cid),'denied create zero events');
 end loop;
 perform pg_temp.set_payout('ready');
 select * into r from public.marketplace_create_order_request(cid,term,create_key);
 for st in select unnest(array['unset','needs_attention']) loop
  perform pg_temp.set_payout(st);
  select * into retry from public.marketplace_create_order_request(cid,term,create_key);
  perform pg_temp.ensure(retry.id=r.id,'create idempotent retry after readiness loss');
  select count(*) into before_count from public.order_requests where conversation_id=cid;
  select count(*) into before_events from public.transaction_events where conversation_id=cid;
  perform pg_temp.fail_with(format('select public.marketplace_replace_order_request(%L,%L,%L)',r.id,term,gen_random_uuid()),'P0001');
  perform pg_temp.ensure((select status='active' from public.order_requests where id=r.id),'denied replace remains Active');
  perform pg_temp.ensure((select count(*)=before_count from public.order_requests where conversation_id=cid),'denied replace zero rows');
  perform pg_temp.ensure((select count(*)=before_events from public.transaction_events where conversation_id=cid),'denied replace zero events');
 end loop;
 perform pg_temp.set_payout('ready');
 select * into replacement from public.marketplace_replace_order_request(r.id,term,replace_key);
 perform pg_temp.ensure(replacement.id<>r.id and (select status='superseded' from public.order_requests where id=r.id),'ready replace');
 perform pg_temp.set_payout('unset');
 select * into retry from public.marketplace_replace_order_request(r.id,term,replace_key);
 perform pg_temp.ensure(retry.id=replacement.id,'replace idempotent retry after readiness loss');
 for st in select unnest(array['unset','needs_attention','ready']) loop
  perform pg_temp.set_payout(st);
  perform public.marketplace_cancel_order_request(replacement.id,'other','Rollback cancellation',gen_random_uuid());
  perform pg_temp.ensure((select status='cancelled' from public.order_requests where id=replacement.id),'cancel independent of readiness');
  perform pg_temp.set_payout('ready');
  select * into replacement from public.marketplace_create_order_request(cid,term,gen_random_uuid());
 end loop;
 insert into accept_ids values('payout_request',replacement.id);
end; $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
do $$ declare rid uuid:=(select id from accept_ids where name='payout_request'); st text; before_events bigint; o public.orders; again public.orders; key uuid:=gen_random_uuid(); begin
 for st in select unnest(array['unset','needs_attention']) loop
  perform pg_temp.set_payout(st);
  select count(*) into before_events from public.transaction_events where request_id=rid;
  perform pg_temp.fail_with(format('select public.marketplace_accept_order_request(%L,%L)',rid,key),'P0001');
  perform pg_temp.ensure((select status='active' from public.order_requests where id=rid),'denied Accept remains Active');
  perform pg_temp.ensure(not exists(select 1 from public.orders where request_id=rid),'denied Accept zero Orders');
  perform pg_temp.ensure((select status='available' and reserved_order_id is null from public.listings where id=(select lid from payout_scope)),'denied Accept no reservation');
  perform pg_temp.ensure((select count(*)=before_events from public.transaction_events where request_id=rid),'denied Accept zero events');
 end loop;
 perform pg_temp.set_payout('ready');
 select * into o from public.marketplace_accept_order_request(rid,key);
 perform pg_temp.ensure(o.money_status='shipping_pending' and not o.holds_listing and o.reservation_started_at is null and o.reservation_expires_at is null and o.total_amount_cents is null,'shipping pending preserved');
 perform pg_temp.set_payout('needs_attention');
 select * into again from public.marketplace_accept_order_request(rid,key);
 perform pg_temp.ensure(o.id=again.id and (select status='accepted' from public.order_requests where id=rid),'idempotent success after readiness loss');
 perform pg_temp.ensure((select lifecycle_status='open' from public.orders where id=o.id),'no retroactive Order change');
end; $$;
reset role;

-- Phase D rollback qualification; no manual/canonical Order is paid.
reset role;
create temporary table financial_scope(name text primary key,lid uuid,cid uuid,rid uuid,oid uuid);
create function pg_temp.financial_fixture(p_name text,p_pending boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare lid uuid; cid uuid; rid uuid; oid uuid; seller uuid:=(select seller from pg_temp.accept_people); buyer uuid:=(select buyer from pg_temp.accept_people); term jsonb;
begin
  perform pg_temp.set_payout('ready');
  set constraints all immediate;
  alter table public.listings disable trigger listings_publication_boundary;
  insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
    select seller,'Financial rollback '||p_name,'Rollback-only',8000,currency,category,subcategory,condition,pickup_area,1,now() from public.listings where published_at is not null limit 1 returning id into lid;
  set constraints all immediate;
  alter table public.listings enable trigger listings_publication_boundary;
  set constraints all deferred;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
  select c.id into cid from public.marketplace_find_or_create_conversation(lid) c;
  term:=jsonb_build_object('item_amount_cents',8000,'fulfillment_type','shipping','shipping_cost_mode',case when p_pending then 'pending' else 'included' end);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  select r.id into rid from public.marketplace_create_order_request(cid,term,gen_random_uuid()) r;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
  select o.id into oid from public.marketplace_accept_order_request(rid,gen_random_uuid()) o;
  insert into pg_temp.financial_scope values(p_name,lid,cid,rid,oid);
  perform pg_temp.ensure((select payment_status='pending' and payout_status='not_eligible' and payment_paid_at is null from public.orders where id=oid),'new initial financial state');
  return oid;
end; $$;
create function pg_temp.buyer_method(st text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.marketplace_record_financial_capability((select buyer from pg_temp.accept_people),'payment_method',st,
  case when st='unset' then null else 'staging_test' end,
  case when st='unset' then null else 'test_owner' end,
  case when st='unset' then null else 'test_method' end,
  case when st='unset' then null else 'Test Card' end,
  case when st='unset' then null else '4242' end);
end; $$;
select pg_temp.financial_fixture('fixed');
select pg_temp.financial_fixture('pending',true);
select pg_temp.financial_fixture('expired');
select pg_temp.financial_fixture('competing_seed');
-- Turn ONLY this rollback fixture's unpaid deadline into past, preserving exact timestamp checks.
set constraints all immediate;
alter table public.orders disable trigger orders_immutable;
with t as(select clock_timestamp()-interval '31 minutes' started) update public.orders
  set created_at=t.started,accepted_at=t.started,reservation_started_at=t.started,reservation_expires_at=t.started+interval '30 minutes'
  from t where id=(select oid from financial_scope where name='expired');
set constraints all immediate;
alter table public.orders enable trigger orders_immutable;
select set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
do $$ declare oid uuid:=(select f.oid from financial_scope f where name='fixed'); buyer uuid:=(select buyer from accept_people); result jsonb; st text; stamp timestamptz; key uuid:=gen_random_uuid(); begin
 for st in select unnest(array['unset','needs_attention']) loop
  perform pg_temp.buyer_method(st);
  result:=public.marketplace_simulate_order_payment_success(oid,buyer,key);
  perform pg_temp.ensure(result->>'errorCode'='buyer_payment_method_not_ready','method gate');
  perform pg_temp.ensure((select payment_status='pending' and payment_paid_at is null and payout_status='not_eligible' from public.orders where id=oid),'method denial zero financial writes');
  perform pg_temp.ensure(not exists(select 1 from public.transaction_events where order_id=oid and event_type='payment_paid'),'method denial zero events');
 end loop;
 perform pg_temp.buyer_method('set');
 perform pg_temp.set_payout('needs_attention');
 result:=public.marketplace_simulate_order_payment_success(oid,buyer,key);
 perform pg_temp.ensure(result->'order'->>'payment_status'='paid','successful paid despite later Seller readiness loss');
 select payment_paid_at into stamp from public.orders where id=oid;
 perform pg_temp.ensure(stamp is not null and (select payout_status='not_eligible' and lifecycle_status='open' and fulfillment_status='awaiting_fulfillment' and holds_listing from public.orders where id=oid),'independent payment/payout/lifecycle');
 perform pg_temp.ensure((select status='accepted' from public.order_requests where id=(select rid from financial_scope where name='fixed')),'Request remains Accepted');
 perform pg_temp.ensure((select status='reserved' and reserved_order_id=oid from public.listings where id=(select lid from financial_scope where name='fixed')),'paid inventory held');
 perform pg_temp.buyer_method('unset');
 result:=public.marketplace_simulate_order_payment_success(oid,buyer,key);
 result:=public.marketplace_simulate_order_payment_success(oid,buyer,gen_random_uuid());
 perform pg_temp.ensure((select payment_paid_at=stamp from public.orders where id=oid),'idempotent timestamp');
 perform pg_temp.ensure((select count(*)=1 from public.transaction_events where order_id=oid and event_type='payment_paid' and metadata->>'source'='staging_simulator'),'one immutable provenance event');
 perform pg_temp.fail_with(format('select public.marketplace_simulate_order_payment_success(%L,%L,%L)',oid,(select seller from accept_people),gen_random_uuid()),'42501');
 perform pg_temp.fail_with(format('select public.marketplace_simulate_order_payment_success(%L,%L,%L)',oid,(select outsider from accept_people),gen_random_uuid()),'42501');
 perform pg_temp.buyer_method('set');
 result:=public.marketplace_simulate_order_payment_success((select f.oid from financial_scope f where name='pending'),buyer,gen_random_uuid());
 perform pg_temp.ensure(result->>'errorCode'='order_not_payment_ready','shipping pending rejection');
 perform pg_temp.ensure((select payment_status='pending' and payout_status='not_eligible' and not holds_listing and total_amount_cents is null and reservation_expires_at is null from public.orders where id=(select f.oid from financial_scope f where name='pending')),'shipping pending preserved');
 result:=public.marketplace_simulate_order_payment_success((select f.oid from financial_scope f where name='expired'),buyer,gen_random_uuid());
 perform pg_temp.ensure(result->>'errorCode'='order_not_payment_ready','expired rejection');
 perform pg_temp.ensure((select lifecycle_status='expired' and payment_status='pending' and not holds_listing from public.orders where id=(select f.oid from financial_scope f where name='expired')),'lazy expiry survives domain denial');
 perform pg_temp.ensure((select status='available' and reserved_order_id is null from public.listings where id=(select lid from financial_scope where name='expired')),'expiry inventory released');
 perform pg_temp.ensure(not exists(select 1 from public.transaction_events where order_id=(select f.oid from financial_scope f where name='expired') and event_type='payment_paid'),'no late Paid');
end; $$;
-- Simulate historical reservation deadline passing for a Paid test Order only.
set constraints all immediate;
alter table public.orders disable trigger orders_immutable;
with t as(select clock_timestamp()-interval '31 minutes' started) update public.orders
 set created_at=t.started,accepted_at=t.started,reservation_started_at=t.started,reservation_expires_at=t.started+interval '30 minutes',payment_paid_at=t.started+interval '1 minute'
 from t where id=(select oid from financial_scope where name='fixed');
set constraints all immediate;
alter table public.orders enable trigger orders_immutable;
select marketplace_private.settle_listing_reservation((select lid from financial_scope where name='fixed'));
select pg_temp.ensure((select payment_status='paid' and lifecycle_status='open' and holds_listing from public.orders where id=(select oid from financial_scope where name='fixed')),'Paid never expires unpaid');
-- Buyer/Seller reads, refresh reads and direct client bypass denied.
grant select on financial_scope to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from accept_people;
select pg_temp.ensure((public.marketplace_order_detail((select oid from financial_scope where name='fixed'))->'order'->>'payment_status')='paid','Buyer persisted read');
select pg_temp.ensure((public.marketplace_order_detail((select oid from financial_scope where name='fixed'))->'order'->>'payout_status')='not_eligible','Buyer repeated read');
select pg_temp.fail_with(format('update public.orders set payment_status=''paid'' where id=%L',(select oid from financial_scope where name='pending')),'42501');
select pg_temp.fail_with(format('update public.orders set payout_status=''paid'' where id=%L',(select oid from financial_scope where name='fixed')),'42501');
select pg_temp.fail_with(format('select public.marketplace_simulate_order_payment_success(%L,%L,%L)',(select oid from financial_scope where name='pending'),auth.uid(),gen_random_uuid()),'42501');
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from accept_people;
select pg_temp.ensure((public.marketplace_order_detail((select oid from financial_scope where name='fixed'))->'order'->>'payment_status')='paid','Seller same persisted read');
reset role;
select set_config('request.jwt.claims','{"role":"service_role","ref":"yzvchumzyonegujucyqs"}',true);
select pg_temp.fail_with(format('select public.marketplace_simulate_order_payment_success(%L,%L,%L)',(select oid from financial_scope where name='pending'),(select buyer from accept_people),gen_random_uuid()),'42501');
rollback;

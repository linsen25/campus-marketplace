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
 perform pg_temp.ensure(o.holds_listing and o.reservation_expires_at=o.reservation_started_at+interval '30 minutes' and o.payment_status='not_enabled','server reservation no payment');
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
alter table public.orders disable trigger orders_immutable;
-- Use one clock for the exact timestamp equality constraint.
with t as(select clock_timestamp()-interval '31 minutes' started) update public.orders set created_at=t.started,accepted_at=t.started,reservation_started_at=t.started,reservation_expires_at=t.started+interval '30 minutes' from t where id=(select id from accept_ids where name='order');
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
rollback;

-- Disposable test mutations are all rolled back. Existing synthetic staging identities only.
begin;
create temporary table phase1_people as select
  (select id from public.profiles where username='Demo_seller_a') seller,
  (select id from public.profiles where username='Demo_buyer_a') buyer,
  (select id from public.profiles where username='Demo_buyer_b') other_buyer,
  (select id from public.profiles where username='Demo_seller_b') outsider;
create temporary table phase1_scope as select c.id conversation,c.listing_id,c.buyer_id from public.conversations c
  join public.listings l on l.id=c.listing_id join phase1_people p on c.seller_id=p.seller
  where l.title like '%Nike%' and c.buyer_id in (p.buyer,p.other_buyer);
create temporary table phase1_before as select id,status from public.listings;
create temporary table phase1_values(name text primary key,id uuid);
grant all on phase1_people,phase1_scope,phase1_before,phase1_values to authenticated;
create function pg_temp.ensure(value boolean, label text) returns void language plpgsql as $$
begin if value is not true then raise exception 'Phase 1 test failed: %',label; end if; end; $$;
create function pg_temp.fail_with(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'Unexpected test SQLSTATE %, expected %',sqlstate,expected;
  end;
  raise exception 'Expected failure did not occur: %',expected;
end; $$;
select pg_temp.ensure((select count(*)=2 from phase1_scope),'two Nike negotiations');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from phase1_people;
do $$
declare cid uuid; cid2 uuid; term jsonb; action uuid:=gen_random_uuid(); r public.order_requests; b public.order_requests; repeated public.order_requests; count_events bigint;
begin
  select conversation into cid from phase1_scope where buyer_id=(select buyer from phase1_people);
  select conversation into cid2 from phase1_scope where buyer_id=(select other_buyer from phase1_people);
  -- Existing demo Requests are temporarily cancelled only inside this rollback-only transaction.
  for r in select * from public.order_requests where conversation_id in (cid,cid2) and status='active' loop
    perform public.marketplace_cancel_order_request(r.id,'other','Rollback-only isolation',gen_random_uuid());
  end loop;
  term:=jsonb_build_object('item_amount_cents',8000,'fulfillment_type','pickup','place_name','UCC Phase 1 test',
    'scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days 12 hours','seller_note','Rollback-only test');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,
    term||jsonb_build_object('scheduled_at',clock_timestamp()+interval '30 minutes'),gen_random_uuid()),'23514');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,
    term||jsonb_build_object('scheduled_at',clock_timestamp()+interval '31 days'),gen_random_uuid()),'23514');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,
    term||jsonb_build_object('scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days 1 minute'),gen_random_uuid()),'23514');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,
    term||jsonb_build_object('item_amount_cents',-1),gen_random_uuid()),'23514');
  select * into r from public.marketplace_create_order_request(cid,term,action);
  perform pg_temp.ensure(r.status='active' and r.place_id is null and r.latitude is null,'valid manual Pickup');
  select * into repeated from public.marketplace_create_order_request(cid,term,action);
  perform pg_temp.ensure(repeated.id=r.id and repeated.created_at=r.created_at,'idempotent create');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,term,gen_random_uuid()),'23505');
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,term||'{"item_amount_cents":7000}',action),'23505');
  select * into b from public.marketplace_create_order_request(cid2,term,gen_random_uuid());
  perform pg_temp.ensure(b.id<>r.id,'other Buyer same Listing independently Active');
  action:=gen_random_uuid();
  select * into b from public.marketplace_replace_order_request(r.id,term||'{"item_amount_cents":7500}',action);
  select * into repeated from public.marketplace_replace_order_request(r.id,term||'{"item_amount_cents":7500}',action);
  perform pg_temp.ensure(b.id=repeated.id,'idempotent replace');
  perform pg_temp.ensure((select status='superseded' and created_at=r.created_at and item_amount_cents=8000 from public.order_requests where id=r.id),'old terms/time preserved');
  perform pg_temp.fail_with(format('select public.marketplace_replace_order_request(%L,%L::jsonb,%L)',r.id,term,gen_random_uuid()),'23505');
  perform pg_temp.fail_with(format('update public.order_requests set status=''active'' where id=%L',r.id),'42501');
  action:=gen_random_uuid();
  select * into repeated from public.marketplace_cancel_order_request(b.id,'incorrect_details','Rollback reason',action);
  perform pg_temp.ensure(repeated.status='cancelled' and repeated.cancel_reason_code='incorrect_details','cancel snapshot');
  select count(*) into count_events from public.transaction_events where request_id=b.id;
  perform public.marketplace_cancel_order_request(b.id,'incorrect_details','Rollback reason',action);
  perform pg_temp.ensure((select count(*)=count_events from public.transaction_events where request_id=b.id),'no duplicate cancel event');
  perform pg_temp.fail_with(format('select public.marketplace_cancel_order_request(%L,''other'','''',%L)',b.id,gen_random_uuid()),'23505');
  term:=jsonb_build_object('item_amount_cents',0,'fulfillment_type','shipping','shipping_cost_mode','flat_rate','shipping_amount_cents',-1);
  perform pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',cid,term,gen_random_uuid()),'23514');
  select * into r from public.marketplace_create_order_request(cid,term||'{"shipping_amount_cents":0}',gen_random_uuid());
  perform pg_temp.ensure(r.shipping_amount_cents=0 and r.item_amount_cents=0,'zero flat cost/free item');
  perform public.marketplace_cancel_order_request(r.id,'other','',gen_random_uuid());
  select * into r from public.marketplace_create_order_request(cid,term||'{"shipping_cost_mode":"included"}',gen_random_uuid());
  perform pg_temp.ensure(r.shipping_amount_cents=0 and r.scheduled_at is null,'included normalized zero');
  perform public.marketplace_cancel_order_request(r.id,'other','',gen_random_uuid());
  select * into r from public.marketplace_create_order_request(cid,term||'{"shipping_cost_mode":"pending"}',gen_random_uuid());
  perform pg_temp.ensure(r.shipping_amount_cents is null,'pending not zero');
  insert into phase1_values values('request',r.id),('conversation',cid);
end; $$;
reset role;
-- Advancing server time must not impose a Buyer-response/age-based shipping deadline.
select marketplace_private.expire_order_requests((select id from phase1_values where name='conversation'),clock_timestamp()+interval '2 days');
select pg_temp.ensure((select status='active' and scheduled_at is null and request_expires_at is null from public.order_requests where id=(select id from phase1_values where name='request')),'Shipping remains Active after two days without a schedule');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from phase1_people;
select pg_temp.ensure((select count(*)>0 from public.order_requests where conversation_id=(select id from phase1_values where name='conversation')),'Buyer RLS read');
select pg_temp.ensure((select count(*)>0 from public.transaction_events),'Buyer event RLS read');
select pg_temp.fail_with(format('select public.marketplace_create_order_request(%L,''{}'',%L)',(select id from phase1_values where name='conversation'),gen_random_uuid()),'42501');
select pg_temp.fail_with(format('select public.marketplace_replace_order_request(%L,''{}'',%L)',(select id from phase1_values where name='request'),gen_random_uuid()),'42501');
select pg_temp.fail_with(format('select public.marketplace_cancel_order_request(%L,''other'','''',%L)',(select id from phase1_values where name='request'),gen_random_uuid()),'42501');
select pg_temp.fail_with('insert into public.transaction_events default values','42501');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from phase1_people;
select pg_temp.ensure((select count(*)=0 from public.order_requests),'outsider Request RLS');
select pg_temp.ensure((select count(*)=0 from public.transaction_events),'outsider event RLS');
select pg_temp.fail_with(format('select public.marketplace_order_request_history(%L)',(select id from phase1_values where name='conversation')),'42501');
select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true) from phase1_people;
select public.marketplace_cancel_order_request((select id from phase1_values where name='request'),'other','Rollback expiry test',gen_random_uuid());
reset role;
insert into public.order_requests
  select (jsonb_populate_record(null::public.order_requests,to_jsonb(r)||jsonb_build_object(
    'id',gen_random_uuid(),'status','active','replaced_at',null,'replacement_request_id',null,
    'scheduled_at',now()-interval '1 hour','request_expires_at',now()-interval '1 hour'))).*
  from public.order_requests r where r.conversation_id=(select id from phase1_values where name='conversation')
    and r.fulfillment_type='pickup' and r.status='superseded' order by r.created_at limit 1;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true) from phase1_people;
select public.marketplace_order_request_history((select id from phase1_values where name='conversation'));
select pg_temp.ensure(exists(select 1 from public.order_requests where status='expired' and conversation_id=(select id from phase1_values where name='conversation')),'server lazy expiry materialized');
select pg_temp.ensure(exists(select 1 from public.transaction_events where event_type='request_expired'),'expiry event appended');
reset role;
select pg_temp.fail_with(format('update public.order_requests set item_amount_cents=1 where id=%L',(select id from phase1_values where name='request')),'23514');
select pg_temp.fail_with('delete from public.transaction_events','23514');
select pg_temp.ensure(to_regclass('public.orders') is null,'no Orders table');
select pg_temp.ensure(not exists(select 1 from public.listings l join phase1_before b using(id) where l.status<>b.status),'Listing statuses unchanged');
rollback;

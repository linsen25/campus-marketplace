-- Isolated fixture graph; all Auth/profile/capability/listing/proposal changes roll back.
begin;
create temporary table a1_people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'a1_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','A1_'||left(replace(id::text,'-',''),12))
from a1_people cross join lateral(values(seller),(buyer),(outsider)) v(id);
select public.marketplace_record_financial_capability(seller,'payout_account','ready','staging_test','a1_fixture','a1_payout','Test Bank','6789') from a1_people;
create temporary table a1_results(label text primary key,rid uuid,cid uuid,lid uuid);
grant all on a1_people,a1_results to authenticated;
create function pg_temp.actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.ensure(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'A1 assertion: %',label;end if;end;$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected then return;end if;raise exception 'Wrong SQLSTATE %, wanted %',sqlstate,expected;end;
 raise exception 'Unexpected success: %',statement;end;$$;
create function pg_temp.fingerprint(cid uuid) returns jsonb language sql as $$select jsonb_build_object(
 'requests',(select jsonb_agg(to_jsonb(r) order by id) from public.order_requests r where conversation_id=cid),
 'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where conversation_id=cid),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from public.transaction_events e where conversation_id=cid),
 'commands',(select jsonb_agg(to_jsonb(x) order by id) from marketplace_private.order_commands x where request_id in(select id from public.order_requests where conversation_id=cid)),
 'listing',(select to_jsonb(l) from public.listings l join public.conversations c on c.listing_id=l.id where c.id=cid));$$;
create function pg_temp.fixture(label text) returns public.order_requests language plpgsql as $$
declare lid uuid;cid uuid;r public.order_requests;
begin
 perform pg_temp.actor((select seller from a1_people));
 insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select (select seller from a1_people),'A1 rollback fixture','No canonical data',price_cents,currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
 from public.listings where published_at is not null limit 1 returning id into lid;
 perform pg_temp.actor((select buyer from a1_people));
 select id into cid from public.marketplace_find_or_create_conversation(lid);
 perform pg_temp.actor((select seller from a1_people));
 select * into r from public.marketplace_create_order_request(cid,'{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}',gen_random_uuid());
 insert into a1_results values(label,r.id,cid,lid);
 return r;
end;$$;
create function pg_temp.trusted_v2(template public.order_requests,sender uuid) returns public.order_requests language plpgsql as $$
declare r public.order_requests;
begin
 perform pg_temp.actor(sender);
 insert into public.order_requests select (jsonb_populate_record(null::public.order_requests,to_jsonb(template)||jsonb_build_object(
 'id',gen_random_uuid(),'protocol_version',2,'sender_user_id',null,'recipient_user_id',null,'status','active',
 'created_at',clock_timestamp(),'updated_at',clock_timestamp(),'replaced_at',null,'replacement_request_id',null,
 'accepted_at',null,'expired_at',null,'cancelled_at',null,'cancelled_by',null,'cancelled_by_role',null,
 'cancel_reason_code',null,'cancel_reason_label_snapshot',null,'cancel_note',null))).* returning * into r;
 return r;
end;$$;
alter table public.listings disable trigger listings_publication_boundary;
do $$declare r public.order_requests;n public.order_requests;again public.order_requests;o public.orders;o2 public.orders;sender uuid;before jsonb;key uuid;terms jsonb:='{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}';
begin
 -- Existing V1 create/replace/cancel/Accept retries preserve identity and one event.
 r:=pg_temp.fixture('v1');
 perform pg_temp.ensure(r.protocol_version=1 and r.sender_user_id=r.seller_id and r.recipient_user_id=r.buyer_id,'V1 server identity');
 key:=gen_random_uuid();select * into n from public.marketplace_replace_order_request(r.id,terms,key);
 select * into again from public.marketplace_replace_order_request(r.id,terms,key);
 perform pg_temp.ensure(n.id=again.id and n.created_at=again.created_at,'V1 replace retry');
 key:=gen_random_uuid();select * into n from public.marketplace_cancel_order_request(n.id,'other','Original',key);
 select * into again from public.marketplace_cancel_order_request(n.id,'other','Original',key);
 perform pg_temp.ensure(to_jsonb(n)=to_jsonb(again),'V1 cancel retry');
 key:=gen_random_uuid();select * into n from public.marketplace_create_order_request(r.conversation_id,terms,key);
 select * into again from public.marketplace_create_order_request(r.conversation_id,terms,key);
 perform pg_temp.ensure(to_jsonb(n)=to_jsonb(again),'V1 create retry');
 perform pg_temp.actor((select buyer from a1_people));key:=gen_random_uuid();
 select * into o from public.marketplace_accept_order_request(n.id,key);
 select * into o2 from public.marketplace_accept_order_request(n.id,key);
 perform pg_temp.ensure(to_jsonb(o)=to_jsonb(o2) and o.reservation_expires_at=o.accepted_at+interval '30 minutes','V1 Accept retry/timer');
 perform pg_temp.ensure((select count(*)=1 from public.orders where request_id=n.id),'one V1 Order');
 -- Every legacy operation rejects both directions of V2 before any side effect.
 for sender in select seller from a1_people union all select buyer from a1_people loop
  r:=pg_temp.fixture('v2_'||sender);
  perform public.marketplace_cancel_order_request(r.id,'other','Template only',gen_random_uuid());
  n:=pg_temp.trusted_v2(r,sender);before:=pg_temp.fingerprint(n.conversation_id);
  perform pg_temp.ensure(n.sender_user_id=sender and n.recipient_user_id<>sender,'V2 identity derived');
  perform pg_temp.actor((select buyer from a1_people));
  perform pg_temp.reject(format('select public.marketplace_accept_order_request(%L,%L)',n.id,gen_random_uuid()),'42501');
  perform pg_temp.actor((select seller from a1_people));
  perform pg_temp.reject(format('select public.marketplace_cancel_order_request(%L,''other'','''',%L)',n.id,gen_random_uuid()),'42501');
  perform pg_temp.reject(format('select public.marketplace_replace_order_request(%L,%L::jsonb,%L)',n.id,terms,gen_random_uuid()),'42501');
  perform pg_temp.reject(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',n.conversation_id,terms,gen_random_uuid()),'23505');
  perform pg_temp.ensure(before=pg_temp.fingerprint(n.conversation_id),'zero partial Order/event/command/listing/lifecycle changes');
  perform pg_temp.ensure(not exists(select 1 from jsonb_array_elements(public.marketplace_order_request_history(n.conversation_id)->'requests') x where x->>'id'=n.id::text),'V2 excluded from V1 history');
  perform pg_temp.reject(format('update public.order_requests set protocol_version=1 where id=%L',n.id),'23514');
  perform pg_temp.reject(format('update public.order_requests set sender_user_id=recipient_user_id where id=%L',n.id),'23514');
  perform pg_temp.ensure((select count(*)=0 from public.transaction_events where request_id=n.id),'V2 does not fabricate Seller events');
 end loop;
 -- Trusted fixture path also validates forged identities, even though clients
 -- cannot INSERT at all. Use a fresh scope without a competing Active record.
 r:=pg_temp.fixture('forgery');
 perform public.marketplace_cancel_order_request(r.id,'other','Template',gen_random_uuid());
 perform pg_temp.actor((select buyer from a1_people));
 perform pg_temp.reject(format('insert into public.order_requests select (jsonb_populate_record(null::public.order_requests,%L::jsonb)).*',
  to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'protocol_version',2,'status','active','sender_user_id',r.seller_id,
   'recipient_user_id',r.buyer_id,'cancelled_at',null,'cancelled_by',null,'cancelled_by_role',null,'cancel_reason_code',null,'cancel_reason_label_snapshot',null)), '42501');
 perform pg_temp.reject(format('insert into public.order_requests select (jsonb_populate_record(null::public.order_requests,%L::jsonb)).*',
  to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'protocol_version',2,'status','active','sender_user_id',r.buyer_id,
   'recipient_user_id',(select outsider from a1_people),'cancelled_at',null,'cancelled_by',null,'cancelled_by_role',null,'cancel_reason_code',null,'cancel_reason_label_snapshot',null)), '42501');
 perform pg_temp.reject(format('select pg_temp.trusted_v2(%L::public.order_requests,%L)',r,(select outsider from a1_people)),'42501');
 r:=pg_temp.fixture('v1_blocks_v2');
 perform pg_temp.reject(format('select pg_temp.trusted_v2(%L::public.order_requests,%L)',r,(select buyer from a1_people)),'23505');
 perform pg_temp.ensure((select count(*)=1 from public.order_requests where conversation_id=r.conversation_id and status='active'),'one Active total');
 perform pg_temp.reject(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',r.conversation_id,terms||'{"protocol_version":2}',gen_random_uuid()),'42501');
 -- Unset/Needs attention still reject V1 Seller create; existing retry remains safe.
 r:=pg_temp.fixture('payout');perform public.marketplace_cancel_order_request(r.id,'other','Payout test',gen_random_uuid());
 perform public.marketplace_record_financial_capability(r.seller_id,'payout_account','needs_attention','staging_test','a1_fixture','a1_payout','Test Bank','6789');
 perform pg_temp.reject(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',r.conversation_id,terms,gen_random_uuid()),'P0001');
 perform public.marketplace_record_financial_capability(r.seller_id,'payout_account','unset',null,null,null,null,null);
 perform pg_temp.reject(format('select public.marketplace_create_order_request(%L,%L::jsonb,%L)',r.conversation_id,terms,gen_random_uuid()),'P0001');
end;$$;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
set local role authenticated;
select pg_temp.actor(outsider) from a1_people;
select pg_temp.ensure((select count(*)=0 from public.order_requests where conversation_id in(select cid from a1_results)),'outsider RLS');
select pg_temp.ensure((select count(*)=0 from public.transaction_events where conversation_id in(select cid from a1_results)),'outsider event RLS');
select pg_temp.reject(format('select public.marketplace_order_request_history(%L)',cid),'42501') from a1_results limit 1;
select pg_temp.reject(format('select public.marketplace_create_order_request(%L,''{}''::jsonb,%L)',cid,gen_random_uuid()),'42501') from a1_results limit 1;
select pg_temp.reject('insert into public.order_requests default values','42501');
select pg_temp.reject('update public.order_requests set protocol_version=2','42501');
select pg_temp.ensure(not has_table_privilege('authenticated','public.order_requests','INSERT'),'no direct protocol selection');
select pg_temp.actor(buyer) from a1_people;
select pg_temp.ensure((select count(*)>0 from public.order_requests where conversation_id in(select cid from a1_results)),'participant RLS');
reset role;
select 'V1 identity/retries/Accept/timer, both V2 directions rejected, zero partial writes, shared Active, protocol immutability, payout, RLS: PASS' result;
rollback;

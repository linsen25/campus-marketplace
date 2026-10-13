-- Isolated fixture graph; all Auth/profile/capability/listing/proposal changes roll back.
begin;
create temporary table a2_people as select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'a2_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','A2_'||left(replace(id::text,'-',''),12))
from a2_people cross join lateral(values(seller),(buyer),(outsider)) v(id);
select public.marketplace_record_financial_capability(seller,'payout_account','ready','staging_test','a2_fixture','a2_payout','Test Bank','6789') from a2_people;
create temporary table a2_results(label text primary key,rid uuid,cid uuid,lid uuid);
grant all on a2_people,a2_results to authenticated;
create function pg_temp.actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.ensure(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'A2 assertion: %',label;end if;end;$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected then return;end if;raise exception 'Wrong SQLSTATE %, wanted %',sqlstate,expected;end;
 raise exception 'Unexpected success: %',statement;end;$$;
create function pg_temp.fingerprint(cid uuid) returns jsonb language sql as $$select jsonb_build_object(
 'requests',(select jsonb_agg(to_jsonb(r) order by id) from public.order_requests r where conversation_id=cid),
 'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where conversation_id=cid),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from public.transaction_events e where conversation_id=cid),
 'commands',(select jsonb_agg(to_jsonb(x) order by id) from marketplace_private.order_commands x where request_id in(select id from public.order_requests where conversation_id=cid)),
 'offerCommands',(select jsonb_agg(to_jsonb(x) order by id) from marketplace_private.offer_commands x where offer_id in(select id from public.order_requests where conversation_id=cid)),
 'listing',(select to_jsonb(l) from public.listings l join public.conversations c on c.listing_id=l.id where c.id=cid));$$;
create function pg_temp.fixture(label text) returns public.order_requests language plpgsql as $$
declare lid uuid;cid uuid;r public.order_requests;
begin
 perform pg_temp.actor((select seller from a2_people));
 insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select (select seller from a2_people),'A2 rollback fixture','No canonical data',price_cents,currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
 from public.listings where published_at is not null limit 1 returning id into lid;
 perform pg_temp.actor((select buyer from a2_people));
 select id into cid from public.marketplace_find_or_create_conversation(lid);
 perform pg_temp.actor((select seller from a2_people));
 select * into r from public.marketplace_create_order_request(cid,'{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}',gen_random_uuid());
 insert into a2_results values(label,r.id,cid,lid);
 return r;
end;$$;
create function pg_temp.scope(label text) returns uuid language plpgsql as $$declare r public.order_requests;begin r:=pg_temp.fixture(label);perform public.marketplace_cancel_order_request(r.id,'other','Synthetic template',gen_random_uuid());return r.conversation_id;end;$$;
alter table public.listings disable trigger listings_publication_boundary;
do $$declare cid uuid;r public.order_requests;n public.order_requests;again public.order_requests;key uuid;keyb uuid;before jsonb;oldrow jsonb;who uuid;field text;terms jsonb:='{"item_amount_cents":7000,"note":"Synthetic negotiation","fulfillment":"delivery","delivery_fee_cents":1000,"delivery_method":"seller_delivery"}';begin
 cid:=pg_temp.scope('initial');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','unset',null,null,null,null,null);
 perform pg_temp.actor((select buyer from a2_people));key:=gen_random_uuid();
 select * into r from public.marketplace_create_offer(cid,terms,key);
 perform pg_temp.ensure(r.protocol_version=2 and r.status='active' and r.sender_user_id=(select buyer from a2_people) and r.recipient_user_id=(select seller from a2_people),'Buyer initial while payout Unset/no payment method');
 select * into again from public.marketplace_create_offer(cid,terms,key);
 perform pg_temp.ensure(to_jsonb(r)=to_jsonb(again),'create retry identical');
 before:=pg_temp.fingerprint(cid);perform pg_temp.actor((select seller from a2_people));
 perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,terms,gen_random_uuid()),'P0001');
 perform pg_temp.ensure(before=pg_temp.fingerprint(cid),'Unset Seller no partial replacement');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','needs_attention','staging_test','a2fixture','a2payout','Test Bank','6789');
 perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,terms,gen_random_uuid()),'P0001');
 perform pg_temp.ensure(before=pg_temp.fingerprint(cid),'Needs attention Seller no partial replacement');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','ready','staging_test','a2fixture','a2payout','Test Bank','6789');
 oldrow:=to_jsonb(r);keyb:=gen_random_uuid();select * into n from public.marketplace_create_offer(cid,terms,keyb);
 select * into r from public.order_requests where id=r.id;
 perform pg_temp.ensure(r.status='superseded' and r.replacement_request_id=n.id and n.sender_user_id=r.seller_id,'Seller counter Buyer');
 perform pg_temp.ensure((to_jsonb(r)-array['status','updated_at','replaced_at','replacement_request_id'])=(oldrow-array['status','updated_at','replaced_at','replacement_request_id']),'immutable old terms/timeline');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','needs_attention','staging_test','a2fixture','a2payout','Test Bank','6789');
 perform pg_temp.actor((select buyer from a2_people));select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());
 before:=pg_temp.fingerprint(cid);perform pg_temp.actor((select seller from a2_people));select * into again from public.marketplace_create_offer(cid,terms,keyb);
 perform pg_temp.ensure(again.id=n.id and again.status='superseded' and before=pg_temp.fingerprint(cid),'stale counter retry never reactivates/replaces newer');
 perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',r.id,gen_random_uuid()),'42501');
 perform pg_temp.actor((select buyer from a2_people));select * into n from public.marketplace_create_offer(cid,terms,gen_random_uuid());
 perform pg_temp.ensure(n.sender_user_id=r.sender_user_id,'Buyer same sender replacement');
 key:=gen_random_uuid();select * into r from public.marketplace_withdraw_offer(n.id,key,'Original note');select * into again from public.marketplace_withdraw_offer(n.id,key,'Original note');
 perform pg_temp.ensure(to_jsonb(r)=to_jsonb(again) and r.status='withdrawn' and r.withdrawn_by=r.sender_user_id,'Buyer withdrawal retry');
 perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',n.id,gen_random_uuid()),'23505');
 perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L,''different'')',n.id,key),'23505');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','ready','staging_test','a2fixture','a2payout','Test Bank','6789');
 perform pg_temp.actor((select seller from a2_people));select * into r from public.marketplace_create_offer(cid,terms,gen_random_uuid());select * into n from public.marketplace_create_offer(cid,terms,gen_random_uuid());
 perform pg_temp.ensure(n.sender_user_id=r.sender_user_id,'Seller same sender replacement/initial');
 perform pg_temp.actor((select buyer from a2_people));perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',n.id,gen_random_uuid()),'42501');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','unset',null,null,null,null,null);
 perform pg_temp.actor((select seller from a2_people));select * into n from public.marketplace_withdraw_offer(n.id,gen_random_uuid());
 perform pg_temp.ensure(n.status='withdrawn','Seller withdraw when payout Unset');
 perform pg_temp.actor((select outsider from a2_people));
 perform pg_temp.reject(format('select public.marketplace_offer_history(%L)',cid),'42501');perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,terms,gen_random_uuid()),'42501');perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',n.id,gen_random_uuid()),'42501');
 perform pg_temp.actor((select buyer from a2_people));
 perform pg_temp.ensure(jsonb_array_length(public.marketplace_offer_history(cid)->'offers')=6,'V2 history retains rows');
 perform pg_temp.ensure(not exists(select 1 from jsonb_array_elements(public.marketplace_order_request_history(cid)->'requests') x where (x->>'protocol_version')::int=2),'V1 read excludes V2');
 perform pg_temp.ensure(not exists(select 1 from public.transaction_events e join public.order_requests x on x.id=e.request_id where x.conversation_id=cid and x.protocol_version=2 and (e.actor_id is null or e.actor_role is distinct from case when e.actor_id=x.buyer_id then 'buyer' else 'seller' end)),'event actor identity');
 perform pg_temp.ensure(not exists(select 1 from public.transaction_events where conversation_id=cid and event_type like 'offer_%' group by request_id,event_type having count(*)<>1),'one event per transition');
 perform pg_temp.ensure(not exists(select 1 from public.orders where conversation_id=cid) and (select status='available' and reserved_order_id is null from public.listings where id=n.listing_id),'zero Orders/reservation');
 perform public.marketplace_record_financial_capability((select seller from a2_people),'payout_account','ready','staging_test','a2fixture','a2payout','Test Bank','6789');r:=pg_temp.fixture('v1block');
 for who in select seller from a2_people union all select buyer from a2_people loop
 perform pg_temp.actor(who);before:=pg_temp.fingerprint(r.conversation_id);perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',r.conversation_id,terms,gen_random_uuid()),'23505');perform pg_temp.ensure(before=pg_temp.fingerprint(r.conversation_id),'Active V1 blocks V2');end loop;
 for who in select seller from a2_people union all select buyer from a2_people loop
 cid:=pg_temp.scope('direction_'||who);perform pg_temp.actor(who);select * into n from public.marketplace_create_offer(cid,terms,gen_random_uuid());before:=pg_temp.fingerprint(cid);
 perform pg_temp.actor((select buyer from a2_people));perform pg_temp.reject(format('select public.marketplace_accept_order_request(%L,%L)',n.id,gen_random_uuid()),'42501');
 perform pg_temp.actor((select seller from a2_people));
 perform pg_temp.reject(format('select public.marketplace_cancel_order_request(%L,''other'','''',%L)',n.id,gen_random_uuid()),'42501');perform pg_temp.reject(format('select public.marketplace_replace_order_request(%L,''{}'',%L)',n.id,gen_random_uuid()),'42501');perform pg_temp.reject(format('select public.marketplace_create_order_request(%L,''{}'',%L)',cid,gen_random_uuid()),'23505');
 perform pg_temp.ensure(before=pg_temp.fingerprint(cid),'V1 hard rejects V2 no side effects');
 perform pg_temp.reject(format('update public.order_requests set sender_user_id=recipient_user_id where id=%L',n.id),'23514');perform pg_temp.reject(format('update public.order_requests set protocol_version=1 where id=%L',n.id),'23514');perform pg_temp.reject(format('update public.order_requests set status=''accepted'',accepted_at=clock_timestamp() where id=%L',n.id),'42501');perform pg_temp.reject(format('update public.order_requests set status=''closed'',closed_at=clock_timestamp() where id=%L',n.id),'42501');end loop;
 perform pg_temp.actor((select buyer from a2_people));
 for field in select unnest(array['senderId','recipientId','protocolVersion','status','listingId','senderRole']) loop perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,terms||jsonb_build_object(field,'forged'),gen_random_uuid()),'23514');end loop;
end;$$;
do $$declare r public.order_requests;field text;begin
 for r in select * from public.order_requests where conversation_id in(select cid from a2_results) and protocol_version=2 and status='superseded' loop
 perform pg_temp.actor(r.sender_user_id);perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',r.id,gen_random_uuid()),'23505');
 perform pg_temp.reject(format('update public.order_requests set status=''active'',replaced_at=null,replacement_request_id=null where id=%L',r.id),'42501');end loop;
 select * into r from public.order_requests where conversation_id in(select cid from a2_results) and protocol_version=2 and status='active' limit 1;
 perform pg_temp.actor(r.sender_user_id);
 perform pg_temp.reject(format('update public.order_requests set item_amount_cents=item_amount_cents+1 where id=%L',r.id),'23514');
 perform pg_temp.reject(format('update public.order_requests set created_at=clock_timestamp() where id=%L',r.id),'23514');
 perform pg_temp.reject(format('update public.order_requests set recipient_user_id=sender_user_id where id=%L',r.id),'23514');
 perform pg_temp.reject(format('update public.order_requests set listing_origin_id=gen_random_uuid() where id=%L',r.id),'23514');
 perform pg_temp.reject(format('update public.order_requests set conversation_id=gen_random_uuid() where id=%L',r.id),'23514');
end;$$;

do $$declare cid uuid;r public.order_requests;v jsonb;bad jsonb;before jsonb;t text;begin
 cid:=pg_temp.scope('b_terms');perform pg_temp.actor((select buyer from a2_people));
 t:=to_jsonb(date_trunc('hour',clock_timestamp()+interval '2 days'))#>>'{}';
 v:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','Outside Weldon','scheduled_at',t,'note','Meet outside');
 select * into r from public.marketplace_create_offer(cid,v,gen_random_uuid());
 perform pg_temp.ensure(r.offer_terms=v and r.listing_updated_at_at_offer=(select updated_at from public.listings where id=r.listing_id),'final On Campus terms + revision token');
 perform pg_temp.reject(format('update public.order_requests set offer_terms=%L::jsonb where id=%L',v||'{"meetup_location":"Changed"}',r.id),'23514');
 before:=pg_temp.fingerprint(cid);
 for bad in select unnest(array[v||'{"delivery_fee_cents":0}',v||'{"scheduled_at":"2020-01-01T12:00:00Z"}',v||'{"meetup_location":""}',v||'{"item_amount_cents":0}',v||'{"item_amount_cents":1.2}',v||'{"note":42}',v||'{"scheduled_at":"2030-01-01T12:00:00Z"}',v||'{"scheduled_at":"2026-10-14T12:01:00Z"}']) loop
 perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,bad,gen_random_uuid()),'23514');end loop;
 perform pg_temp.ensure(before=pg_temp.fingerprint(cid),'invalid campus terms never replace');
 v:='{"item_amount_cents":8500,"fulfillment":"delivery","delivery_fee_cents":0,"delivery_method":"courier"}';
 select * into r from public.marketplace_create_offer(cid,v,gen_random_uuid());perform pg_temp.ensure(r.offer_terms=v,'zero Delivery fee/courier persisted');before:=pg_temp.fingerprint(cid);
 for bad in select unnest(array[v||'{"scheduled_at":"2026-10-14T12:00:00Z"}',v||'{"delivery_fee_cents":-1}',v||'{"delivery_fee_cents":1.5}',v||'{"delivery_method":"pending"}',v||'{"delivery_address":"secret"}',v-'delivery_fee_cents']) loop
 perform pg_temp.reject(format('select public.marketplace_create_offer(%L,%L::jsonb,%L)',cid,bad,gen_random_uuid()),'23514');end loop;
 perform pg_temp.ensure(before=pg_temp.fingerprint(cid),'invalid Delivery terms never replace');
end;$$;

-- Existing V1 paths on synthetic scope only; no canonical Request/Order consumed.
do $$declare r public.order_requests;n public.order_requests;again public.order_requests;o public.orders;o2 public.orders;key uuid;terms jsonb:='{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}';result jsonb;begin
 r:=pg_temp.fixture('v1regression');key:=gen_random_uuid();select * into n from public.marketplace_replace_order_request(r.id,terms,key);select * into again from public.marketplace_replace_order_request(r.id,terms,key);perform pg_temp.ensure(n.id=again.id,'V1 Replace retry');
 key:=gen_random_uuid();select * into r from public.marketplace_cancel_order_request(n.id,'other','V1 synthetic',key);select * into again from public.marketplace_cancel_order_request(n.id,'other','V1 synthetic',key);perform pg_temp.ensure(to_jsonb(r)=to_jsonb(again),'V1 Cancel retry');
 key:=gen_random_uuid();select * into n from public.marketplace_create_order_request(r.conversation_id,terms,key);select * into again from public.marketplace_create_order_request(r.conversation_id,terms,key);perform pg_temp.ensure(n.id=again.id and n.protocol_version=1,'V1 Create retry');
 perform pg_temp.actor(n.buyer_id);key:=gen_random_uuid();select * into o from public.marketplace_accept_order_request(n.id,key);select * into o2 from public.marketplace_accept_order_request(n.id,key);perform pg_temp.ensure(o.id=o2.id and o.reservation_expires_at=o.accepted_at+interval '30 minutes','V1 Accept unchanged reservation/idempotency');
 perform public.marketplace_record_financial_capability(n.buyer_id,'payment_method','set','staging_test','a2fixture','a2payment','Test Card','4242');perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);key:=gen_random_uuid();result:=public.marketplace_simulate_order_payment_success(o.id,n.buyer_id,key);perform pg_temp.ensure(result->'order'->>'payment_status'='paid','V1 payment regression');result:=public.marketplace_simulate_order_payment_success(o.id,n.buyer_id,key);perform pg_temp.ensure((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='payment_paid'),'V1 payment event idempotency');
 perform pg_temp.actor((select seller from a2_people));r:=pg_temp.fixture('v1cancelorder');perform pg_temp.actor(r.buyer_id);select * into o from public.marketplace_accept_order_request(r.id,gen_random_uuid());key:=gen_random_uuid();result:=public.marketplace_cancel_order(o.id,'buyer_changed_mind','Synthetic cancellation',key);perform pg_temp.ensure(result->'order'->>'lifecycle_status'='cancelled','V1 cancellation regression');perform pg_temp.ensure((select status='accepted' from public.order_requests where id=r.id),'V1 Request remains Accepted after cancellation');perform pg_temp.ensure((select status='available' and reserved_order_id is null from public.listings where id=r.listing_id),'V1 release inventory');
end;$$;
-- Synthetic terminal states not normally produced by A2; transaction-scoped bypass.
set constraints all immediate;
alter table public.order_requests disable trigger order_request_immutable;
alter table public.order_requests disable trigger order_request_event;
set constraints all deferred;
do $$declare r public.order_requests;cid uuid;state text;begin
 for state in select unnest(array['accepted','expired','closed']) loop
 cid:=pg_temp.scope('terminal_'||state);perform pg_temp.actor((select buyer from a2_people));select * into r from public.marketplace_create_offer(cid,'{"item_amount_cents":8000,"fulfillment":"delivery","delivery_fee_cents":0,"delivery_method":"courier"}',gen_random_uuid());
 update public.order_requests set status=state,accepted_at=case when state='accepted' then clock_timestamp() end,expired_at=case when state='expired' then clock_timestamp() end,closed_at=case when state='closed' then clock_timestamp() end where id=r.id;
 perform pg_temp.reject(format('select public.marketplace_withdraw_offer(%L,%L)',r.id,gen_random_uuid()),'23505');end loop;
end;$$;
set constraints all immediate;
alter table public.order_requests enable trigger order_request_immutable;
alter table public.order_requests enable trigger order_request_event;
set local role authenticated;
select pg_temp.actor(outsider) from a2_people;
select pg_temp.ensure((select count(*)=0 from public.order_requests),'outsider RLS');
select pg_temp.reject('insert into public.order_requests(id) values(gen_random_uuid())','42501');
select pg_temp.reject('update public.order_requests set status=''accepted''','42501');
select pg_temp.reject('select * from marketplace_private.offer_commands','42501');
reset role;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
select 'PASS Buyer/Seller create/counter/same-sender/withdraw/payout/idempotency/V1/security/RLS/terminal/no Orders' result;
rollback;

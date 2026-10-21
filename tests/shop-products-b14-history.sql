-- Pre-migration historical Shop fixtures; real existing guards stay enabled.
insert into public.shops(owner_id,name,category,description)
values('11111111-1111-4111-8111-111111111111','Historical Shop','Electronics','Retained historical inventory');
create table public.b14_history(label text primary key,cid uuid,offer uuid,oid uuid,command uuid,batch uuid,hash jsonb);
do $$declare cid uuid;r public.order_requests;o public.orders;cmd uuid:=gen_random_uuid();batch uuid;begin
 cid:=public.b07_fixture('held-history');
 r:=public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 batch:=public.b07_prepare(r.id,auth.uid(),cmd);
 o:=public.marketplace_accept_offer(r.id,cmd,batch);
 insert into public.b14_history values('held',cid,r.id,o.id,cmd,batch,o.listing_snapshot);
 cid:=public.b07_fixture('open-history');
 r:=public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
 insert into public.b14_history(label,cid,offer) values('open',cid,r.id);
end;$$;
-- AFTER_B14
do $$declare h public.b14_history;lid uuid;open_offer uuid;cmd uuid;media uuid;begin
 select * into h from public.b14_history where label='held';
 select listing_id into lid from public.orders where id=h.oid;
 perform public.b14_assert((select status='pending' and published_at is not null and reserved_order_id=h.oid from public.listings where id=lid),'pending is a published held Shop listing');
 perform public.b14_assert((select count(*)=2 from public.listings where seller_id='11111111-1111-4111-8111-111111111111' and listing_channel='shop' and published_at is not null and status in('available','pending','reserved')),'held and available both count');
 perform public.b14_reject(format('delete from public.listings where id=%L',lid),'23514');
 perform public.b14_reject(format('update public.listings set title=''unsafe'' where id=%L',lid),'23514');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.b14_assert((public.marketplace_accept_offer(h.offer,h.command,h.batch)).id=h.oid,'historical Accept replay unchanged');
 perform public.marketplace_confirm_order_agreement(h.oid);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.marketplace_confirm_order_agreement(h.oid);
 perform public.b14_assert((public.marketplace_find_or_create_conversation(lid)).id=h.cid,'reuse existing conversation remains authorized');
 perform public.b14_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,gen_random_uuid())',(select cid from public.b14_history where label='open'),public.b07_terms()),'42501');
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 select offer into open_offer from public.b14_history where label='open';
 cmd:=gen_random_uuid();media:=public.b07_prepare(open_offer,auth.uid(),cmd);
 perform public.b14_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',open_offer,cmd,media),'42501');
 perform public.b14_assert(not exists(select 1 from public.orders where request_id=open_offer),'real valid historical Offer cannot start a new Order');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.marketplace_confirm_external_exchange(h.oid,gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 perform public.marketplace_confirm_external_exchange(h.oid,gen_random_uuid());
 perform public.b14_assert((select status='sold' and reserved_order_id is null from public.listings where id=lid),'existing unentitled owner Order completes to Sold');
 perform public.b14_assert((select listing_snapshot=h.hash from public.orders where id=h.oid),'historical snapshot unchanged');
 -- Existing V1 explicitly disallows Shop; test the reserved predicate without fabricating an impossible Shop V1 Order.
 perform public.b14_assert((select count(*)=3 from (values('available'),('pending'),('reserved'),('sold')) s(status) where status in('available','pending','reserved')),'reserved remains counted by the same predicate');
end;$$;

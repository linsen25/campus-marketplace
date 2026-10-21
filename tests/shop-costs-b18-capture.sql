-- Separate pre-B14 future-path fixture qualification. No guard is disabled.
-- Current deployed-path guard denial is tested after installing B14 below.
create table public.b18_scope(kind text primary key,lid uuid,offer uuid,oid uuid,batch uuid,cmd uuid);
grant select on public.b18_scope to authenticated;
create function public.b18_offer(label text) returns void language plpgsql as $$
declare cid uuid;r public.order_requests;cmd uuid:=gen_random_uuid();batch uuid;begin
 cid:=public.b07_fixture(label);r:=public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');batch:=public.b07_prepare(r.id,auth.uid(),cmd);
 insert into public.b18_scope(kind,lid,offer,batch,cmd) values(label,r.listing_id,r.id,batch,cmd);
end;$$;
select public.b18_offer('known'),public.b18_offer('unknown'),public.b18_offer('rollback'),public.b18_offer('duplicate-race'),public.b18_offer('cost-first'),public.b18_offer('accept-first');
select public.marketplace_shop_product_cost((select lid from public.b18_scope where kind='known'),'{"amountCents":0,"currency":"CAD","revision":0}');
do $$declare f public.b18_scope;o public.orders;snapshot jsonb;begin
 select * into f from public.b18_scope where kind='known';o:=public.marketplace_accept_offer(f.offer,f.cmd,f.batch);update public.b18_scope set oid=o.id where kind='known';
 perform public.b14_assert((select amount_cents=0 and cost_revision=1 and listing_origin_id=o.listing_origin_id and seller_origin_id=o.seller_origin_id and captured_at=o.accepted_at and shop_origin_id=(select id from public.shops where owner_id=o.seller_origin_id) from marketplace_private.shop_order_cost_snapshots where order_id=o.id),'first Accept freezes genuine zero and actual identities');
 select to_jsonb(s) into snapshot from marketplace_private.shop_order_cost_snapshots s where order_id=o.id;
 perform public.marketplace_shop_product_cost(f.lid,'{"amountCents":999,"currency":"CAD","revision":1}');
 perform public.b14_assert((public.marketplace_accept_offer(f.offer,f.cmd,f.batch)).id=o.id,'Accept replay returns same Order');
 perform public.b14_assert((select to_jsonb(s)=snapshot from marketplace_private.shop_order_cost_snapshots s where order_id=o.id),'cost update never changes snapshot');
 perform public.b14_reject(format('update marketplace_private.shop_order_cost_snapshots set amount_cents=7 where order_id=%L',o.id),'42501');
 perform public.b14_reject(format('delete from marketplace_private.shop_order_cost_snapshots where order_id=%L',o.id),'42501');
 select * into f from public.b18_scope where kind='unknown';o:=public.marketplace_accept_offer(f.offer,f.cmd,f.batch);update public.b18_scope set oid=o.id where kind='unknown';
 perform public.b14_assert((select amount_cents is null and cost_revision is null from marketplace_private.shop_order_cost_snapshots where order_id=o.id),'unknown captured as NULL');
 perform public.marketplace_shop_product_cost(f.lid,'{"amountCents":100,"currency":"CAD","revision":0}');
 perform public.b14_assert((select amount_cents is null from marketplace_private.shop_order_cost_snapshots where order_id=o.id),'late cost does not fill old unknown');
 select * into f from public.b18_scope where kind='rollback';
 perform public.b14_reject(format('select public.marketplace_accept_offer(%L,%L,gen_random_uuid())',f.offer,f.cmd),'42501');
 perform public.b14_assert(not exists(select 1 from public.orders where request_id=f.offer),'failed Order leaves no snapshot');
end;$$;
-- A fixture-local AFTER INSERT failure tests rollback after cost capture as well.
create function public.b18_fail_snapshot() returns trigger language plpgsql as $$begin
 if new.listing_origin_id=(select lid from public.b18_scope where kind='rollback') then raise exception 'Fixture snapshot failure' using errcode='P0001';end if;return new;end;$$;
create trigger z_b18_fixture_failure after insert on marketplace_private.shop_order_cost_snapshots for each row execute function public.b18_fail_snapshot();
do $$declare f public.b18_scope;begin
 select * into f from public.b18_scope where kind='rollback';
 perform public.b14_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',f.offer,f.cmd,f.batch),'P0001');
 perform public.b14_assert(not exists(select 1 from public.orders where request_id=f.offer),'snapshot failure rolls back Order');
 perform public.b14_assert(not exists(select 1 from marketplace_private.shop_order_cost_snapshots where listing_origin_id=f.lid),'snapshot failure rolls back snapshot');
 perform public.b14_assert(not exists(select 1 from marketplace_private.offer_accept_commands where idempotency_key=f.cmd),'snapshot failure rolls back Accept command');
 perform public.b14_assert((select status='available' and reserved_order_id is null from public.listings where id=f.lid),'snapshot failure preserves inventory');
end;$$;
drop trigger z_b18_fixture_failure on marketplace_private.shop_order_cost_snapshots;
drop function public.b18_fail_snapshot();
select public.b14_assert(not exists(select 1 from public.b18_prior_orders b join marketplace_private.shop_order_cost_snapshots s on s.order_id=b.id),'legacy Orders not backfilled');
select public.b14_assert(not exists(select 1 from public.b18_prior_orders b join public.orders o using(id) where b.original<>to_jsonb(o)),'historical frozen Orders untouched');
select public.b14_assert(not exists(select 1 from public.b18_prior_functions b join pg_proc p using(oid) where b.def<>pg_get_functiondef(p.oid)),'B18 replaces no transaction function');

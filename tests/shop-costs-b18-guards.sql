-- B14 is now installed in the capture fixture cluster, without disabling a guard.
select public.b14_assert((select count(*)=3 and bool_and(tgenabled='O') from pg_trigger where tgname in('b14_new_shop_conversation_guard','b14_new_shop_offer_guard','b14_new_shop_order_guard')),'all current Shop guards CLOSED');
do $$declare f public.b18_scope;begin
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');
 select * into f from public.b18_scope where kind='rollback';
 perform public.b14_reject(format('select public.marketplace_accept_offer(%L,%L,%L)',f.offer,f.cmd,f.batch),'42501');
 perform public.b14_assert(not exists(select 1 from public.orders where request_id=f.offer),'current B14 guard prevents new Shop Order and snapshot');
 perform public.b07_actor('44444444-4444-4444-8444-444444444444');
 perform public.b14_reject(format('select public.marketplace_find_or_create_conversation(%L)',f.lid),'42501');
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');
 perform public.b14_reject(format('select public.marketplace_submit_offer(%L,%L::jsonb,gen_random_uuid())',(select conversation_id from public.order_requests where id=f.offer),public.b07_terms()),'42501');
end;$$;

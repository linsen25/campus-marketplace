-- Separate historical pre-B14 fixture phase, actual B18 first-Accept capture.
select marketplace_private.shop_membership_command('11111111-1111-4111-8111-111111111111','trial',gen_random_uuid(),'{}',clock_timestamp());
create function public.b19_complete(label text) returns void language plpgsql as $$
declare o uuid;begin
 select oid into o from public.b18_scope where kind=label;
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');perform public.marketplace_confirm_order_agreement(o);
 perform public.b07_actor('22222222-2222-4222-8222-222222222222');perform public.marketplace_confirm_order_agreement(o);
 perform public.marketplace_confirm_external_exchange(o,gen_random_uuid());
 perform public.b07_actor('11111111-1111-4111-8111-111111111111');perform public.marketplace_confirm_external_exchange(o,gen_random_uuid());
end;$$;
select public.b19_complete('known');
do $$declare d jsonb;amount bigint;begin
 select item_amount_cents into amount from public.orders where id=(select oid from public.b18_scope where kind='known');
 d:=public.marketplace_shop_analysis('month');
 perform public.b14_assert((d->'current'->>'revenueCents')::bigint=amount,'real external sale value excludes fees and delivery');
 perform public.b14_assert(d->'current'->>'sold'='1','two completion event representations count once');
 perform public.b14_assert((d->'current'->>'estimatedProfitCents')::bigint=amount,'frozen genuine zero rather than current 999');
 perform public.b14_assert((d->'current'->'coverage'->>'externalCents')::bigint=amount and d->'current'->'coverage'->>'uuPayCents'='0','external never becomes UU paid');
 perform public.b14_assert((select payment_status<>'paid' from public.orders where id=(select oid from public.b18_scope where kind='known')),'external unchanged');
end;$$;
select public.b19_complete('unknown');
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'estimatedProfitCents' is null,'unknown frozen cost never reconstructed');
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'missingCostCount'='1','unknown counted separately');
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'sold'='0','other owner cannot read seller totals');
select public.b14_assert(not exists(select 1 from public.b18_prior_orders b join public.orders o using(id) where b.original<>to_jsonb(o)),'old Orders unchanged');

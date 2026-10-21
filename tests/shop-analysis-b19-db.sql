-- Current-schema authority only. No financial or provider side effects.
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
set role authenticated;
do $$declare d jsonb;r text;begin
 foreach r in array array['week','month','last-month','year'] loop
  d:=public.marketplace_shop_analysis(r);
  perform public.b14_assert(d->>'source'='real' and d->>'access'='plus','real Plus no Demo fallback');
  perform public.b14_assert(d->'current'->>'revenueCents'='0' and d->'current'->>'estimatedProfitCents'='0','true empty Shop');
  perform public.b14_assert(jsonb_array_length(d->'current'->'trend') between 7 and 366,'bounded calendar days');
  perform public.b14_assert(d->'pro'->'featured'='null'::jsonb and d->'pro'->'products' is not null,'Plus sales products allowed, no Pro attribution');
 end loop;
end;$$;
select public.b14_reject('select public.marketplace_shop_analysis(''all'')','23514');
select public.b14_reject('select public.marketplace_shop_analysis(null)','23514');
select public.b14_reject('select * from marketplace_private.shop_order_cost_snapshots','42501');
reset role;
select set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
select public.b14_assert(public.marketplace_shop_analysis('month')->>'access'='pro','Pro');
select public.b14_assert(public.marketplace_shop_analysis('month')->'pro'->'featured'->>'available'='false','promotion unavailable not invented');
select set_config('request.jwt.claim.sub',public.b14_owner(83)::text,false);
select public.b14_assert(public.marketplace_shop_analysis('month')->>'access'='trial','Pro Trial');
select set_config('request.jwt.claim.sub',public.b14_owner(84)::text,false);
select public.b14_assert(public.marketplace_shop_analysis('month')->>'membershipStatus'='grace','Grace retains access');
select set_config('request.jwt.claim.sub',public.b14_owner(85)::text,false);
select public.b14_reject('select public.marketplace_shop_analysis(''month'')','42501');
select public.b14_assert(public.marketplace_shop_expenses('list','{}')->>'shopId' is not null,'Suspended private expenses retained');
select set_config('request.jwt.claim.sub',public.b14_owner(90)::text,false);
select public.b14_reject('select public.marketplace_shop_analysis(''month'')','42501');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
select public.b14_reject('select public.marketplace_shop_analysis(''month'')','42501');
select set_config('request.jwt.claim.sub','',false);
set role anon;
select public.b14_reject('select public.marketplace_shop_analysis(''month'')','42501');
reset role;
select public.b14_assert(not has_function_privilege('anon','public.marketplace_shop_analysis(text)','execute')
 and not has_function_privilege('service_role','public.marketplace_shop_analysis(text)','execute')
 and has_function_privilege('authenticated','public.marketplace_shop_analysis(text)','execute'),'least privilege');
select public.b14_assert((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.marketplace_shop_analysis(text)'::regprocedure),'definer empty search path');
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
select public.marketplace_shop_expenses('create',jsonb_build_object('id','19100000-0000-4000-8000-000000000001','amountCents',123,'currency','CAD','on',(now() at time zone 'America/Toronto')::date,'kind','Marketing','description','B19 local'));
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'estimatedProfitCents'='-123','expense-only negative estimate');
select public.marketplace_shop_expenses('delete','{"id":"19100000-0000-4000-8000-000000000001","revision":1}');
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'knownExpensesCents'='0','deleted expense excluded');
-- Historical completed Shop Order lacks event-time B18 identity: no retroactive join.
select marketplace_private.shop_membership_command('11111111-1111-4111-8111-111111111111','trial',gen_random_uuid(),'{}',clock_timestamp());
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents' is null,'historical unknown provenance is not false zero');
select public.b14_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'missingProvenanceCount'='1','missing history counted');
select public.b14_assert(not exists(select 1 from public.b18_prior_functions b join pg_proc p using(oid) where b.def<>pg_get_functiondef(p.oid)),'prior definitions including B17 unchanged');
select public.b14_assert(not exists(select 1 from public.b18_prior_orders b join public.orders o using(id) where b.original<>to_jsonb(o)),'history unchanged');
begin read only;
set local role authenticated;
select public.b14_assert(public.marketplace_shop_analysis('month')->>'source'='real','RPC executes in actual read-only transaction');
rollback;

-- Disposable loopback PostgreSQL only; no shared data or external provider.
create function public.b12_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'B12: %',label;end if;end;$$;
create function public.b12_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
 if sqlstate=expected then return;end if;raise;
end;raise exception 'B12 unexpected success: %',statement;end;$$;
create function public.b12_owner(i integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select public.b12_owner(i),'b12_local_'||i||'@uwo.ca',case when i=24 then null else clock_timestamp() end,
 jsonb_build_object('username','B12_Local_'||i) from generate_series(1,24) i;
insert into public.shops(owner_id,name,category,description)
select public.b12_owner(i),'B12 Shop '||i,'Electronics','Local B12 fixture' from generate_series(1,22) i;
create table public.b12_existing_authority as
select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','marketplace_private') and p.prokind='f';
create table public.b12_existing_shop as select to_jsonb(s) data from public.shops s;
create table public.b12_existing_policy as select to_jsonb(p) data from pg_policies p;
-- B12_APPLY

select public.b12_assert(not exists(select 1 from public.b12_existing_authority x where pg_get_functiondef(x.oid)<>x.definition),'all existing RPCs including Orders/Resale/B11 unchanged');
select public.b12_assert(not exists((select data from public.b12_existing_shop except select to_jsonb(s) from public.shops s)
 union all (select to_jsonb(s) from public.shops s except select data from public.b12_existing_shop)),'existing Shop records unchanged');
select public.b12_assert(not exists(select 1 from public.b12_existing_policy x where not exists(select 1 from pg_policies p where to_jsonb(p)=x.data)),'existing RLS unchanged');

create function public.b12_cmd(owner_id uuid,action text,at_time timestamptz,value jsonb default '{}') returns jsonb language sql as $$
 select marketplace_private.shop_membership_command(owner_id,action,gen_random_uuid(),
  jsonb_build_object('expectedRevision',coalesce((select revision from marketplace_private.shop_memberships m where m.owner_id=b12_cmd.owner_id),0),
  'expectedCycle',(select cycle_id from marketplace_private.shop_memberships m where m.owner_id=b12_cmd.owner_id))||value,at_time);$$;
create function public.b12_buy(owner_id uuid,at_time timestamptz,tier text,mode text,proof text) returns jsonb language sql as $$
 select public.b12_cmd(owner_id,'purchase',at_time,jsonb_build_object('tier',tier,'mode',mode,'proof',proof,
 'currency','CAD','amountCents',marketplace_private.shop_membership_price(tier,mode),'consent',case when mode='auto_renew' then 'trusted-consent' else null end));$$;

do $$declare o uuid:=public.b12_owner(1);a uuid:=gen_random_uuid();r jsonb;again jsonb;e timestamptz;begin
 perform public.b12_assert((marketplace_private.shop_entitlements(o,'2027-01-01')->>'status') is null,'Shop alone has no membership');
 r:=marketplace_private.shop_membership_command(o,'trial',a,'{}','2027-01-31 17:00Z');
 again:=marketplace_private.shop_membership_command(o,'trial',a,'{}','2027-02-01 17:00Z');
 perform public.b12_assert(r=again,'same UUID/lost response exact replay');
 perform public.b12_assert((r->'membership'->>'maxActiveProducts')::int=100,'Trial Pro quota');
 perform public.b12_assert((r->'membership'->>'currentTermEnd')::timestamptz='2027-03-31 16:00Z','two calendar months');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',gen_random_uuid(),''{}'',''2028-01-01'')',o),'23505');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',%L,''{"tier":"pro"}'',''2027-01-31'')',o,a),'23505');
 e:=(r->'membership'->>'currentTermEnd')::timestamptz;
 perform public.b12_assert(marketplace_private.shop_entitlements(o,e)->>'status'='grace','exact expiry Grace');
 perform public.b12_assert((marketplace_private.shop_entitlements(o,e+interval '431999 seconds')->>'proPromotionEligible')::boolean,'full Grace Pro');
 perform public.b12_assert(marketplace_private.shop_entitlements(o,e+interval '432000 seconds')->>'status'='suspended','exact 120 hours');
 perform public.b12_assert(not (marketplace_private.shop_entitlements(o,e+interval '432000 seconds')->>'canOperateShop')::boolean,'expiry without cron denies');
 delete from public.shops where owner_id=o;
 insert into public.shops(owner_id,name,category,description) values(o,'Recreated','Electronics','No new lifetime Trial');
 perform public.b12_assert(not (marketplace_private.shop_entitlements(o,'2028-01-01')->>'trialEligible')::boolean,'Shop recreation retains Trial use');
 perform public.b12_reject(format('update marketplace_private.shop_memberships set trial_claimed_at=null where owner_id=%L',o),'42501');
 perform public.b12_reject('delete from marketplace_private.shop_membership_commands','42501');
end;$$;

-- The production wrappers only derive the authenticated owner and server clock.
set role authenticated;
select set_config('request.jwt.claim.sub',public.b12_owner(2)::text,false);
select public.b12_assert((public.marketplace_shop_membership()->>'trialEligible')::boolean,'owner eligible before claim');
select public.marketplace_claim_shop_trial('00000000-0000-4000-8000-100000000002');
select public.b12_assert(public.marketplace_shop_membership()->>'status'='trial','public Trial wrapper');
select public.b12_reject('select * from marketplace_private.shop_memberships','42501');
select public.b12_reject('insert into marketplace_private.shop_memberships(owner_id) values(auth.uid())','42501');
select public.b12_reject('update marketplace_private.shop_membership_terms set tier=''pro''','42501');
select public.b12_reject('select marketplace_private.shop_entitlements(auth.uid(),now())','42501');
select public.b12_reject('select marketplace_private.shop_membership_command(auth.uid(),''purchase'',gen_random_uuid())','42501');
select set_config('request.jwt.claim.sub',public.b12_owner(23)::text,false);
select public.b12_assert(public.marketplace_shop_membership()->>'reason'='no_shop','no Shop no entitlement');
select public.b12_reject('select public.marketplace_claim_shop_trial(gen_random_uuid())','42501');
select set_config('request.jwt.claim.sub',public.b12_owner(24)::text,false);
select public.b12_reject('select public.marketplace_shop_membership()','42501');
select public.b12_reject('select public.marketplace_claim_shop_trial(gen_random_uuid())','42501');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
select public.b12_reject('select public.marketplace_shop_membership()','42501');
select set_config('request.jwt.claim.sub','',false);
select public.b12_reject('select public.marketplace_shop_membership()','42501');
reset role;
do $$declare role_name text;f record;tbl text;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach tbl in array array['shop_memberships','shop_membership_terms','shop_membership_commands'] loop
   perform public.b12_assert(not has_table_privilege(role_name,'marketplace_private.'||tbl,'SELECT,INSERT,UPDATE,DELETE'),'no direct private table privileges');
  end loop;
  perform public.b12_assert(not has_function_privilege(role_name,'marketplace_private.shop_membership_command(uuid,text,uuid,jsonb,timestamptz)','EXECUTE'),'internal paid command owner only');
 end loop;
 for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('marketplace_shop_membership','marketplace_claim_shop_trial') loop
   perform public.b12_assert(f.prosecdef and f.proconfig @> array['search_path=""'],'safe public definer');
   perform public.b12_assert(not has_function_privilege('anon',f.oid,'EXECUTE') and not has_function_privilege('service_role',f.oid,'EXECUTE'),'no anonymous/service execution');
 end loop;
end;$$;

-- Calendar helper is timezone independent; gap resolves to 03:00, fold to EDT.
select public.b12_assert(marketplace_private.shop_calendar_boundary('2027-01-31 12:00',1)='2027-02-28 17:00Z','clamp February');
select public.b12_assert(marketplace_private.shop_calendar_boundary('2027-01-31 12:00',2)='2027-03-31 16:00Z','restore March anchor');
select public.b12_assert(marketplace_private.shop_calendar_boundary('2028-01-31 12:00',1)='2028-02-29 17:00Z','leap year');
select public.b12_assert(marketplace_private.shop_calendar_boundary('2027-02-14 02:30',1)='2027-03-14 07:00Z','spring first valid instant');
select public.b12_assert(marketplace_private.shop_calendar_boundary('2027-10-07 01:30',1)='2027-11-07 05:30Z','fold earlier instant');
set timezone='Asia/Shanghai';
select public.b12_assert(marketplace_private.shop_calendar_boundary('2027-01-31 12:00',2)='2027-03-31 16:00Z','session timezone independent');
reset timezone;

do $$declare o uuid:=public.b12_owner(3);e timestamptz;r jsonb;begin
 perform public.b12_buy(o,'2027-01-31 17:00Z','plus','one_month','paid-3');
 e:='2027-02-28 17:00Z';
 perform public.b12_assert((marketplace_private.shop_entitlements(o,'2027-02-01')->>'maxActiveProducts')::int=40,'Plus quota');
 perform public.b12_assert(not (marketplace_private.shop_entitlements(o,'2027-02-01')->>'proPromotionEligible')::boolean,'Plus no promotional privilege');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',gen_random_uuid(),''{}'',''2027-02-01'')',o),'23505');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',gen_random_uuid(),''{}'',''2027-03-01'')',o),'23505');
 perform public.b12_assert((marketplace_private.shop_entitlements(o,e+interval '432000 seconds')->>'trialEligible')::boolean,'previous paid unused eligible after Suspended');
 r:=marketplace_private.shop_membership_command(o,'trial',gen_random_uuid(),'{}',e+interval '432000 seconds');
 perform public.b12_assert(r->'membership'->>'status'='trial','Trial immediately reactivates existing Shop');
 perform public.b12_assert((select count(*)=1 from public.shops where owner_id=o),'no second Shop');
end;$$;

do $$declare o uuid:=public.b12_owner(4);r jsonb;begin
 perform public.b12_buy(o,'2027-01-31 17:00Z','pro','auto_renew','paid-4');
 perform public.b12_assert(not (marketplace_private.shop_entitlements(o,'2027-04-01')->>'trialEligible')::boolean,'authorized renewal blocks Trial');
 perform public.b12_cmd(o,'pending','2027-02-28 17:00Z','{"reference":"renewal-4"}');
 perform public.b12_cmd(o,'mode','2027-03-10','{"mode":"one_month"}');
 perform public.b12_assert(not (marketplace_private.shop_entitlements(o,'2027-03-10')->>'trialEligible')::boolean,'unresolved renewal blocks despite cancel');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',gen_random_uuid(),''{}'',''2027-03-10'')',o),'23505');
 perform public.b12_cmd(o,'resolve','2027-03-10','{"reference":"renewal-4","outcome":"failed"}');
 perform public.b12_assert((marketplace_private.shop_entitlements(o,'2027-03-10')->>'trialEligible')::boolean,'resolved and no recurring consent eligible');
end;$$;

-- Advance renewal and month-anchor restoration.
select public.b12_buy(public.b12_owner(5),'2027-01-31 17:00Z','plus','one_month','paid-5');
select public.b12_buy(public.b12_owner(5),'2027-02-10 17:00Z','plus','one_month','advance-5');
select public.b12_assert((select max(ends_at)='2027-03-31 16:00Z' from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(5)),'advance extends original calendar anchor');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(5),'2027-02-28 17:00Z')->>'status'='active','adjacent coverage not Grace');
-- Grace cross-plan conversion and Suspended reset.
select public.b12_buy(public.b12_owner(6),'2027-01-31 17:00Z','pro','one_month','paid-6');
select public.b12_buy(public.b12_owner(6),'2027-03-02 17:00Z','plus','one_month','grace-6');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(6),'2027-03-02 17:00Z')->>'effectiveTier'='plus','Grace changes effective tier immediately');
select public.b12_assert((select max(ends_at)='2027-03-31 16:00Z' from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(6)),'Grace original due anchor');
select public.b12_buy(public.b12_owner(6),'2027-05-10 14:00Z','pro','one_month','reactivate-6');
select public.b12_assert((select max(ends_at)='2027-06-10 14:00Z' from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(6)),'Suspended new activation anchor');
-- Scheduled downgrade does not grant paid future rights by itself.
select public.b12_buy(public.b12_owner(7),'2027-01-01 17:00Z','pro','one_month','paid-7');
select public.b12_cmd(public.b12_owner(7),'schedule','2027-01-10','{"tier":"plus"}');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(7),'2027-01-20')->>'effectiveTier'='pro','scheduled downgrade preserves paid Pro');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(7),'2027-02-02')->>'effectiveTier'='pro','unfunded downgrade retains Grace Pro');
select public.b12_buy(public.b12_owner(7),'2027-01-20','plus','one_month','future-plus-7');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(7),'2027-02-01 17:00Z')->>'effectiveTier'='plus','funded next period downgrade');
-- Prorating: 16/31 days left * 300 = 154.8387 -> 155 cents.
select public.b12_buy(public.b12_owner(8),'2027-01-01 17:00Z','plus','one_month','paid-8');
select public.b12_cmd(public.b12_owner(8),'upgrade','2027-01-16 17:00Z','{"proof":"upgrade-8","currency":"CAD","amountCents":155}');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(8),'2027-01-16 17:00Z')->>'effectiveTier'='pro','immediate verified upgrade');
select public.b12_assert((select ends_at='2027-02-01 17:00Z' and base_price_cents=299 from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(8)),'upgrade preserves base price and end');
select public.b12_buy(public.b12_owner(9),'2027-01-01 17:00Z','plus','one_month','paid-9');
select public.b12_cmd(public.b12_owner(9),'upgrade','2027-01-31 17:00Z','{"proof":"waiver-9","currency":"CAD","amountCents":0,"minimumCents":50,"waiver":"below_provider_minimum"}');
-- Price and authorization mismatches never grant.
select public.b12_reject(format('select public.b12_cmd(%L,''purchase'',''2027-01-01'',''{"proof":"bad","tier":"pro","mode":"one_month","currency":"USD","amountCents":599}'')',public.b12_owner(10)),'23514');
select public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''trial'',gen_random_uuid(),''{"tier":"pro"}'',''2027-01-01'')',public.b12_owner(10)),'23514');
-- Proof deduplication across request UUIDs, payload conflict and rollback.
do $$declare o uuid:=public.b12_owner(11);v jsonb;r jsonb;s jsonb;a uuid:=gen_random_uuid();begin
 v:='{"expectedRevision":0,"expectedCycle":null,"proof":"dedupe-11","tier":"plus","mode":"one_month","currency":"CAD","amountCents":299}';
 r:=marketplace_private.shop_membership_command(o,'purchase',a,v,'2027-01-01 17:00Z');
 s:=marketplace_private.shop_membership_command(o,'purchase',gen_random_uuid(),v,'2027-01-02');
 perform public.b12_assert(r=s,'payment retry new request same effect');
 perform public.b12_assert((select count(*)=1 from marketplace_private.shop_membership_terms where owner_id=o),'one paid period');
 perform public.b12_reject(format('select marketplace_private.shop_membership_command(%L,''purchase'',%L,%L::jsonb,''2027-01-02'')',o,a,v||'{"amountCents":599}'),'23505');
end;$$;
begin;
select marketplace_private.shop_membership_command(public.b12_owner(12),'trial',gen_random_uuid(),'{}','2027-01-01');
rollback;
select public.b12_assert(not exists(select 1 from marketplace_private.shop_memberships where owner_id=public.b12_owner(12)),'rollback removes marker/term/receipt atomically');

-- B14 permits eligible publication; membership never bypasses image readiness.
insert into public.listings(id,seller_id,title,price_cents,category,subcategory,condition,pickup_area,listing_channel,expected_image_count,meeting_location)
values('b1200000-0000-4000-8000-000000000001',public.b12_owner(2),'Local Shop guard',100,'Electronics','Computers & Tablets','good','Campus','shop',1,'Local location');
set role authenticated;
select set_config('request.jwt.claim.sub',public.b12_owner(2)::text,false);
select public.b12_reject('select public.marketplace_finalize_listing(''b1200000-0000-4000-8000-000000000001'')','23514');
reset role;
select public.b12_assert((select published_at is null from public.listings where id='b1200000-0000-4000-8000-000000000001'),'membership does not bypass image readiness');

-- Exact Grace-boundary purchase, both recurring modes and no accidental charges.
select public.b12_buy(public.b12_owner(13),'2027-01-01 17:00Z','plus','auto_renew','paid-13');
select public.b12_buy(public.b12_owner(13),'2027-02-06 16:59:59Z','plus','auto_renew','grace-13');
select public.b12_assert((select max(ends_at)='2027-03-01 17:00Z' from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(13)),'last Grace second preserves due anchor');
select public.b12_cmd(public.b12_owner(13),'mode','2027-02-10','{"mode":"one_month"}');
select public.b12_assert((select renewal_consent_ref is null from marketplace_private.shop_memberships where owner_id=public.b12_owner(13)),'cancel recurring consent');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(13),'2027-02-10')->>'status'='active','cancel preserves coverage');
select public.b12_cmd(public.b12_owner(13),'mode','2027-02-11','{"mode":"auto_renew","consent":"new-verified-consent"}');
select public.b12_assert((select count(*)=2 from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(13)),'consent switch does not charge/grant a period');
select public.b12_buy(public.b12_owner(14),'2027-01-01 17:00Z','plus','one_month','paid-14');
select public.b12_buy(public.b12_owner(14),'2027-02-06 17:00Z','plus','one_month','reactivate-at-boundary-14');
select public.b12_assert((select max(ends_at)='2027-03-06 17:00Z' from marketplace_private.shop_membership_terms where owner_id=public.b12_owner(14)),'exact 120 hours starts new cycle');

-- Duplicate period/overlap is rejected by the actual exclusion constraint.
select public.b12_reject(format($q$insert into marketplace_private.shop_membership_terms(owner_id,cycle_id,ordinal,source,tier,purchase_mode,starts_at,ends_at,base_price_cents,command_action,command_id)
 values(%L,gen_random_uuid(),1,'paid','plus','one_month','2027-01-10','2027-01-20',299,'purchase',gen_random_uuid())$q$,public.b12_owner(11)),'23P01');
-- Missing waiver minimum cannot silently approve an unpaid positive upgrade.
select public.b12_buy(public.b12_owner(15),'2027-01-01 17:00Z','plus','one_month','paid-15');
select public.b12_reject(format('select public.b12_cmd(%L,''upgrade'',''2027-01-16 17:00Z'',''{"proof":"unpaid-upgrade","currency":"CAD","amountCents":0}'')',public.b12_owner(15)),'23514');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(15),'2027-01-16')->>'effectiveTier'='plus','failed upgrade preserves Plus');
-- Never retry an old-cycle verified payment into a new cycle.
select public.b12_reject(format('select public.b12_cmd(%L,''purchase'',''2027-01-16'',''{"expectedCycle":"00000000-0000-4000-8000-000000000000","proof":"old-cycle","tier":"plus","mode":"one_month","currency":"CAD","amountCents":299}'')',public.b12_owner(15)),'40001');
-- Exact Grace elapsed time across the spring clock change.
select public.b12_buy(public.b12_owner(16),'2027-02-13 17:00Z','pro','one_month','spring-grace-16');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(16),'2027-03-18 16:59:59Z')->>'status'='grace','DST Grace lasts 120 real hours');
select public.b12_assert(marketplace_private.shop_entitlements(public.b12_owner(16),'2027-03-18 17:00Z')->>'status'='suspended','DST exact elapsed expiry');
select public.b12_assert(not exists(select 1 from public.orders) and not exists(select 1 from public.order_requests),'membership creates no Orders/Offers');
select public.b12_reject(format('select public.b12_cmd(%L,''upgrade'',''2027-03-15'',''{"proof":"expired-cycle-upgrade","currency":"CAD","amountCents":155}'')',public.b12_owner(6)),'23514');
-- A lost-response retry returns current rights, not an expired receipt projection.
select marketplace_private.shop_membership_command(public.b12_owner(19),'trial','19000000-0000-4000-8000-000000000019','{}','2020-01-01');
set role authenticated;
select set_config('request.jwt.claim.sub',public.b12_owner(19)::text,false);
select public.b12_assert(public.marketplace_claim_shop_trial('19000000-0000-4000-8000-000000000019')->'membership'->>'status'='suspended','expired receipt cannot present current Pro rights');
select public.b12_assert(not (public.marketplace_shop_membership()->>'canOperateShop')::boolean,'expired retry has no operating entitlement');
reset role;

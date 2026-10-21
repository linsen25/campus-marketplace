-- Disposable local data only; no remote operations or disabled history guards.
create table public.b17_ids(kind text primary key,id uuid not null);
grant select on public.b17_ids to authenticated;
insert into public.b17_ids values('shop',public.b14_draft(81)),('draft',public.b14_draft(81)),('suspended',public.b14_draft(85));
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
select public.marketplace_finalize_listing((select id from public.b17_ids where kind='shop'));
insert into public.b17_ids select 'store',id from public.shops where owner_id=public.b14_owner(81);
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,
 expected_image_count,preferred_payment_mode,preferred_fulfillment,meeting_location,estimated_delivery_fee_cents)
values('17100000-0000-4000-8000-000000000001',public.b14_owner(81),'Resale source','Local source',1000,'CAD','Electronics','Cameras','good',1,'external','ON_CAMPUS','Campus',0);
insert into public.b17_ids values('resale','17100000-0000-4000-8000-000000000001');
insert into public.listing_images(listing_id,slot) values('17100000-0000-4000-8000-000000000001',1);
insert into storage.objects(bucket_id,name,metadata) select storage_bucket,path,'{"mimetype":"image/png","size":100}' from public.listing_images where listing_id='17100000-0000-4000-8000-000000000001';
update public.listing_images set ready=true where listing_id='17100000-0000-4000-8000-000000000001';
select public.marketplace_finalize_listing('17100000-0000-4000-8000-000000000001');
create table public.b17_prior_activity as select id,to_jsonb(e) original from marketplace_private.account_activity_events e;
create table public.b17_prior_functions as select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','marketplace_private') and p.prokind='f' and p.proname<>'marketplace_record_listing_view';
-- APPLY_B17
select public.b14_assert(not exists(select 1 from public.b17_prior_activity b join marketplace_private.account_activity_events e using(id)
 where to_jsonb(e)-array['listing_channel_snapshot','shop_origin_id']<>b.original or e.listing_channel_snapshot is not null or e.shop_origin_id is not null),'legacy bytes not backfilled');
select public.b14_assert(not exists(select 1 from public.b17_prior_functions b join pg_proc p on p.oid=b.oid where b.definition<>pg_get_functiondef(p.oid)),'existing authorities unchanged except approved view RPC');

select set_config('request.jwt.claim.sub',public.b14_owner(90)::text,false);
set role authenticated;
select public.b14_assert((public.marketplace_record_listing_view((select id from public.b17_ids where kind='shop'),'17200000-0000-4000-8000-000000000001')->>'recorded')::boolean,'eligible Shop Listing view');
select public.marketplace_record_listing_view((select id from public.b17_ids where kind='shop'),'17200000-0000-4000-8000-000000000001');
select public.marketplace_record_listing_view((select id from public.b17_ids where kind='resale'),'17200000-0000-4000-8000-000000000002');
select public.marketplace_record_shop_view((select id from public.b17_ids where kind='store'),'17200000-0000-4000-8000-000000000003');
select public.marketplace_record_shop_view((select id from public.b17_ids where kind='store'),'17200000-0000-4000-8000-000000000003');
select public.b14_reject($q$select public.marketplace_record_listing_view((select id from public.b17_ids where kind='resale'),'17200000-0000-4000-8000-000000000001')$q$,'23514');
select public.b14_assert(not(public.marketplace_record_listing_view((select id from public.b17_ids where kind='draft'),gen_random_uuid())->>'recorded')::boolean,'draft denied');
select public.b14_assert(not(public.marketplace_record_shop_view('00000000-0000-4000-8000-000000000000',gen_random_uuid())->>'recorded')::boolean,'missing Shop no details');
select public.b14_assert(not(public.marketplace_record_listing_view('00000000-0000-4000-8000-000000000000',gen_random_uuid())->>'recorded')::boolean,'missing Listing no details');
select public.b14_reject('select public.marketplace_record_shop_view(null,gen_random_uuid())','23514');
select public.b14_reject('select * from marketplace_private.account_activity_events','42501');
select public.b14_reject('select * from marketplace_private.completed_order_facts(auth.uid(),now(),now()+interval ''1 day'')','42501');
reset role;
select public.b14_assert((select count(*)=3 from marketplace_private.account_activity_events where id in('17200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000002','17200000-0000-4000-8000-000000000003')),'three explicit opens, retry dedupe');
select public.b14_assert((select listing_channel_snapshot='shop' and shop_origin_id=(select id from public.b17_ids where kind='store') from marketplace_private.account_activity_events where id='17200000-0000-4000-8000-000000000001'),'Shop Listing frozen provenance');
select public.b14_assert((select listing_channel_snapshot='resale' and shop_origin_id is null from marketplace_private.account_activity_events where id='17200000-0000-4000-8000-000000000002'),'Resale never becomes Shop');
select public.b14_assert((select listing_origin_id is null and kind='shop_view' and listing_channel_snapshot='shop' from marketplace_private.account_activity_events where id='17200000-0000-4000-8000-000000000003'),'Shop entity has no fake Listing');

select set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
set role authenticated;
select public.b14_reject($q$select public.marketplace_record_shop_view((select id from public.b17_ids where kind='store'),'17200000-0000-4000-8000-000000000003')$q$,'23514');
reset role;
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
set role authenticated;
select public.b14_assert(not(public.marketplace_record_shop_view((select id from public.b17_ids where kind='store'),gen_random_uuid())->>'recorded')::boolean,'own Shop excluded');
select public.b14_assert(not(public.marketplace_record_listing_view((select id from public.b17_ids where kind='resale'),gen_random_uuid())->>'recorded')::boolean,'own Listing excluded');
reset role;
select set_config('request.jwt.claim.sub','',false);
set role anon;
select public.b14_reject($q$select public.marketplace_record_listing_view((select id from public.b17_ids where kind='resale'),gen_random_uuid())$q$,'42501');
select public.b14_reject('select public.marketplace_record_shop_view(gen_random_uuid(),gen_random_uuid())','42501');
reset role;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
set role authenticated;
select public.b14_reject('select public.marketplace_record_shop_view(gen_random_uuid(),gen_random_uuid())','42501');
reset role;
select set_config('request.jwt.claim.sub',public.b14_owner(90)::text,false);
select public.b14_reject(format('insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id,listing_channel_snapshot) values(''forged'',''view'',%L,%L,''shop'')',public.b14_owner(81),(select id from public.b17_ids where kind='resale')),'23514');
select public.b14_reject(format('insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id) values(''forged-owner'',''view'',%L,%L)',public.b14_owner(82),(select id from public.b17_ids where kind='resale')),'23514');
select public.b14_reject(format('insert into marketplace_private.account_activity_events(identity,kind,owner_id,shop_origin_id,listing_channel_snapshot) values(''forged-shop-channel'',''shop_view'',%L,%L,''resale'')',public.b14_owner(81),(select id from public.b17_ids where kind='store')),'23514');

-- New publication/Sold facts get source metadata; old facts stay unknown.
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
select public.marketplace_finalize_listing((select id from public.b17_ids where kind='draft'));
select public.b14_assert((select listing_channel_snapshot='shop' and shop_origin_id is not null from marketplace_private.account_activity_events where identity=(select id::text||':published' from public.b17_ids where kind='draft')),'new publication provenance');
update public.listings set status='sold' where id=(select id from public.b17_ids where kind='draft');
select public.b14_assert((select count(*)=1 from marketplace_private.account_activity_events where identity=(select id::text||':sold' from public.b17_ids where kind='draft') and listing_channel_snapshot='shop'),'manual Sold is first Sold, not an Order');
select public.b14_assert(not(public.marketplace_record_listing_view((select id from public.b17_ids where kind='draft'),gen_random_uuid())->>'recorded')::boolean,'Sold denied');
select public.b14_assert(not(public.marketplace_record_shop_view((select id from public.shops where owner_id=public.b14_owner(85)),gen_random_uuid())->>'recorded')::boolean,'Suspended excluded');

-- Existing historical Order completes through existing domain guards, not B17.

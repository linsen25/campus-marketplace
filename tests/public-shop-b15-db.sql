-- Local-only fixtures; existing B14 helpers use actual publication authority.
select public.b14_fill(81,2),public.b14_fill(82,1),public.b14_fill(83,1),public.b14_fill(84,1);
create table public.b15_before as select oid,pg_get_functiondef(oid) definition from pg_proc where proname in('guard_new_shop_transaction','shop_entitlements','marketplace_create_shop');
create table public.b15_ids as select seller_id,id from public.listings where listing_channel='shop' and published_at is not null;
grant select on public.b15_ids to anon,authenticated;
select public.b14_draft(81);
set role anon;
select public.b14_assert((public.marketplace_public_shops()->>'hasNextPage')::boolean=false,'bounded actual directory');
select public.b14_assert(jsonb_array_length(public.marketplace_public_shops()->'shops')=5,'Plus Pro Trial Grace eligible; no term and Suspended hidden');
select public.b14_assert(public.marketplace_public_shop('B14_Local_81')->>'state'='available','anonymous eligible Plus');
select public.b14_assert(public.marketplace_public_shop('B14_Local_82')->'shop'->>'badgeTier'='pro','real Pro badge');
select public.b14_assert(public.marketplace_public_shop('B14_Local_83')->'shop'->>'badgeTier'='pro','Trial public tier without history');
select public.b14_assert(public.marketplace_public_shop('B14_Local_84')->>'state'='available','Grace eligible');
select public.b14_assert(public.marketplace_public_shop('B14_Local_85')='{"state":"unavailable"}','Suspended minimal response');
select public.b14_assert(public.marketplace_public_shop('B14_Local_86')='{"state":"unavailable"}','no membership minimal response');
select public.b14_assert(public.marketplace_public_shop('B14_Local_90')='{"state":"not_found"}','no Shop');
select public.b14_assert(public.marketplace_public_shop('not_existing')='{"state":"not_found"}','unknown Shop');
select public.b14_assert(jsonb_array_length(public.marketplace_public_shop('B14_Local_87')->'listings')=0,'eligible empty Shop no stock fiction');
select public.b14_assert(jsonb_array_length(public.marketplace_public_shop('B14_Local_81')->'listings')=2,'draft excluded');
select public.b14_assert(not (public.marketplace_public_shop('B14_Local_81')::text ~ 'storage_bucket|source_path|trialClaimed|renewal|@uwo.ca|ownerId|expectedImageCount'),'no private fields');
select public.b14_assert((select count(*)=0 from public.listings),'raw Shop table remains RLS closed');
select public.b14_reject('select * from marketplace_private.shop_memberships','42501');
select public.b14_reject('select public.marketplace_public_shop_image(gen_random_uuid())','42501');
select public.b14_reject('select marketplace_private.public_shop_eligibility(gen_random_uuid())','42501');
select public.b14_reject('select public.marketplace_public_shops(''{"tier":"pro"}'')','23514');
select public.b14_reject('select public.marketplace_public_shops(''{"pageSize":101}'')','23514');
select public.b14_reject('select public.marketplace_public_shops(''{"page":0}'')','23514');
select public.b14_reject('select public.marketplace_public_shops(''{"categories":["fake"]}'')','23514');
select public.b14_reject('select public.marketplace_public_shops(''{"sort":"price-low"}'')','23514');
select public.b14_assert(jsonb_array_length(public.marketplace_public_shop('B14_Local_81','{"pageSize":1}')->'listings')=1,'bounded products');
select public.b14_assert((public.marketplace_public_shop('B14_Local_81','{"pageSize":1}')->>'hasNextPage')::boolean,'next page uses same size');
select public.b14_assert(public.marketplace_public_shop('B14_Local_81','{"pageSize":1}')->'listings'->0->>'id'<>
 public.marketplace_public_shop('B14_Local_81','{"pageSize":1,"page":2}')->'listings'->0->>'id','stable pages distinct');
reset role;
-- Historical profile backfill legitimately has no cooldown; never bypass a trigger.
select public.b14_reject('update public.profiles set username=''too_soon'' where id=public.b14_owner(81)','P0001');
select set_config('request.jwt.claim.sub',public.b14_owner(91)::text,false);
select * from public.marketplace_create_shop('{"name":"Legacy Shop","category":"Electronics","description":"Public profile"}');
select public.b14_buy(91,'plus',clock_timestamp());
select public.b14_fill(91,1);
select public.marketplace_change_username('b15_renamed');
select public.b14_assert(public.marketplace_public_shop('B15_Legacy')->>'state'='not_found','old username no redirect history');
select public.b14_assert(jsonb_array_length(public.marketplace_public_shop('b15_renamed')->'listings')=1,'rename stable products');
-- Controlled membership expiry changes public read decisions without scheduler.
-- Existing paid active term still covers now; no destructive membership edits.
select public.b14_assert((select count(*)=3 from public.listings where seller_id=public.b14_owner(81)),'published plus draft retained');
select public.b14_assert(not exists(select 1 from public.b15_before x join pg_proc p on p.oid=x.oid where pg_get_functiondef(p.oid)<>x.definition),'B11/B12/B14 authority unchanged');
-- Real Grace downgrade retains all previously published rows above Plus capacity.
select public.b14_fill(87,45);
select public.b14_buy(87,'plus',clock_timestamp());
select public.b14_assert(jsonb_array_length(public.marketplace_public_shop('B14_Local_87','{"pageSize":100}')->'listings')=45,'over-capacity products preserved publicly');
select public.b14_reject('select public.marketplace_finalize_listing(public.b14_draft(87))','23514');
create table public.b15_media as select i.id,i.listing_id,l.published_at from public.listing_images i join public.listings l on l.id=i.listing_id where l.seller_id=public.b14_owner(81);
grant select on public.b15_media to service_role;
set role service_role;
select public.b14_assert((select public.marketplace_public_shop_image(id) is not null from public.b15_media where published_at is not null limit 1),'service-only eligible manifest resolver');
select public.b14_assert((select public.marketplace_public_shop_image(id) is null from public.b15_media where published_at is null limit 1),'resolver never grants draft bytes');
reset role;
-- Real expiry is observed in a separate query/statement clock after the wait.
select public.b14_buy(89,'plus',(timezone('America/Toronto',clock_timestamp()-interval '432000 seconds'+interval '2 seconds')-interval '1 month') at time zone 'America/Toronto');
select public.b14_fill(89,1);
select public.b14_assert(public.marketplace_public_shop('B14_Local_89')->>'state'='available','Grace before real boundary');
-- B15_REAL_EXPIRY
select public.b14_assert(public.marketplace_public_shop('B14_Local_89')='{"state":"unavailable"}','real expired Grace no scheduler');
select public.b14_assert(public.marketplace_public_shop_products(jsonb_build_object('id',(select id from public.listings where seller_id=public.b14_owner(89) and published_at is not null)))='{"state":"unavailable"}','suspended direct Listing has no product data');
select public.b14_assert((select public.marketplace_public_shop_image(id) is null from public.listing_images where owner_id=public.b14_owner(89) limit 1),'suspended image resolver denies');
select set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
select public.b14_reject(format('select public.marketplace_contact_seller(%L)',(select id from public.listings where seller_id=public.b14_owner(81) and published_at is not null limit 1)),'42501');
set role authenticated;
select public.b14_assert(public.marketplace_public_shop('B14_Local_85')='{"state":"unavailable"}','authenticated public DTO cannot bypass suspension');
select public.b14_reject('select * from marketplace_private.shop_membership_terms','42501');
reset role;

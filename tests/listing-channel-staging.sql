-- Reuse the existing dual-payment fixture factory for one real pending Order.
-- Its isolated SQL media receipts and all users/data are rolled back by runner.
alter table public.listings enable trigger listings_publication_boundary;
create function pg_temp.lc_listing(owner_id uuid,channel text) returns uuid language plpgsql as $$
declare lid uuid;i public.listing_images;
begin
  insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,expected_image_count,meeting_location,listing_channel)
  values(owner_id,'Channel rollback fixture','Synthetic channel qualification',10000,'CAD','Electronics','Cameras','good',1,'Library entrance',channel) returning id into lid;
  insert into public.listing_images(owner_id,listing_id,slot) values(owner_id,lid,1) returning * into i;
  insert into storage.objects(bucket_id,name,metadata) values('listing-images',i.path,'{"mimetype":"image/png","size":10}');
  update public.listing_images set ready=true where id=i.id;
  return lid;
end;$$;
create temporary table lc_ids(kind text primary key,id uuid);

select pg_temp.bc_actor(seller) from bc_people;
set local role authenticated;
insert into public.listings(title,description,price_cents,currency,category,subcategory,expected_image_count,meeting_location)
values('Normal Channel Create','Default channel',1000,'CAD','Electronics','Cameras',1,'Library entrance');
select pg_temp.bc_assert((select listing_channel='resale' from public.listings where title='Normal Channel Create' and seller_id=auth.uid()),'normal authenticated default resale');
select pg_temp.bc_reject($q$insert into public.listings(title,description,price_cents,currency,category,subcategory,expected_image_count,listing_channel)values('Forged','No authority',100,'CAD','Electronics','Cameras',1,'shop')$q$,'42501');
select pg_temp.bc_reject($q$update public.listings set listing_channel='shop' where seller_id=auth.uid()$q$,'42501');
reset role;

insert into lc_ids values('resale',pg_temp.lc_listing((select seller from bc_people),'resale'));
insert into lc_ids values('shop',pg_temp.lc_listing((select seller from bc_people),'shop'));
select set_config('test.lc_resale',(select id::text from lc_ids where kind='resale'),true),set_config('test.lc_shop',(select id::text from lc_ids where kind='shop'),true);
-- Shop profile presence is explicitly not entitlement.
insert into public.shops(owner_id,name,category,description)
select seller,'Rollback Shop','Electronics','Not an entitlement.' from bc_people;
set local role authenticated;
select public.marketplace_finalize_listing(current_setting('test.lc_resale')::uuid);
select public.marketplace_finalize_listing(current_setting('test.lc_resale')::uuid);
select pg_temp.bc_reject(format('select public.marketplace_finalize_listing(%L)',current_setting('test.lc_shop')),'42501');
select pg_temp.bc_assert((select count(*)=2 from public.listings where id in(current_setting('test.lc_resale')::uuid,current_setting('test.lc_shop')::uuid)),'owner creation read across channels');
select pg_temp.bc_assert((select count(*)=1 from public.listings where seller_id=auth.uid() and published_at is not null and listing_channel='resale'),'owner resale query');
reset role;
-- Only the privileged test path can publish this synthetic Shop Listing.
update public.listings set published_at=clock_timestamp() where id=current_setting('test.lc_shop')::uuid;
set local role authenticated;
select pg_temp.bc_assert((select count(*)=1 from public.listings where seller_id=auth.uid() and published_at is not null and listing_channel='shop'),'owner shop query');
select pg_temp.bc_assert((select count(*)=2 from public.listings where seller_id=auth.uid() and published_at is not null),'unscoped owner query includes both channels');
reset role;
select pg_temp.bc_reject(format('update public.listings set listing_channel=%L where id=%L','resale',current_setting('test.lc_shop')),'23514');
select pg_temp.bc_reject(format('update public.listings set listing_channel=%L where id=%L','shop',current_setting('test.lc_resale')),'23514');
select pg_temp.bc_reject(format('select pg_temp.lc_listing(%L,%L)',(select seller from bc_people),'both'),'23514');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.bc_assert((select count(*)=1 from public.listings where id=current_setting('test.lc_resale')::uuid),'public resale visible');
select pg_temp.bc_assert((select count(*)=0 from public.listings where id=current_setting('test.lc_shop')::uuid),'public Shop hidden');
reset role;
select pg_temp.bc_actor(buyer) from bc_people;
set local role authenticated;
select pg_temp.bc_assert((select count(*)=0 from public.listings where id=current_setting('test.lc_shop')::uuid),'nonowner authenticated public Shop hidden');
insert into public.listing_favorites(user_id,listing_id)values(auth.uid(),current_setting('test.lc_resale')::uuid);
select pg_temp.bc_assert((select count(*)=1 from public.listing_favorites where listing_id=current_setting('test.lc_resale')::uuid),'existing resale Favorite');
select pg_temp.bc_reject($q$insert into public.listing_favorites(user_id,listing_id)values(auth.uid(),current_setting('test.lc_shop')::uuid)$q$,'42501');
reset role;
insert into public.listing_favorites(user_id,listing_id)select buyer,current_setting('test.lc_shop')::uuid from bc_people;
select pg_temp.bc_assert(exists(select 1 from public.listing_favorites where listing_id=current_setting('test.lc_shop')::uuid),'same Favorite FK/PK accepts Shop relation without new schema');

-- Use the current authoritative Offer acceptance path, not a fabricated Order.
set constraints all immediate;
alter table public.listings disable trigger listings_publication_boundary;
set constraints all deferred;
do $$declare o public.orders;begin
  o:=pg_temp.bc_accept(jsonb_build_object('item_amount_cents',10000,'fulfillment','on_campus','meetup_location','Channel pending fixture','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode','external','payment_mode_version',1));
  perform set_config('test.lc_pending',o.listing_id::text,true);
end;$$;
set constraints all immediate;
alter table public.listings enable trigger listings_publication_boundary;
select pg_temp.bc_reject(format('update public.listings set listing_channel=%L where id=%L','shop',current_setting('test.lc_pending')),'23514');
select pg_temp.bc_actor(buyer) from bc_people;
set local role authenticated;
select pg_temp.bc_assert((select count(*)=1 from public.listings where id=current_setting('test.lc_pending')::uuid and status='pending' and listing_channel='resale'),'pending buyer participant read unchanged');
reset role;
select pg_temp.bc_actor(outsider) from bc_people;
set local role authenticated;
select pg_temp.bc_assert((select count(*)=0 from public.listings where id=current_setting('test.lc_pending')::uuid),'pending outsider hidden');
reset role;
select pg_temp.bc_assert(not has_column_privilege('authenticated','public.listings','listing_channel','INSERT') and not has_column_privilege('authenticated','public.listings','listing_channel','UPDATE'),'channel ACL absent');
set constraints all immediate;
select 'PASS default resale creation; forged channel ACL; immutable available/pending; owner read; resale finalize/retry; Shop finalize denied despite Shop profile; anon/public Shop hidden; shared resale Favorites/future FK; real Offer accept and pending participant read' result;

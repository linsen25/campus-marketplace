-- Native local fixture only; no environment files, SMTP or remote services.
insert into auth.users(id,email,email_confirmed_at) values
('11111111-1111-4111-8111-111111111111','b06-seller@uwo.ca',now()),
('22222222-2222-4222-8222-222222222222','b06-buyer@uwo.ca',now()),
('33333333-3333-4333-8333-333333333333','b06-outsider@uwo.ca',now()),
('44444444-4444-4444-8444-444444444444','b06-unverified@uwo.ca',null);
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.listings(id,seller_id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','B06 one','Fixture',100,'Electronics','Cameras','Campus',1),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','B06 race','Fixture',100,'Electronics','Cameras','Campus',1);
-- Historical public source fixture, not a new image-isolation implementation.
insert into public.listing_images(listing_id,owner_id,slot) select id,seller_id,1 from public.listings;
insert into storage.objects(bucket_id,name,metadata) select 'listing-images',path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images;
update public.listing_images set ready=true;
select public.marketplace_finalize_listing(id) from public.listings;
set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select (public.marketplace_contact_seller('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')).id;
reset role;

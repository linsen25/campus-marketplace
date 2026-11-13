-- Ordinary confirmed-email users may read their own unpublished Resale rows.
-- Ownership, channel and public visibility boundaries remain unchanged.
begin;

drop policy if exists listings_creation_owner_read on public.listings;
create policy listings_creation_owner_read on public.listings for select to authenticated
using (seller_id = (select auth.uid()) and (select marketplace_private.is_verified_user()));

drop policy if exists images_creation_owner_read on public.listing_images;
create policy images_creation_owner_read on public.listing_images for select to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_verified_user()));

commit;

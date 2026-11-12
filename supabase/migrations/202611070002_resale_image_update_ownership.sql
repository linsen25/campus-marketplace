-- Preserve listing ownership when an owner updates draft image metadata.
begin;

drop policy if exists images_owner_update on public.listing_images;
create policy images_owner_update on public.listing_images
for update to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.listings l
    where l.id = listing_id
      and l.seller_id = (select auth.uid())
      and (
        (l.listing_channel = 'resale' and (select marketplace_private.is_verified_user()))
        or (l.listing_channel <> 'resale' and (select marketplace_private.is_western_user()))
      )
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.listings l
    where l.id = listing_id
      and l.seller_id = (select auth.uid())
      and (
        (l.listing_channel = 'resale' and (select marketplace_private.is_verified_user()))
        or (l.listing_channel <> 'resale' and (select marketplace_private.is_western_user()))
      )
  )
);

commit;

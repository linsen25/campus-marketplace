-- Ordinary confirmed-email users may manage their own unpublished Resale images.
-- Shop/legacy public-bucket image paths retain their existing Western-only gate.
begin;

drop policy if exists images_owner_insert on public.listing_images;
create policy images_owner_insert on public.listing_images
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and not ready
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
with check (owner_id = (select auth.uid()));

drop policy if exists images_owner_delete on public.listing_images;
create policy images_owner_delete on public.listing_images
for delete to authenticated
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
);

drop policy if exists listing_private_select_guard on storage.objects;
create policy listing_private_select_guard on storage.objects as restrictive
for select to anon, authenticated
using (
  bucket_id <> 'listing-images-private'
  or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and (select marketplace_private.is_verified_user())
  )
);

drop policy if exists listing_private_owner_read on storage.objects;
create policy listing_private_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'listing-images-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select marketplace_private.is_verified_user())
);

drop policy if exists marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('listing-images', 'listing-images-private')
  and (
    (bucket_id = 'listing-images-private' and (select marketplace_private.is_verified_user()))
    or (bucket_id = 'listing-images' and (select marketplace_private.is_western_user()))
  )
  and exists (
    select 1
    from public.listing_images i
    join public.listings l on l.id = i.listing_id
    where i.path = name
      and i.storage_bucket = bucket_id
      and i.owner_id = (select auth.uid())
      and not i.ready
      and l.published_at is null
      and l.status = 'available'
      and (l.listing_channel <> 'resale' or bucket_id = 'listing-images-private')
  )
);

drop policy if exists listing_private_insert_guard on storage.objects;
create policy listing_private_insert_guard on storage.objects as restrictive
for insert to anon, authenticated
with check (
  bucket_id <> 'listing-images-private'
  or (
    (select marketplace_private.is_verified_user())
    and exists (
      select 1
      from public.listing_images i
      join public.listings l on l.id = i.listing_id
      where i.path = name
        and i.storage_bucket = bucket_id
        and i.owner_id = (select auth.uid())
        and not i.ready
        and l.published_at is null
        and l.status = 'available'
        and l.listing_channel = 'resale'
    )
  )
);

drop policy if exists marketplace_storage_owner_delete on storage.objects;
create policy marketplace_storage_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id in ('listing-images', 'listing-images-private')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    (bucket_id = 'listing-images-private' and (select marketplace_private.is_verified_user()))
    or (bucket_id = 'listing-images' and (select marketplace_private.is_western_user()))
  )
  and not exists (
    select 1
    from public.listing_images i
    where i.path = name and i.storage_bucket = bucket_id
  )
);

drop policy if exists listing_private_delete_guard on storage.objects;
create policy listing_private_delete_guard on storage.objects as restrictive
for delete to anon, authenticated
using (
  bucket_id <> 'listing-images-private'
  or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and (select marketplace_private.is_verified_user())
    and not exists (
      select 1
      from public.listing_images i
      where i.path = name and i.storage_bucket = bucket_id
    )
  )
);

commit;

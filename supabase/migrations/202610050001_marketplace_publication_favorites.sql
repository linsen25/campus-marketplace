-- Pending review. Apply after 202610040001_marketplace_taxonomy.sql; no live SQL here.
begin;
lock table public.listings, public.listing_images in access exclusive mode;

-- Existing rows retain publication only when their image set is demonstrably valid.
-- Abort rather than inventing photos/manifests for unexpected old rows.
do $$
begin
  if exists (select 1 from public.listings l where
    (select count(*) from public.listing_images i where i.listing_id = l.id) not between 1 and 6
    or exists (select 1 from public.listing_images i where i.listing_id = l.id and
      (not i.ready or i.owner_id <> l.seller_id
        or i.slot > (select count(*) from public.listing_images x where x.listing_id = l.id)
        or not exists (select 1 from storage.objects o
          where o.bucket_id = 'listing-images' and o.name = i.path
            and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
            and case when o.metadata->>'size' ~ '^[0-9]{1,7}$'
              then (o.metadata->>'size')::bigint between 1 and 3145728 else false end)))) then
    raise exception 'Publication migration aborted: existing listings require review of a complete valid 1-6 image set. No data was deleted.';
  end if;
end; $$;

alter table public.listings add column published_at timestamptz;
-- Immutable creation manifest: finalization must not accept a partial upload set.
alter table public.listings add column expected_image_count smallint
  check (expected_image_count between 1 and 6);
update public.listings l set published_at = l.created_at,
  expected_image_count = (select count(*) from public.listing_images i where i.listing_id = l.id);
alter table public.listings alter column expected_image_count set not null;
grant insert(expected_image_count) on public.listings to authenticated;
revoke update(category, subcategory, published_at, expected_image_count) on public.listings from authenticated;

drop policy listings_public_read on public.listings;
create policy listings_public_read on public.listings for select
using (published_at is not null and status = 'available');
create policy listings_creation_owner_read on public.listings for select to authenticated
using (seller_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
drop policy images_public_read on public.listing_images;
create policy images_public_read on public.listing_images for select using (
  ready and exists (select 1 from public.listings l
    where l.id = listing_id and l.published_at is not null and l.status = 'available')
);
create policy images_creation_owner_read on public.listing_images for select to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()));

create function marketplace_private.assert_listing_images_complete(target public.listings)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.listing_images where listing_id = target.id)
      <> target.expected_image_count
    or exists (select 1 from public.listing_images i where i.listing_id = target.id and
      (not i.ready or i.owner_id <> target.seller_id or i.slot > target.expected_image_count
        or not exists (select 1 from storage.objects o
          where o.bucket_id = 'listing-images' and o.name = i.path
            and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
            and (o.metadata->>'size')::bigint between 1 and 3145728))) then
    raise exception 'Complete the required image set before publishing.' using errcode = '23514';
  end if;
end; $$;

create function marketplace_private.protect_listing_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.published_at is not null or new.status <> 'available' then
      raise exception 'Create an unpublished available listing first.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.expected_image_count is distinct from old.expected_image_count then
    raise exception 'The creation image manifest is immutable.' using errcode = '23514';
  end if;
  if old.status = 'sold' and row(new.title,new.price_cents,new.description,new.condition,new.pickup_area,new.status)
    is distinct from row(old.title,old.price_cents,old.description,old.condition,old.pickup_area,old.status) then
    raise exception 'Sold listings cannot be edited.' using errcode = '23514';
  end if;
  if new.published_at is distinct from old.published_at then
    if old.published_at is not null or new.published_at is null or new.status <> 'available' then
      raise exception 'Publication cannot be reversed or changed.' using errcode = '23514';
    end if;
    perform marketplace_private.assert_listing_images_complete(new);
  elsif old.published_at is null and new.status <> 'available' then
    raise exception 'Publish before marking a listing sold.' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger listings_publication_boundary before insert or update on public.listings
for each row execute function marketplace_private.protect_listing_publication();

create function public.marketplace_finalize_listing(listing_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target public.listings;
begin
  if not marketplace_private.is_western_user() then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into target from public.listings l where l.id = listing_id for update;
  if not found or target.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found or not owned by you.' using errcode = '42501';
  end if;
  -- Idempotent retry after a lost HTTP response; never rewrites publication time.
  if target.published_at is not null then return target.id; end if;
  perform marketplace_private.assert_listing_images_complete(target);
  update public.listings set published_at = now() where id = target.id;
  return target.id;
end; $$;
revoke all on function public.marketplace_finalize_listing(uuid) from public, anon;
grant execute on function public.marketplace_finalize_listing(uuid) to authenticated;

-- Parent locks serialize image mutations with finalization. Listing deletion's
-- FK cascade is allowed once its parent no longer exists in the transaction.
create function marketplace_private.protect_published_listing_images() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.listings; parent_id uuid;
begin
  parent_id := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  if tg_op = 'UPDATE' and row(new.id,new.listing_id,new.owner_id,new.slot)
    is distinct from row(old.id,old.listing_id,old.owner_id,old.slot) then
    raise exception 'Image identity/order cannot be rewritten.' using errcode = '23514';
  end if;
  select * into target from public.listings where id = parent_id for update;
  if found and (target.published_at is not null or target.status <> 'available') then
    raise exception 'Published listing images are immutable.' using errcode = '23514';
  end if;
  if tg_op <> 'DELETE' and (target.id is null or new.owner_id <> target.seller_id
    or new.slot > target.expected_image_count) then
    raise exception 'Image is outside the creation manifest.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
create trigger listing_images_publication_lock before insert or update or delete on public.listing_images
for each row execute function marketplace_private.protect_published_listing_images();

-- Storage operations remain API-only. Never delete an object still referenced
-- by image metadata: remove unpublished metadata first, then clean up its orphan.
drop policy marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'listing-images' and (select marketplace_private.is_western_user())
  and exists (select 1 from public.listing_images i join public.listings l on l.id = i.listing_id
    where i.path = name and i.owner_id = (select auth.uid()) and not i.ready
      and l.published_at is null and l.status = 'available')
);
drop policy marketplace_storage_owner_delete on storage.objects;
create policy marketplace_storage_owner_delete on storage.objects for delete to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select marketplace_private.is_western_user())
  and not exists (select 1 from public.listing_images i where i.path = name)
);
-- No Storage UPDATE/upsert policy or custom storage.objects trigger is added.

create table public.listing_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index listing_favorites_listing on public.listing_favorites(listing_id);
alter table public.listing_favorites enable row level security;
revoke all on public.listing_favorites from public, anon, authenticated;
grant select, delete on public.listing_favorites to authenticated;
grant insert(user_id, listing_id) on public.listing_favorites to authenticated;
create policy favorites_own_read on public.listing_favorites for select to authenticated
using (user_id = (select auth.uid()));
create policy favorites_own_delete on public.listing_favorites for delete to authenticated
using (user_id = (select auth.uid()));
create policy favorites_eligible_insert on public.listing_favorites for insert to authenticated
with check (user_id = (select auth.uid()) and (select marketplace_private.is_western_user())
  and exists (select 1 from public.listings l where l.id = listing_id
    and l.published_at is not null and l.status = 'available' and l.seller_id <> (select auth.uid())));
-- Serialize eligibility with a concurrent sold transition/deletion.
create function marketplace_private.protect_favorite_eligibility() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.listings;
begin
  select * into target from public.listings where id = new.listing_id for share;
  if not found or target.published_at is null or target.status <> 'available'
    or target.seller_id = new.user_id then
    raise exception 'Only another seller''s published available listing can be favorited.' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger listing_favorites_eligibility before insert on public.listing_favorites
for each row execute function marketplace_private.protect_favorite_eligibility();

revoke all on function marketplace_private.assert_listing_images_complete(public.listings),
  marketplace_private.protect_listing_publication(),
  marketplace_private.protect_published_listing_images(),
  marketplace_private.protect_favorite_eligibility() from public, anon, authenticated;
commit;

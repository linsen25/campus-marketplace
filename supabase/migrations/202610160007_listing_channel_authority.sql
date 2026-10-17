-- Channel read/query authority only. Shop provisioning/public eligibility is absent.
begin;
alter table public.listings
  add column listing_channel text not null default 'resale'
  constraint listings_listing_channel_check check (listing_channel in ('resale','shop'));

create function marketplace_private.protect_listing_channel() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.listing_channel is distinct from new.listing_channel then
    raise exception 'Listing channel is immutable after creation.' using errcode='23514';
  end if;
  return new;
end;$$;
revoke all on function marketplace_private.protect_listing_channel() from public,anon,authenticated,service_role;
create trigger listings_channel_immutable before update on public.listings
for each row execute function marketplace_private.protect_listing_channel();

-- No client INSERT/UPDATE authority on the new column. Normal creation omits it.
revoke insert(listing_channel),update(listing_channel) on public.listings from public,anon,authenticated,service_role;
alter policy listings_public_read on public.listings
using (published_at is not null and status='available' and listing_channel='resale');

create or replace function public.marketplace_finalize_listing(listing_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare target public.listings;
begin
  if not marketplace_private.is_western_user() then
    raise exception 'Verified Western account required.' using errcode='42501';
  end if;
  select * into target from public.listings l where l.id=listing_id for update;
  if not found or target.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found or not owned by you.' using errcode='42501';
  end if;
  -- Before even the idempotent published return: a Shop row is not entitlement.
  if target.listing_channel<>'resale' then
    raise exception 'Shop Listing publication is unavailable until Shop eligibility is implemented.' using errcode='42501';
  end if;
  if target.published_at is not null then return target.id;end if;
  perform marketplace_private.assert_listing_images_complete(target);
  update public.listings set published_at=now() where id=target.id;
  return target.id;
end;$$;
revoke all on function public.marketplace_finalize_listing(uuid) from public,anon;
grant execute on function public.marketplace_finalize_listing(uuid) to authenticated;

create index listings_public_channel_newest on public.listings(listing_channel,created_at desc,id)
where published_at is not null and status='available';
create index listings_owner_channel_newest on public.listings(seller_id,listing_channel,created_at desc,id)
where published_at is not null;
commit;

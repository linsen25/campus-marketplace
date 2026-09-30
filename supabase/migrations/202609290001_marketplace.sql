-- Apply once in a new Supabase project's SQL Editor (or with Supabase CLI).
begin;
create schema if not exists marketplace_private;
revoke all on schema marketplace_private from public;
grant usage on schema marketplace_private to authenticated;

create function marketplace_private.is_western_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where id = (select auth.uid())
    and email_confirmed_at is not null and lower(email) ~ '^[^[:space:]@]+@uwo[.]ca$');
$$;
revoke all on function marketplace_private.is_western_user() from public;
grant execute on function marketplace_private.is_western_user() to authenticated;

create function public.before_western_user_created(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if coalesce(lower(event->'user'->>'email'), '') !~ '^[^[:space:]@]+@uwo[.]ca$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'An @uwo.ca email is required.'));
  end if;
  return '{}'::jsonb;
end; $$;
revoke all on function public.before_western_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.before_western_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- Backstop for direct Auth signup calls and subsequent email changes.
create function marketplace_private.enforce_western_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(lower(new.email), '') !~ '^[^[:space:]@]+@uwo[.]ca$' then
    raise exception 'An @uwo.ca email is required.' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger marketplace_western_email before insert or update of email on auth.users
for each row execute function marketplace_private.enforce_western_email();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function marketplace_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare display text;
begin
  display := btrim(coalesce(new.raw_user_meta_data->>'display_name', ''));
  if length(display) not between 1 and 60 then display := 'Western member'; end if;
  insert into public.profiles(id, display_name) values (new.id, display);
  return new;
end; $$;
create trigger marketplace_create_profile after insert on auth.users
for each row execute function marketplace_private.create_profile();
insert into public.profiles(id, display_name)
select id, 'Western member' from auth.users where lower(email) ~ '^[^[:space:]@]+@uwo[.]ca$'
on conflict (id) do nothing;

create function marketplace_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger profiles_updated before update on public.profiles
for each row execute function marketplace_private.touch_updated_at();

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references public.profiles(id),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 5000),
  price_cents bigint not null check (price_cents between 0 and 9007199254740991),
  currency text not null default 'CAD' check (currency = 'CAD'),
  category text not null check (category in ('furniture','electronics','books','clothing','home-kitchen','free','sports-hobbies','other')),
  condition text check (condition in ('new','like-new','good','fair')),
  pickup_area text not null check (length(btrim(pickup_area)) between 1 and 120),
  status text not null default 'available' check (status in ('available','sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (title || ' ' || description || ' ' || pickup_area) stored
);
create index listings_available_newest on public.listings(status, created_at desc);
create index listings_seller on public.listings(seller_id, created_at desc);
create trigger listings_updated before update on public.listings
for each row execute function marketplace_private.touch_updated_at();

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id),
  slot smallint not null check (slot between 1 and 6),
  path text generated always as (owner_id::text || '/' || listing_id::text || '/' || id::text) stored unique,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique (listing_id, slot)
);

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
revoke all on public.profiles, public.listings, public.listing_images from anon, authenticated;
grant select on public.profiles, public.listings, public.listing_images to anon, authenticated;
grant update(display_name) on public.profiles to authenticated;
grant insert(title,description,price_cents,currency,category,condition,pickup_area) on public.listings to authenticated;
grant update(title,description,price_cents,currency,category,condition,pickup_area,status) on public.listings to authenticated;
grant delete on public.listings to authenticated;
grant insert(listing_id,slot), update(ready), delete on public.listing_images to authenticated;

create policy profiles_public_read on public.profiles for select using (true);
create policy profiles_owner_update on public.profiles for update to authenticated
using (id = (select auth.uid()) and (select marketplace_private.is_western_user()))
with check (id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy listings_public_read on public.listings for select using (true);
create policy listings_owner_insert on public.listings for insert to authenticated
with check (seller_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy listings_owner_update on public.listings for update to authenticated
using (seller_id = (select auth.uid()) and (select marketplace_private.is_western_user()))
with check (seller_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy listings_owner_delete on public.listings for delete to authenticated
using (seller_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy images_public_read on public.listing_images for select using (ready or owner_id = (select auth.uid()));
create policy images_owner_insert on public.listing_images for insert to authenticated with check (
  owner_id = (select auth.uid()) and not ready and (select marketplace_private.is_western_user())
  and exists (select 1 from public.listings where id = listing_id and seller_id = (select auth.uid()))
);
create policy images_owner_update on public.listing_images for update to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()))
with check (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy images_owner_delete on public.listing_images for delete to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('listing-images','listing-images',true,3145728,array['image/jpeg','image/png','image/webp']);
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'listing-images' and (select marketplace_private.is_western_user())
  and exists (select 1 from public.listing_images where path = name and owner_id = (select auth.uid()) and not ready)
);
create policy marketplace_storage_owner_read on storage.objects for select to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select marketplace_private.is_western_user())
);
-- Path ownership still permits cleanup after the listing row has been deleted.
create policy marketplace_storage_owner_delete on storage.objects for delete to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select marketplace_private.is_western_user())
);
-- No UPDATE policy: object overwrite/upsert is deliberately disabled.
create function marketplace_private.verify_image_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ready and not exists (
    -- Generated columns are not populated yet in a BEFORE trigger.
    select 1 from storage.objects where bucket_id = 'listing-images'
      and name = new.owner_id::text || '/' || new.listing_id::text || '/' || new.id::text
      and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
      and (metadata->>'size')::bigint between 1 and 3145728
  ) then raise exception 'Upload a valid image before attaching it.' using errcode = '23514'; end if;
  return new;
end; $$;
create trigger listing_image_ready before update on public.listing_images
for each row execute function marketplace_private.verify_image_ready();
revoke all on all functions in schema marketplace_private from public;
grant execute on function marketplace_private.is_western_user() to authenticated;
commit;

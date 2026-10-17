-- Shop profile data only. Row existence never grants Pro/public eligibility.
begin;

-- Match the existing JavaScript shopIdentityError: trim() then UTF-16 length.
-- PostgreSQL char_length alone counts astral characters differently, and btrim
-- alone does not trim tabs/nonbreaking spaces. This pure helper reads no data.
create function marketplace_private.shop_profile_text_length(value text) returns integer
language sql immutable strict set search_path='' as $$
  select char_length(trimmed) + char_length(regexp_replace(trimmed,U&'[^\+010000-\+10FFFF]','','g'))
  from (select btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') trimmed) t;
$$;
revoke all on function marketplace_private.shop_profile_text_length(text) from public,anon,authenticated,service_role;
grant execute on function marketplace_private.shop_profile_text_length(text) to authenticated;

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null,
  category text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_name_check check (marketplace_private.shop_profile_text_length(name) between 1 and 40),
  constraint shops_category_check check (category in (
    'Clothing & Accessories','Electronics','Collectibles','Home & Living'
  )),
  -- Existing shopIdentityError requires a nonempty description. The structural
  -- default is not a valid profile: privileged creation must supply real text.
  constraint shops_description_check check (marketplace_private.shop_profile_text_length(description) between 1 and 200)
);

create trigger shops_updated before update on public.shops
for each row execute function marketplace_private.touch_updated_at();

alter table public.shops enable row level security;
revoke all on public.shops from public, anon, authenticated, service_role;
grant select on public.shops to authenticated;
grant update(name,category,description) on public.shops to authenticated;

create policy shops_owner_read on public.shops for select to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()));
create policy shops_owner_update on public.shops for update to authenticated
using (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()))
with check (owner_id = (select auth.uid()) and (select marketplace_private.is_western_user()));

-- Intentionally no INSERT/DELETE policy or grant, public SELECT, activation,
-- entitlement, or listing association. Future provisioning needs its own authority.
commit;

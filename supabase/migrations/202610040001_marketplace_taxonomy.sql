-- Pending review: do not apply live SQL automatically.
-- Apply after 202610030001_marketplace_usernames.sql.
begin;
-- Serialize the empty-table guard with every concurrent listing writer.
lock table public.listings in access exclusive mode;
do $$
begin
  if exists (select 1 from public.listings) then
    raise exception 'Canonical taxonomy migration aborted: listings exist and have no stored subcategory. Review and explicitly classify existing rows before retrying.';
  end if;
end; $$;

alter table public.listings drop constraint listings_category_check;
alter table public.listings add column subcategory text not null;
alter table public.listings add constraint listings_category_subcategory_check check (
    (category = 'Electronics' and subcategory in ('Computers & Tablets', 'Phones & Accessories', 'Monitors', 'Audio & Headphones', 'Gaming & Consoles', 'Cameras', 'Cables & Accessories'))
    or
    (category = 'Home & Dorm' and subcategory in ('Furniture', 'Kitchen & Dining', 'Small Appliances', 'Bedding & Bath', 'Storage & Organization', 'Lighting & Decor', 'Cleaning'))
    or
    (category = 'Textbooks & School' and subcategory in ('Textbooks', 'Calculators', 'Stationery', 'School Supplies', 'Lab & Art Supplies', 'Backpacks'))
    or
    (category = 'Clothing & Accessories' and subcategory in ('Tops & Bottoms', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Formalwear'))
    or
    (category = 'Sports & Outdoors' and subcategory in ('Fitness & Gym', 'Team Sports', 'Racket Sports', 'Winter Sports', 'Camping & Outdoors', 'Other Sports'))
    or
    (category = 'Bikes & Mobility' and subcategory in ('Bikes', 'E-bikes & Scooters', 'Skateboards', 'Helmets & Safety', 'Locks & Lights', 'Parts & Accessories'))
    or
    (category = 'Games & Hobbies' and subcategory in ('Video Games', 'Board Games', 'Musical Instruments', 'Books & Media', 'Arts & Crafts', 'Collectibles'))
    or
    (category = 'Other' and subcategory in ('Other'))
);
-- Include canonical category/subcategory in the existing real search contract.
alter table public.listings drop column search_text;
alter table public.listings add column search_text text
  generated always as (title || ' ' || description || ' ' || pickup_area || ' ' || category || ' ' || subcategory) stored;
grant insert(subcategory) on public.listings to authenticated;
revoke update(category) on public.listings from authenticated;

-- Existing listings are published immediately (available or sold).
-- Protect classification even for privileged writes; allow same-value no-ops.
create function marketplace_private.protect_listing_taxonomy() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory then
    raise exception 'Listing category and subcategory cannot be changed after creation.' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger listings_taxonomy_immutable before update on public.listings
for each row execute function marketplace_private.protect_listing_taxonomy();
revoke all on function marketplace_private.protect_listing_taxonomy() from public, anon, authenticated;
commit;

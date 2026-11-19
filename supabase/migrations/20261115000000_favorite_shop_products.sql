-- A signed-in user's saved Shop products need the same public eligibility
-- boundary as the public Shop directory. This projection filters before
-- pagination and never exposes a non-public Shop's identity.
begin;

create function public.marketplace_favorite_shop_products(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  page integer;
  page_size integer;
  selected_shop uuid;
  rows jsonb;
  available_shops jsonb;
  delay integer;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(), false) then
    raise exception 'Verified account required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_query) <> 'object' or exists (
    select 1
    from jsonb_object_keys(p_query) key
    where key not in ('page', 'pageSize', 'shopId')
  ) then
    raise exception 'Invalid Shop favorites query.' using errcode = '23514';
  end if;
  page := coalesce((p_query->>'page')::integer, 1);
  page_size := coalesce((p_query->>'pageSize')::integer, 20);
  if page < 1 or page_size < 1 or page_size > 100 then
    raise exception 'Invalid Shop favorites page.' using errcode = '23514';
  end if;
  if p_query ? 'shopId' then
    if (p_query->>'shopId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid Shop identity.' using errcode = '23514';
    end if;
    selected_shop := (p_query->>'shopId')::uuid;
  end if;

  select coalesce(jsonb_agg(shop_identity order by shop_name, username), '[]'::jsonb)
  into available_shops
  from (
    select distinct
      s.name as shop_name,
      p.username as username,
      jsonb_build_object('id', s.id, 'shopName', s.name, 'username', p.username) as shop_identity
    from public.listing_favorites f
    join public.listings l on l.id = f.listing_id
    join public.shops s on s.owner_id = l.seller_id
    join public.profiles p on p.id = s.owner_id
    cross join lateral (
      select marketplace_private.public_shop_eligibility(s.owner_id) as value
    ) eligibility
    where f.user_id = actor
      and l.seller_id <> actor
      and l.listing_channel = 'shop'
      and l.published_at is not null
      and l.status = 'available'
      and p.username is not null
      and eligibility.value is not null
  ) eligible_shops;

  select
    coalesce(jsonb_agg(payload order by position), '[]'::jsonb),
    coalesce(min(refresh_after_ms), 30000)
  into rows, delay
  from (
    select
      jsonb_build_object(
        'listing', marketplace_private.public_shop_product(l),
        'shop', jsonb_build_object('id', s.id, 'shopName', s.name, 'username', p.username)
      ) as payload,
      (eligibility.value->>'refreshAfterMs')::integer as refresh_after_ms,
      row_number() over (order by l.created_at desc, l.id) as position
    from public.listing_favorites f
    join public.listings l on l.id = f.listing_id
    join public.shops s on s.owner_id = l.seller_id
    join public.profiles p on p.id = s.owner_id
    cross join lateral (
      select marketplace_private.public_shop_eligibility(s.owner_id) as value
    ) eligibility
    where f.user_id = actor
      and l.seller_id <> actor
      and l.listing_channel = 'shop'
      and l.published_at is not null
      and l.status = 'available'
      and p.username is not null
      and eligibility.value is not null
      and (selected_shop is null or s.id = selected_shop)
    order by position
    offset (page - 1) * page_size
    limit page_size + 1
  ) paged;

  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(rows) with ordinality item(value, ordinal)
      where ordinal <= page_size
    ),
    'shops', available_shops,
    'page', page,
    'hasNextPage', jsonb_array_length(rows) > page_size,
    'refreshAfterMs', greatest(100, least(30000, delay))
  );
end;
$$;

revoke all on function public.marketplace_favorite_shop_products(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_favorite_shop_products(jsonb) to authenticated;

commit;

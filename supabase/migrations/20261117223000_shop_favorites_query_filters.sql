-- Local development only until isolated PostgreSQL tests pass.
-- Favorites filters must apply before the existing pageSize+1 pagination.
-- No Billing/Shop Membership rights or tables are changed.
begin;

create or replace function public.marketplace_favorite_shops(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  q jsonb;
  search_term text := '';
  category_term text := '';
  sort_term text := 'newest';
  result_rows jsonb;
  delay integer;
  page_size integer;
  page_number integer;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  if jsonb_typeof(p_query) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_query) k
    where k not in ('page','pageSize','search','category','sort')
  ) then raise exception 'Invalid Shop favorites query.' using errcode='23514'; end if;
  if p_query ? 'search' then
    if jsonb_typeof(p_query->'search') <> 'string' or length(p_query->>'search') > 200 then
      raise exception 'Invalid search.' using errcode='23514'; end if;
    search_term := lower(btrim(p_query->>'search'));
  end if;
  if p_query ? 'category' then
    if jsonb_typeof(p_query->'category') <> 'string' or length(p_query->>'category') > 120 then
      raise exception 'Invalid category.' using errcode='23514'; end if;
    category_term := p_query->>'category';
  end if;
  if p_query ? 'sort' then
    if jsonb_typeof(p_query->'sort') <> 'string' or p_query->>'sort' not in ('newest','name') then
      raise exception 'Invalid sort.' using errcode='23514'; end if;
    sort_term := p_query->>'sort';
  end if;
  q := marketplace_private.public_shop_query(p_query - 'search' - 'category' - 'sort',array['page','pageSize']);
  page_size := (q->>'pageSize')::integer;
  page_number := (q->>'page')::integer;

  select coalesce(jsonb_agg(item order by position),'[]'::jsonb), coalesce(min(refresh_delay),30000)
  into result_rows, delay
  from (
    select marketplace_private.public_shop_profile(s) item,
      (eligibility.value->>'refreshAfterMs')::integer refresh_delay,
      row_number() over (
        order by
          case when sort_term='name' then lower(s.name) end asc,
          case when sort_term='newest' then f.created_at end desc,
          f.created_at desc, s.id
      ) position
    from public.shop_favorites f
    join public.shops s on s.id=f.shop_id
    cross join lateral (
      select marketplace_private.public_shop_eligibility(s.owner_id) value
    ) eligibility
    where f.user_id=actor and eligibility.value is not null
      and (search_term='' or position(search_term in lower(s.name)) > 0)
      and (category_term='' or
        case s.category
          when 'Clothing & Accessories' then 'Fashion & Accessories'
          when 'Electronics' then 'Tech & Electronics'
          when 'Collectibles' then 'Collectibles & Hobbies'
          when 'Home & Living' then 'Home & Dorm'
          else s.category end = category_term)
    order by position
    offset (page_number-1)*page_size limit page_size+1
  ) paged;
  return jsonb_build_object(
    'shops',(select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb)
             from jsonb_array_elements(result_rows) with ordinality r(value,ordinal)
             where ordinal<=page_size),
    'page',page_number,
    'hasNextPage',jsonb_array_length(result_rows)>page_size,
    'refreshAfterMs',greatest(100,least(30000,delay))
  );
end;$$;

create or replace function public.marketplace_favorite_shop_products(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  page_number integer;
  page_size integer;
  selected_shop uuid;
  search_term text := '';
  category_term text := '';
  sort_term text := 'newest';
  result_rows jsonb;
  available_shops jsonb;
  delay integer;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    raise exception 'Verified account required.' using errcode='42501'; end if;
  if jsonb_typeof(p_query) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_query) k
    where k not in ('page','pageSize','shopId','search','category','sort')
  ) then raise exception 'Invalid Shop favorites query.' using errcode='23514'; end if;
  if p_query ? 'search' then
    if jsonb_typeof(p_query->'search') <> 'string' or length(p_query->>'search')>200 then
      raise exception 'Invalid search.' using errcode='23514'; end if;
    search_term := lower(btrim(p_query->>'search'));
  end if;
  if p_query ? 'category' then
    if jsonb_typeof(p_query->'category') <> 'string' or length(p_query->>'category')>120 then
      raise exception 'Invalid category.' using errcode='23514'; end if;
    category_term := p_query->>'category';
  end if;
  if p_query ? 'sort' then
    if jsonb_typeof(p_query->'sort') <> 'string' or p_query->>'sort' not in ('newest','name','price-asc','price-desc') then
      raise exception 'Invalid sort.' using errcode='23514'; end if;
    sort_term := p_query->>'sort';
  end if;
  page_number := coalesce((p_query->>'page')::integer,1);
  page_size := coalesce((p_query->>'pageSize')::integer,20);
  if page_number<1 or page_size<1 or page_size>100 then
    raise exception 'Invalid Shop favorites page.' using errcode='23514'; end if;
  if p_query ? 'shopId' then
    if jsonb_typeof(p_query->'shopId') <> 'string' or
      (p_query->>'shopId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid Shop identity.' using errcode='23514'; end if;
    selected_shop := (p_query->>'shopId')::uuid;
  end if;

  -- The Shop filter options must stay based on all currently eligible favorites.
  select coalesce(jsonb_agg(shop_identity order by shop_name,username),'[]'::jsonb)
  into available_shops from (
    select distinct s.name shop_name,p.username username,
      jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username) shop_identity
    from public.listing_favorites f
    join public.listings l on l.id=f.listing_id
    join public.shops s on s.owner_id=l.seller_id
    join public.profiles p on p.id=s.owner_id
    cross join lateral (select marketplace_private.public_shop_eligibility(s.owner_id) value) eligibility
    where f.user_id=actor and l.seller_id<>actor and l.listing_channel='shop'
      and l.published_at is not null and l.status='available' and l.archived_at is null
      and p.username is not null and eligibility.value is not null
  ) eligible_shops;

  select coalesce(jsonb_agg(payload order by position),'[]'::jsonb),coalesce(min(refresh_delay),30000)
  into result_rows,delay from (
    select jsonb_build_object(
      'listing',marketplace_private.public_shop_product(l),
      'shop',jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username)
    ) payload,
    (eligibility.value->>'refreshAfterMs')::integer refresh_delay,
    row_number() over (
      order by
        case when sort_term='name' then lower(l.title) end asc,
        case when sort_term='price-asc' then l.price_cents end asc,
        case when sort_term='price-desc' then l.price_cents end desc,
        l.created_at desc,l.id
    ) position
    from public.listing_favorites f
    join public.listings l on l.id=f.listing_id
    join public.shops s on s.owner_id=l.seller_id
    join public.profiles p on p.id=s.owner_id
    cross join lateral (select marketplace_private.public_shop_eligibility(s.owner_id) value) eligibility
    where f.user_id=actor and l.seller_id<>actor and l.listing_channel='shop'
      and l.published_at is not null and l.status='available' and l.archived_at is null
      and p.username is not null and eligibility.value is not null
      and (selected_shop is null or s.id=selected_shop)
      and (search_term='' or position(search_term in lower(l.title))>0)
      and (category_term='' or l.category=category_term)
    order by position
    offset (page_number-1)*page_size limit page_size+1
  ) paged;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb)
             from jsonb_array_elements(result_rows) with ordinality item(value,ordinal)
             where ordinal<=page_size),
    'shops',available_shops,'page',page_number,
    'hasNextPage',jsonb_array_length(result_rows)>page_size,
    'refreshAfterMs',greatest(100,least(30000,delay))
  );
end;$$;

revoke all on function public.marketplace_favorite_shops(jsonb),
  public.marketplace_favorite_shop_products(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_favorite_shops(jsonb),
  public.marketplace_favorite_shop_products(jsonb) to authenticated;
commit;

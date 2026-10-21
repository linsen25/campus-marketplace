-- Public read projections only. B14 write/transaction authority is unchanged.
begin;

create function marketplace_private.public_shop_eligibility(p_owner uuid) returns jsonb
language sql stable set search_path='' as $$
 select case when (e->>'canOperateShop')::boolean and exists(select 1 from public.profiles p where p.id=p_owner and p.username ~ '^[A-Za-z0-9_]{3,20}$') then jsonb_build_object(
  'badgeTier',e->>'effectiveTier','refreshAfterMs',greatest(100,least(30000,
   floor(extract(epoch from ((e->>'nextBoundaryAt')::timestamptz-statement_timestamp()))*1000)))::integer) else null end
 from (select marketplace_private.shop_entitlements(p_owner,statement_timestamp()) e) q;
$$;

create function marketplace_private.public_shop_query(p_query jsonb,p_keys text[]) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text;v numeric;
begin
 if jsonb_typeof(p_query) is distinct from 'object' or (p_query-p_keys)<>'{}'::jsonb then
  raise exception 'Invalid public Shop query.' using errcode='23514';end if;
 foreach k in array array['page','pageSize'] loop
  if p_query ? k then
   if jsonb_typeof(p_query->k)<>'number' then raise exception 'Invalid pagination.' using errcode='23514';end if;
   v:=(p_query->>k)::numeric;
   if v<>trunc(v) or v<1 or v>(case when k='page' then 1000 else 100 end) then
    raise exception 'Invalid pagination.' using errcode='23514';end if;
  end if;
 end loop;
 foreach k in array array['search','username','id','sort','category'] loop
  if p_query ? k and (jsonb_typeof(p_query->k)<>'string' or length(p_query->>k)>200) then
   raise exception 'Invalid public Shop filter.' using errcode='23514';end if;
 end loop;
 if p_query ? 'username' and (p_query->>'username') !~ '^[A-Za-z0-9_]{3,20}$' then
  raise exception 'Invalid username.' using errcode='23514';end if;
 if p_query ? 'id' and (p_query->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Invalid listing.' using errcode='23514';end if;
 if p_query ? 'sort' and p_query->>'sort' not in('newest','price-low','price-high') then
  raise exception 'Unsupported sort.' using errcode='23514';end if;
 if p_query ? 'categories' then
  if jsonb_typeof(p_query->'categories')<>'array' then raise exception 'Invalid categories.' using errcode='23514';end if;
  if jsonb_array_length(p_query->'categories')>10 or exists(select 1 from jsonb_array_elements(p_query->'categories') c
   where jsonb_typeof(c)<>'string' or c#>>'{}' not in('Fashion & Accessories','Tech & Electronics','Home & Dorm',
    'Beauty & Personal Care','Books & Stationery','Art, Crafts & Gifts','Sports & Outdoors','Collectibles & Hobbies','Food & Treats','Other')) then
   raise exception 'Invalid categories.' using errcode='23514';end if;
 end if;
 return jsonb_build_object('page',1,'pageSize',20,'sort','newest')||p_query;
end;$$;

create function marketplace_private.public_shop_product(p_listing public.listings) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_listing.id,'listingChannel','shop','title',p_listing.title,
  'description',p_listing.description,'price',p_listing.price_cents,'currency',p_listing.currency,
  'category',p_listing.category,'subcategory',p_listing.subcategory,'condition',p_listing.condition,
  'preferredPaymentMode',p_listing.preferred_payment_mode,'preferredFulfillment',p_listing.preferred_fulfillment,
  'meetingLocation',case when p_listing.meeting_location is not null then jsonb_build_object('label',p_listing.meeting_location) else null end,
  'estimatedDeliveryFeeCents',p_listing.estimated_delivery_fee_cents,'status',p_listing.status,
  'createdAt',p_listing.created_at,'updatedAt',p_listing.updated_at,'publishedAt',p_listing.published_at,
  'seller',jsonb_build_object('id',p_listing.seller_id,'displayName',p.username),
  'photoUrls',(select coalesce(jsonb_agg('/api/listing-media/'||i.id::text order by i.slot),'[]'::jsonb)
   from public.listing_images i where i.listing_id=p_listing.id and i.owner_id=p_listing.seller_id and i.ready)))
 from public.profiles p where p.id=p_listing.seller_id;
$$;

create function marketplace_private.public_shop_profile(p_shop public.shops) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_shop.id,'sellerProfileId',p.id,'username',p.username,
 'shopName',p_shop.name,'category',p_shop.category,'description',p_shop.description,
 'badgeTier',marketplace_private.public_shop_eligibility(p.id)->>'badgeTier',
 'avatarUrl',case when p.avatar_path is not null then '/api/profile/avatar/'||p.id::text else null end,
 'imageUrl',(select '/api/listing-media/'||i.id::text from public.listings l join public.listing_images i on i.listing_id=l.id
  where l.seller_id=p.id and l.listing_channel='shop' and l.published_at is not null and l.status='available'
   and i.ready and i.owner_id=p.id order by l.created_at desc,l.id,i.slot limit 1)))
 from public.profiles p where p.id=p_shop.owner_id and p.username is not null;
$$;

create function public.marketplace_public_shops(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q jsonb;rows jsonb;size integer;page integer;delay integer;
begin
 q:=marketplace_private.public_shop_query(p_query,array['page','pageSize','categories','search','sort']);
 if q->>'sort'<>'newest' then raise exception 'Unsupported directory sort.' using errcode='23514';end if;
 size:=(q->>'pageSize')::integer;page:=(q->>'page')::integer;
 select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id),'[]'::jsonb),coalesce(min(x.delay),30000)
 into rows,delay from (
  select marketplace_private.public_shop_profile(s) data,s.created_at,s.id,(e.value->>'refreshAfterMs')::integer delay
  from public.shops s join public.profiles p on p.id=s.owner_id
  cross join lateral (select marketplace_private.public_shop_eligibility(s.owner_id) value) e
  where e.value is not null and p.username is not null
   and (not(q ? 'categories') or jsonb_array_length(q->'categories')=0 or (q->'categories') ?
    case s.category when 'Clothing & Accessories' then 'Fashion & Accessories' when 'Electronics' then 'Tech & Electronics'
     when 'Collectibles' then 'Collectibles & Hobbies' when 'Home & Living' then 'Home & Dorm' else s.category end)
   and (not(q ? 'search') or position(lower(q->>'search') in lower(s.name||' '||s.description))>0)
  order by s.created_at desc,s.id offset (page-1)*size limit size+1
 ) x;
 return jsonb_build_object('page',page,'hasNextPage',jsonb_array_length(rows)>size,
  'refreshAfterMs',delay)||jsonb_build_object('shops',(select coalesce(jsonb_agg(v order by n),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(v,n) where n<=size));
end;$$;

create function public.marketplace_public_shop_products(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q jsonb;rows jsonb;size integer;page integer;target public.listings;shop_owner uuid;delay integer;
begin
 q:=marketplace_private.public_shop_query(p_query,array['page','pageSize','id','username','search','sort','category']);
 size:=(q->>'pageSize')::integer;page:=(q->>'page')::integer;
 if q ? 'id' then
  select * into target from public.listings where id=(q->>'id')::uuid and listing_channel='shop' and published_at is not null;
  if not found then return jsonb_build_object('state','not_found');end if;
  if marketplace_private.public_shop_eligibility(target.seller_id) is null then return jsonb_build_object('state','unavailable');end if;
  if target.status<>'available' then return jsonb_build_object('state','not_found');end if;
  return jsonb_build_object('state','available','listing',marketplace_private.public_shop_product(target),
   'refreshAfterMs',marketplace_private.public_shop_eligibility(target.seller_id)->'refreshAfterMs');
 end if;
 if q ? 'username' then
  select p.id into shop_owner from public.profiles p join public.shops s on s.owner_id=p.id where p.username_normalized=lower(q->>'username');
  if shop_owner is null then return jsonb_build_object('state','not_found');end if;
  if marketplace_private.public_shop_eligibility(shop_owner) is null then return jsonb_build_object('state','unavailable');end if;
 end if;
 select coalesce(jsonb_agg(x.data order by x.position),'[]'::jsonb),coalesce(min(x.delay),30000) into rows,delay from (
  select marketplace_private.public_shop_product(l) data,(e.value->>'refreshAfterMs')::integer delay,
   row_number() over(order by case when q->>'sort'='price-low' then l.price_cents end,
    case when q->>'sort'='price-high' then l.price_cents end desc,l.created_at desc,l.id) position
  from public.listings l join public.shops s on s.owner_id=l.seller_id join public.profiles p on p.id=s.owner_id
  cross join lateral(select marketplace_private.public_shop_eligibility(s.owner_id) value) e
  where l.listing_channel='shop' and l.published_at is not null and l.status='available' and e.value is not null and p.username is not null
   and (shop_owner is null or l.seller_id=shop_owner)
   and (not(q ? 'category') or l.category=q->>'category')
   and (not(q ? 'search') or position(lower(q->>'search') in lower(l.title||' '||l.description))>0)
  order by position offset (page-1)*size limit size+1
 ) x;
 return jsonb_build_object('state','available','listings',(select coalesce(jsonb_agg(v order by n),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(v,n) where n<=size),
  'page',page,'hasNextPage',jsonb_array_length(rows)>size,'refreshAfterMs',delay);
end;$$;

create function public.marketplace_public_shop(p_username text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q jsonb;s public.shops;
begin
 q:=marketplace_private.public_shop_query(p_query||jsonb_build_object('username',p_username),array['page','pageSize','search','sort','username']);
 select sh.* into s from public.shops sh join public.profiles p on p.id=sh.owner_id where p.username_normalized=lower(p_username);
 if not found then return jsonb_build_object('state','not_found');end if;
 if marketplace_private.public_shop_eligibility(s.owner_id) is null then return jsonb_build_object('state','unavailable');end if;
 return public.marketplace_public_shop_products(q)||jsonb_build_object('shop',marketplace_private.public_shop_profile(s));
end;$$;

-- Only the existing server media adapter may obtain a private source path.
create function public.marketplace_public_shop_image(p_image_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'listing_id',i.listing_id,'owner_id',i.owner_id,'path',i.path,'storage_bucket',i.storage_bucket,'ready',i.ready,
 'listings',jsonb_build_object('id',l.id,'seller_id',l.seller_id,'published_at',l.published_at,'status',l.status,'listing_channel',l.listing_channel))
 from public.listing_images i join public.listings l on l.id=i.listing_id join public.shops s on s.owner_id=l.seller_id
 where i.id=p_image_id and i.owner_id=l.seller_id and i.ready and l.listing_channel='shop'
 and l.published_at is not null and l.status='available' and marketplace_private.public_shop_eligibility(l.seller_id) is not null;
$$;

revoke all on function marketplace_private.public_shop_eligibility(uuid),marketplace_private.public_shop_query(jsonb,text[]),
 marketplace_private.public_shop_product(public.listings),marketplace_private.public_shop_profile(public.shops) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_public_shops(jsonb),public.marketplace_public_shop(text,jsonb),public.marketplace_public_shop_products(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_public_shops(jsonb),public.marketplace_public_shop(text,jsonb),public.marketplace_public_shop_products(jsonb) to anon,authenticated;
revoke all on function public.marketplace_public_shop_image(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_public_shop_image(uuid) to service_role;
commit;

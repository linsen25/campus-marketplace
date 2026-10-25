-- B29-A: bounded, stable public Resale discovery without changing Listing ownership.
begin;

create extension if not exists pg_trgm with schema extensions;

-- Both price directions keep the same newest/id tie-break direction.
create index listings_resale_price_low
 on public.listings(price_cents,created_at desc,id)
 where listing_channel='resale' and published_at is not null and status='available';
create index listings_resale_price_high
 on public.listings(price_cents desc,created_at desc,id)
 where listing_channel='resale' and published_at is not null and status='available';
create index listings_resale_category_newest
 on public.listings(category,subcategory,created_at desc,id)
 where listing_channel='resale' and published_at is not null and status='available';
create index listings_resale_search_trgm
 on public.listings using gin(search_text extensions.gin_trgm_ops)
 where listing_channel='resale' and published_at is not null and status='available';

create function public.marketplace_search_normalize(p_value text) returns text
language sql immutable parallel safe set search_path='' as $$
 select lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g'))
$$;

-- Preserve the browser's literal phrase-at-word-boundary behavior.
create function public.marketplace_search_phrase_match(p_value text,p_query text) returns boolean
language plpgsql immutable parallel safe set search_path='' as $$
declare body text:=public.marketplace_search_normalize(p_value);
 q text:=public.marketplace_search_normalize(p_query);at integer:=1;hit integer;
begin
 if q='' then return true;end if;
 loop
  hit:=strpos(substr(body,at),q);
  if hit=0 then return false;end if;
  hit:=at+hit-1;
  if hit=1 or substr(body,hit-1,1)!~'[a-z0-9]' then return true;end if;
  at:=hit+1;
 end loop;
end;$$;

create function public.marketplace_resale_search_rank(
 p_title text,p_subcategory text,p_category text,p_description text,p_query text)
returns smallint language plpgsql immutable parallel safe set search_path='' as $$
declare q text:=public.marketplace_search_normalize(p_query);
 title_value text:=public.marketplace_search_normalize(p_title);
begin
 if q='' then return 0;end if;
 if title_value=q then return 0;end if;
 if strpos(q,' ')=0 and exists(
  select 1 from regexp_split_to_table(title_value,'[^a-z0-9]+') word
  where starts_with(word,q)
 ) then return 1;end if;
 if public.marketplace_search_phrase_match(title_value,q) then return 2;end if;
 if public.marketplace_search_phrase_match(p_subcategory,q) then return 3;end if;
 if public.marketplace_search_phrase_match(p_category,q) then return 4;end if;
 if public.marketplace_search_phrase_match(p_description,q) then return 5;end if;
 return null;
end;$$;

-- SECURITY INVOKER keeps direct RPC calls subject to Listing RLS. Explicit
-- predicates independently fix the public surface to published, available Resale.
create function public.marketplace_browse_resale(
 p_search text default null,p_category text default null,p_subcategory text default null,
 p_condition text default null,p_pickup_area text default null,p_min_price bigint default null,
 p_max_price bigint default null,p_sort text default 'newest',p_offset bigint default 0,
 p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare q text:=public.marketplace_search_normalize(p_search);
 pattern text;total bigint;ids uuid[];
begin
 if p_sort not in('newest','price-low','price-high') or p_limit not between 1 and 100
  or p_offset<0 or p_offset>9007199254740991
  or p_min_price<0 or p_max_price<0 or p_min_price>p_max_price then
  raise exception 'Invalid Resale browse query.' using errcode='23514';
 end if;
 if length(q)>200 then q:=left(q,200);end if;
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';

 select count(*) into total from public.listings l
 where l.listing_channel='resale' and l.published_at is not null and l.status='available'
  and (p_category is null or l.category=p_category)
  and (p_subcategory is null or l.subcategory=p_subcategory)
  and (p_condition is null or l.condition=p_condition)
  and (p_pickup_area is null or l.pickup_area=p_pickup_area)
  and (p_min_price is null or l.price_cents>=p_min_price)
  and (p_max_price is null or l.price_cents<=p_max_price)
  and (q='' or l.search_text ilike pattern escape '\'
   and public.marketplace_resale_search_rank(l.title,l.subcategory,l.category,l.description,q) is not null);

 select array_agg(page.id order by
  case when p_sort='price-low' then page.price_cents end asc,
  case when p_sort='price-high' then page.price_cents end desc,
  case when q<>'' then page.search_rank end,
  page.created_at desc,page.id) into ids from(
  select l.id,l.price_cents,l.created_at,
   public.marketplace_resale_search_rank(l.title,l.subcategory,l.category,l.description,q) search_rank
  from public.listings l
  where l.listing_channel='resale' and l.published_at is not null and l.status='available'
   and (p_category is null or l.category=p_category)
   and (p_subcategory is null or l.subcategory=p_subcategory)
   and (p_condition is null or l.condition=p_condition)
   and (p_pickup_area is null or l.pickup_area=p_pickup_area)
   and (p_min_price is null or l.price_cents>=p_min_price)
   and (p_max_price is null or l.price_cents<=p_max_price)
   and (q='' or l.search_text ilike pattern escape '\'
    and public.marketplace_resale_search_rank(l.title,l.subcategory,l.category,l.description,q) is not null)
  order by
   case when p_sort='price-low' then l.price_cents end asc,
   case when p_sort='price-high' then l.price_cents end desc,
   case when q<>'' then public.marketplace_resale_search_rank(l.title,l.subcategory,l.category,l.description,q) end,
   l.created_at desc,l.id
  limit p_limit offset p_offset
 ) page;
 return jsonb_build_object('ids',to_jsonb(coalesce(ids,'{}'::uuid[])),'total',total);
end;$$;

revoke all on function public.marketplace_search_normalize(text) from public;
revoke all on function public.marketplace_search_phrase_match(text,text) from public;
revoke all on function public.marketplace_resale_search_rank(text,text,text,text,text) from public;
revoke all on function public.marketplace_browse_resale(text,text,text,text,text,bigint,bigint,text,bigint,integer) from public;
grant execute on function public.marketplace_search_normalize(text) to anon,authenticated;
grant execute on function public.marketplace_search_phrase_match(text,text) to anon,authenticated;
grant execute on function public.marketplace_resale_search_rank(text,text,text,text,text) to anon,authenticated;
grant execute on function public.marketplace_browse_resale(text,text,text,text,text,bigint,bigint,text,bigint,integer) to anon,authenticated;

commit;

-- B16: account-owned Shop identities, independent of Listing favorites.
begin;

create table public.shop_favorites (
 user_id uuid not null references auth.users(id) on delete cascade,
 shop_id uuid not null references public.shops(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,shop_id)
);
create index shop_favorites_shop on public.shop_favorites(shop_id);
create index shop_favorites_user_newest on public.shop_favorites(user_id,created_at desc,shop_id);
alter table public.shop_favorites enable row level security;
revoke all on public.shop_favorites from public,anon,authenticated,service_role;
create policy shop_favorites_own_read on public.shop_favorites for select to authenticated
 using(user_id=(select auth.uid()) and (select marketplace_private.is_western_user()));
create policy shop_favorites_own_insert on public.shop_favorites for insert to authenticated
 with check(user_id=(select auth.uid()) and (select marketplace_private.is_western_user()));
create policy shop_favorites_own_delete on public.shop_favorites for delete to authenticated
 using(user_id=(select auth.uid()) and (select marketplace_private.is_western_user()));

create function public.marketplace_favorite_shops(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_query jsonb; v_rows jsonb; v_delay integer; v_size integer; v_page integer;
begin
 if v_actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified login required.' using errcode='42501';end if;
 v_query:=marketplace_private.public_shop_query(p_query,array['page','pageSize']);
 v_size:=(v_query->>'pageSize')::integer;v_page:=(v_query->>'page')::integer;
 select coalesce(jsonb_agg(x.data order by x.created_at desc,x.shop_id),'[]'::jsonb),coalesce(min(x.delay),30000)
 into v_rows,v_delay from (
  select marketplace_private.public_shop_profile(s) data,f.created_at,f.shop_id,
   (e.value->>'refreshAfterMs')::integer delay
  from public.shop_favorites f join public.shops s on s.id=f.shop_id
  cross join lateral(select marketplace_private.public_shop_eligibility(s.owner_id) value) e
  where f.user_id=v_actor and e.value is not null
  order by f.created_at desc,f.shop_id offset (v_page-1)*v_size limit v_size+1
 ) x;
 return jsonb_build_object('shops',(select coalesce(jsonb_agg(a.value order by a.n),'[]'::jsonb)
  from jsonb_array_elements(v_rows) with ordinality a(value,n) where a.n<=v_size),
  'page',v_page,'hasNextPage',jsonb_array_length(v_rows)>v_size,'refreshAfterMs',v_delay);
end;$$;

create function public.marketplace_shop_favorite_states(p_shop_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified login required.' using errcode='42501';end if;
 if p_shop_ids is null or cardinality(p_shop_ids)>100 or coalesce(array_ndims(p_shop_ids),1)<>1
  or array_position(p_shop_ids,null) is not null then
  raise exception 'Invalid Shop IDs.' using errcode='23514';end if;
 return jsonb_build_object('favoriteShopIds',(select coalesce(jsonb_agg(f.shop_id order by f.shop_id),'[]'::jsonb)
  from public.shop_favorites f where f.user_id=v_actor and f.shop_id=any(p_shop_ids)));
end;$$;

create function public.marketplace_set_shop_favorite(p_shop_id uuid,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_entitlement jsonb;
begin
 if v_actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified login required.' using errcode='42501';end if;
 if p_shop_id is null or p_enabled is null then raise exception 'Invalid Shop favorite.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('shop_favorite:'||v_actor::text||':'||p_shop_id::text,0));
 if not p_enabled then
  delete from public.shop_favorites where user_id=v_actor and shop_id=p_shop_id;
  return jsonb_build_object('shopId',p_shop_id,'favorited',false);
 end if;
 select s.owner_id into v_owner from public.shops s where s.id=p_shop_id for key share;
 if not found then raise exception 'Shop unavailable.' using errcode='P0002';end if;
 perform 1 from marketplace_private.shop_memberships m where m.owner_id=v_owner for share;
 if not found then raise exception 'Shop unavailable.' using errcode='P0002';end if;
 -- Match B12's lock order and use fresh time after any lock wait.
 v_entitlement:=marketplace_private.shop_entitlements(v_owner,clock_timestamp());
 if marketplace_private.public_shop_eligibility(v_owner) is null
  or not coalesce((v_entitlement->>'canOperateShop')::boolean,false) then
  raise exception 'Shop unavailable.' using errcode='P0002';end if;
 insert into public.shop_favorites(user_id,shop_id) values(v_actor,p_shop_id) on conflict do nothing;
 return jsonb_build_object('shopId',p_shop_id,'favorited',true);
end;$$;

revoke all on function public.marketplace_favorite_shops(jsonb),public.marketplace_shop_favorite_states(uuid[]),
 public.marketplace_set_shop_favorite(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_favorite_shops(jsonb),public.marketplace_shop_favorite_states(uuid[]),
 public.marketplace_set_shop_favorite(uuid,boolean) to authenticated;
commit;

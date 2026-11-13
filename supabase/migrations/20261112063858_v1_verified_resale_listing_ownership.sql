-- Open registration follow-up: a confirmed ordinary-email account may own
-- Resale listings and their private media. Shop remains an explicitly Western
-- / Shop-eligibility controlled path. This migration does not grant access to
-- another seller's rows, publish Shop listings, or change public-read rules.
begin;

do $migration$
declare
  item record;
  policy_definition text;
  definition text;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  -- These are the last relevant definitions from the reviewed main baseline.
  -- Abort if a target environment has changed them rather than silently
  -- broadening an unknown policy.
  for item in
    select * from (values
      ('public'::name,'listings'::name,'listings_owner_insert'::name),
      ('public'::name,'listings'::name,'listings_owner_update'::name),
      ('public'::name,'listings'::name,'listings_owner_delete'::name),
      ('public'::name,'listing_images'::name,'images_owner_insert'::name),
      ('public'::name,'listing_images'::name,'images_owner_update'::name),
      ('public'::name,'listing_images'::name,'images_owner_delete'::name),
      ('storage'::name,'objects'::name,'marketplace_storage_insert'::name),
      ('storage'::name,'objects'::name,'marketplace_storage_owner_delete'::name),
      ('storage'::name,'objects'::name,'listing_private_select_guard'::name),
      ('storage'::name,'objects'::name,'listing_private_owner_read'::name),
      ('storage'::name,'objects'::name,'listing_private_insert_guard'::name),
      ('storage'::name,'objects'::name,'listing_private_delete_guard'::name)
    ) v(schema_name,table_name,policy_name)
  loop
    select coalesce(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'')
             || coalesce(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'')
      into policy_definition
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname=item.schema_name and c.relname=item.table_name
       and p.polname=item.policy_name;
    if policy_definition is null
       or position('marketplace_private.is_western_user' in policy_definition)=0 then
      raise exception 'Listing policy baseline drifted: %.%.%',
        item.schema_name,item.table_name,item.policy_name using errcode='P0001';
    end if;
  end loop;

  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into before_owner,before_security_definer,before_config,before_acl
    from pg_catalog.pg_proc p
   where p.oid='public.marketplace_finalize_listing(uuid)'::regprocedure;
  if not found then
    raise exception 'Listing finalization function is absent from the reviewed baseline.' using errcode='P0001';
  end if;
  definition:=pg_catalog.pg_get_functiondef('public.marketplace_finalize_listing(uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,
       'if not marketplace_private.is_western_user() then','')))
       / length('if not marketplace_private.is_western_user() then') <> 1
     or definition not like '%target.listing_channel<>''resale''%' then
    raise exception 'Listing finalization baseline drifted.' using errcode='P0001';
  end if;
  -- Finalization explicitly rejects Shop rows below, so this changes only the
  -- Resale caller identity; it cannot make Shop publication available.
  execute replace(definition,
    'if not marketplace_private.is_western_user() then',
    'if not marketplace_private.is_verified_user() then');
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into after_owner,after_security_definer,after_config,after_acl
    from pg_catalog.pg_proc p
   where p.oid='public.marketplace_finalize_listing(uuid)'::regprocedure;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'Listing finalization metadata changed unexpectedly.' using errcode='P0001';
  end if;
end;
$migration$;

drop policy listings_owner_insert on public.listings;
create policy listings_owner_insert on public.listings for insert to authenticated
with check (
  seller_id=(select auth.uid()) and (
    (listing_channel='resale' and (select marketplace_private.is_verified_user()))
    or (listing_channel<>'resale' and (select marketplace_private.is_western_user()))
  )
);

-- Client column grants and the immutable-channel trigger still prevent a
-- Resale owner from turning a row into Shop. Shop writes retain their existing
-- server-side provisioning/eligibility path.
drop policy listings_owner_update on public.listings;
create policy listings_owner_update on public.listings for update to authenticated
using (
  seller_id=(select auth.uid()) and (
    (listing_channel='resale' and (select marketplace_private.is_verified_user()))
    or (listing_channel<>'resale' and (select marketplace_private.is_western_user()))
  )
)
with check (
  seller_id=(select auth.uid()) and (
    (listing_channel='resale' and (select marketplace_private.is_verified_user()))
    or (listing_channel<>'resale' and (select marketplace_private.is_western_user()))
  )
);

drop policy listings_owner_delete on public.listings;
create policy listings_owner_delete on public.listings for delete to authenticated
using (
  seller_id=(select auth.uid()) and (
    (listing_channel='resale' and (select marketplace_private.is_verified_user()))
    or (listing_channel<>'resale' and (select marketplace_private.is_western_user()))
  )
);

drop policy images_owner_insert on public.listing_images;
create policy images_owner_insert on public.listing_images for insert to authenticated
with check (
  owner_id=(select auth.uid()) and not ready
  and exists (
    select 1 from public.listings l
     where l.id=listing_id and l.seller_id=(select auth.uid())
       and ((l.listing_channel='resale' and (select marketplace_private.is_verified_user()))
         or (l.listing_channel<>'resale' and (select marketplace_private.is_western_user())))
  )
);

drop policy images_owner_update on public.listing_images;
create policy images_owner_update on public.listing_images for update to authenticated
using (
  owner_id=(select auth.uid()) and exists (
    select 1 from public.listings l
     where l.id=listing_id and l.seller_id=(select auth.uid())
       and ((l.listing_channel='resale' and (select marketplace_private.is_verified_user()))
         or (l.listing_channel<>'resale' and (select marketplace_private.is_western_user())))
  )
)
with check (
  owner_id=(select auth.uid()) and exists (
    select 1 from public.listings l
     where l.id=listing_id and l.seller_id=(select auth.uid())
       and ((l.listing_channel='resale' and (select marketplace_private.is_verified_user()))
         or (l.listing_channel<>'resale' and (select marketplace_private.is_western_user())))
  )
);

drop policy images_owner_delete on public.listing_images;
create policy images_owner_delete on public.listing_images for delete to authenticated
using (
  owner_id=(select auth.uid()) and exists (
    select 1 from public.listings l
     where l.id=listing_id and l.seller_id=(select auth.uid())
       and ((l.listing_channel='resale' and (select marketplace_private.is_verified_user()))
         or (l.listing_channel<>'resale' and (select marketplace_private.is_western_user())))
  )
);

-- New Resale bytes always live in the private bucket. The restrictive policies
-- below are updated together, so a permissive owner policy cannot bypass a
-- private-media guard. Public/Shop storage remains Western-only.
drop policy listing_private_select_guard on storage.objects;
create policy listing_private_select_guard on storage.objects as restrictive
for select to anon,authenticated using (
  bucket_id<>'listing-images-private' or (
    (storage.foldername(name))[1]=(select auth.uid())::text
    and (select marketplace_private.is_verified_user())
  )
);
drop policy listing_private_owner_read on storage.objects;
create policy listing_private_owner_read on storage.objects for select to authenticated using (
  bucket_id='listing-images-private'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (select marketplace_private.is_verified_user())
);
drop policy marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id in ('listing-images','listing-images-private')
  and exists(
    select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
     where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
       and l.published_at is null and l.status='available' and (
         (l.listing_channel='resale' and bucket_id='listing-images-private'
           and (select marketplace_private.is_verified_user()))
         or (l.listing_channel<>'resale' and bucket_id='listing-images'
           and (select marketplace_private.is_western_user()))
       )
  )
);
drop policy listing_private_insert_guard on storage.objects;
create policy listing_private_insert_guard on storage.objects as restrictive
for insert to anon,authenticated with check (
  bucket_id<>'listing-images-private' or (
    (select marketplace_private.is_verified_user()) and exists(
      select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
       where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
         and l.published_at is null and l.status='available' and l.listing_channel='resale'
    )
  )
);
drop policy marketplace_storage_owner_delete on storage.objects;
create policy marketplace_storage_owner_delete on storage.objects for delete to authenticated using (
  bucket_id in ('listing-images','listing-images-private')
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (
    (bucket_id='listing-images-private' and (select marketplace_private.is_verified_user()))
    or (bucket_id='listing-images' and (select marketplace_private.is_western_user()))
  )
  and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id)
);
drop policy listing_private_delete_guard on storage.objects;
create policy listing_private_delete_guard on storage.objects as restrictive
for delete to anon,authenticated using (
  bucket_id<>'listing-images-private' or (
    (storage.foldername(name))[1]=(select auth.uid())::text
    and (select marketplace_private.is_verified_user())
    and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id)
  )
);

commit;

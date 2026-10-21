-- B05: new Resale media stays private before AND after publication.
-- Forward only. Legacy objects, URLs, frozen manifests and material hashes unchanged.
begin;
lock table public.listings, public.listing_images in access exclusive mode;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('listing-images-private','listing-images-private',false,3145728,array['image/jpeg','image/png','image/webp']);
alter table public.listing_images add column storage_bucket text not null default 'listing-images'
 check(storage_bucket in ('listing-images','listing-images-private'));
-- Existing INSERT column grants do not include this column. Trigger derives it
-- even for a trusted caller: client input can never choose a Resale destination.
create function marketplace_private.assign_listing_image_bucket() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 select case when l.listing_channel='resale' then 'listing-images-private' else 'listing-images' end
 into new.storage_bucket from public.listings l where l.id=new.listing_id for update;
 return new;
end;$$;
create trigger listing_image_bucket before insert on public.listing_images
for each row execute function marketplace_private.assign_listing_image_bucket();
revoke all on function marketplace_private.assign_listing_image_bucket() from public,anon,authenticated;

create or replace function marketplace_private.verify_image_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ready and not exists (
    -- Generated columns are not populated yet in a BEFORE trigger.
    select 1 from storage.objects where bucket_id = new.storage_bucket
      and name = new.owner_id::text || '/' || new.listing_id::text || '/' || new.id::text
      and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
      and (metadata->>'size')::bigint between 1 and 3145728
  ) then raise exception 'Upload a valid image before attaching it.' using errcode = '23514'; end if;
  return new;
end; $$;
create or replace function marketplace_private.assert_listing_images_complete(target public.listings)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.listing_images where listing_id = target.id)
      <> target.expected_image_count
    or exists (select 1 from public.listing_images i where i.listing_id = target.id and
      (not i.ready or i.owner_id <> target.seller_id or i.slot > target.expected_image_count
        or not exists (select 1 from storage.objects o
          where o.bucket_id = i.storage_bucket and o.name = i.path
            and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
            and (o.metadata->>'size')::bigint between 1 and 3145728))) then
    raise exception 'Complete the required image set before publishing.' using errcode = '23514';
  end if;
end; $$;
create or replace function marketplace_private.protect_published_listing_images() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.listings; parent_id uuid;
begin
  parent_id := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  if tg_op = 'UPDATE' and row(new.id,new.listing_id,new.owner_id,new.slot,new.storage_bucket)
    is distinct from row(old.id,old.listing_id,old.owner_id,old.slot,old.storage_bucket) then
    raise exception 'Image identity/order cannot be rewritten.' using errcode = '23514';
  end if;
  select * into target from public.listings where id = parent_id for update;
  if found and (target.published_at is not null or target.status <> 'available') then
    raise exception 'Published listing images are immutable.' using errcode = '23514';
  end if;
  if tg_op <> 'DELETE' and (target.id is null or new.owner_id <> target.seller_id
    or new.slot > target.expected_image_count) then
    raise exception 'Image is outside the creation manifest.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

-- Constrain even unrelated permissive policies; no UPDATE/upsert on private media.
create policy listing_private_select_guard on storage.objects as restrictive for select to anon,authenticated using (
 bucket_id<>'listing-images-private' or ((storage.foldername(name))[1]=(select auth.uid())::text and (select marketplace_private.is_western_user()))
);
create policy listing_private_owner_read on storage.objects for select to authenticated using (
 bucket_id='listing-images-private' and (storage.foldername(name))[1]=(select auth.uid())::text and (select marketplace_private.is_western_user())
);
drop policy marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id in ('listing-images','listing-images-private') and (select marketplace_private.is_western_user())
 and exists(select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
 where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
 and l.published_at is null and l.status='available'
 and (l.listing_channel<>'resale' or bucket_id='listing-images-private'))
);
-- Public bucket remains for legacy/Shop compatibility, never new Resale bytes.
create policy listing_legacy_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check (
 bucket_id<>'listing-images' or ((select marketplace_private.is_western_user()) and exists(
 select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
 where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
 and l.published_at is null and l.status='available' and l.listing_channel<>'resale'))
);
create policy listing_private_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check (
 bucket_id<>'listing-images-private' or ((select marketplace_private.is_western_user()) and exists(
 select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
 where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
 and l.published_at is null and l.status='available' and l.listing_channel='resale'))
);
create policy listing_private_update_guard on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'listing-images-private') with check(bucket_id<>'listing-images-private');
drop policy marketplace_storage_owner_delete on storage.objects;
create policy marketplace_storage_owner_delete on storage.objects for delete to authenticated using (
 bucket_id in ('listing-images','listing-images-private') and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select marketplace_private.is_western_user())
 and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id)
);
create policy listing_private_delete_guard on storage.objects as restrictive for delete to anon,authenticated using (
 bucket_id<>'listing-images-private' or ((storage.foldername(name))[1]=(select auth.uid())::text
 and (select marketplace_private.is_western_user())
 and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id))
);
-- Freeze source location for new snapshot assets; old manifests/hash inputs stay exact.
alter table marketplace_private.order_media_assets add column source_bucket text not null default 'listing-images'
 check(source_bucket in ('listing-images','listing-images-private'));
create or replace function public.marketplace_prepare_order_media(p_offer uuid,p_actor uuid,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;l public.listings;b marketplace_private.order_media_batches;h text;m jsonb;
begin
 if p_command is null or not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and lower(email)~'^[^[:space:]@]+@uwo[.]ca$') then raise exception 'Verified actor required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_command::text,0));
 select * into r from public.order_requests where id=p_offer;
 if not found or r.protocol_version<>2 or p_actor not in(r.buyer_origin_id,r.seller_origin_id) then raise exception 'Offer context required.' using errcode='42501';end if;
 select * into l from public.listings where id=r.listing_id for update;
 select * into r from public.order_requests where id=p_offer for share;
 if r.status<>'active' or l.published_at is null or l.status<>'available' then raise exception 'Active available context required.' using errcode='23514';end if;
 h:=marketplace_private.listing_media_material_hash(l.id);
 select x.* into b from marketplace_private.order_media_commands cmd join marketplace_private.order_media_batches x on x.id=cmd.batch_id where cmd.actor_id=p_actor and cmd.command_id=p_command;
 if found then
  if b.offer_id<>r.id or b.material_hash<>h or b.state not in('preparing','prepared') or b.expires_at<=clock_timestamp() then raise exception 'Preparation command stale or reused.' using errcode='23505';end if;
  return marketplace_private.order_media_manifest(b.id);
 end if;
 select * into b from marketplace_private.order_media_batches where offer_id=r.id and material_hash=h and state in('preparing','prepared','bound');
 if found then
  if b.state='bound' or b.expires_at<=clock_timestamp() then raise exception 'Preparation unavailable; clean expired batch first.' using errcode='23514';end if;
  insert into marketplace_private.order_media_commands(actor_id,command_id,batch_id) values(p_actor,p_command,b.id);
  return marketplace_private.order_media_manifest(b.id);
 end if;
 perform marketplace_private.assert_listing_images_complete(l);
 select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'slot',i.slot) order by i.slot) into m from public.listing_images i where listing_id=l.id and ready;
 insert into marketplace_private.order_media_batches(offer_id,listing_id,actor_id,buyer_id,seller_id,command_id,material_hash,manifest)
 values(r.id,l.id,p_actor,r.buyer_origin_id,r.seller_origin_id,p_command,h,m) returning * into b;
 insert into marketplace_private.order_media_commands(actor_id,command_id,batch_id) values(p_actor,p_command,b.id);
 insert into marketplace_private.order_media_assets(batch_id,source_media_id,source_path,source_bucket,position)
 select b.id,(x->>'id')::uuid,x->>'path',i.storage_bucket,(x->>'slot')::smallint
 from jsonb_array_elements(m)x join public.listing_images i on i.id=(x->>'id')::uuid;
 return marketplace_private.order_media_manifest(b.id);
end;$$;
commit;

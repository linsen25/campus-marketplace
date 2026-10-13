-- V2-C1, staging only. No Accept/Order/inventory mutations. Keep V1 public media.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-snapshot-media','order-snapshot-media',false,3145728,array['image/jpeg','image/png','image/webp']);
create policy order_snapshot_no_client_read on storage.objects as restrictive for select to public using(bucket_id<>'order-snapshot-media');
create policy order_snapshot_no_client_insert on storage.objects as restrictive for insert to public with check(bucket_id<>'order-snapshot-media');
create policy order_snapshot_no_client_update on storage.objects as restrictive for update to public using(bucket_id<>'order-snapshot-media') with check(bucket_id<>'order-snapshot-media');
create policy order_snapshot_no_client_delete on storage.objects as restrictive for delete to public using(bucket_id<>'order-snapshot-media');

create table marketplace_private.order_media_batches(
 id uuid primary key default gen_random_uuid(), offer_id uuid not null references public.order_requests(id),
 listing_id uuid not null references public.listings(id), actor_id uuid not null,
 buyer_id uuid not null,seller_id uuid not null,command_id uuid not null,
 material_hash text not null check(material_hash~'^[0-9a-f]{64}$'),
 state text not null default 'preparing' check(state in('preparing','prepared','bound','delete_claimed','deleted')),
 manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 6),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '24 hours'),
 order_id uuid unique references public.orders(id), lease_token uuid,lease_expires_at timestamptz,deleted_at timestamptz,
 unique(actor_id,command_id),check((state='bound')=(order_id is not null)),
 check((state='delete_claimed')=(lease_token is not null and lease_expires_at is not null))
);
create unique index order_media_live_context on marketplace_private.order_media_batches(offer_id,material_hash) where state in('preparing','prepared','bound');
create table marketplace_private.order_media_commands(
 actor_id uuid not null,command_id uuid not null,batch_id uuid not null references marketplace_private.order_media_batches(id),
 primary key(actor_id,command_id)
);
create table marketplace_private.order_media_assets(
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references marketplace_private.order_media_batches(id),
 source_media_id uuid not null,source_path text not null,position smallint not null check(position between 1 and 6),
 bucket text not null default 'order-snapshot-media' check(bucket='order-snapshot-media'),
 path text generated always as(batch_id::text||'/'||id::text) stored unique,
 mime_type text,size_bytes bigint,sha256 text,verified_at timestamptz,
 unique(batch_id,position),unique(batch_id,source_media_id),
 check((verified_at is null and num_nonnulls(mime_type,size_bytes,sha256)=0) or
 (verified_at is not null and num_nonnulls(mime_type,size_bytes,sha256)=3 and mime_type in('image/jpeg','image/png','image/webp') and size_bytes between 1 and 3145728 and sha256~'^[0-9a-f]{64}$'))
);
create table marketplace_private.order_snapshot_media(
 order_id uuid not null references public.orders(id),asset_id uuid not null unique references marketplace_private.order_media_assets(id),
 position smallint not null check(position between 1 and 6),created_at timestamptz not null default clock_timestamp(),
 primary key(order_id,position)
);
alter table marketplace_private.order_media_batches enable row level security;
alter table marketplace_private.order_media_assets enable row level security;
alter table marketplace_private.order_snapshot_media enable row level security;
alter table marketplace_private.order_media_commands enable row level security;
revoke all on marketplace_private.order_media_batches,marketplace_private.order_media_assets,marketplace_private.order_snapshot_media,marketplace_private.order_media_commands from public,anon,authenticated,service_role;

create function marketplace_private.listing_media_material_hash(p_listing uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('title',l.title,'description',l.description,'category',l.category,
 'subcategory',l.subcategory,'condition',l.condition,'seller',l.seller_id,
 'media',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'slot',i.slot) order by i.slot)
 from public.listing_images i where i.listing_id=l.id and i.ready),'[]'::jsonb))::text,'UTF8')),'hex') from public.listings l where l.id=p_listing;
$$;
create function marketplace_private.order_media_manifest(p_batch uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'offer_id',b.offer_id,'material_hash',b.material_hash,'state',b.state,
 'expires_at',b.expires_at,'assets',coalesce((select jsonb_agg(to_jsonb(a) order by a.position) from marketplace_private.order_media_assets a where a.batch_id=b.id),'[]'::jsonb))
 from marketplace_private.order_media_batches b where b.id=p_batch;
$$;
create function public.marketplace_prepare_order_media(p_offer uuid,p_actor uuid,p_command uuid) returns jsonb
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
 insert into marketplace_private.order_media_assets(batch_id,source_media_id,source_path,position)
 select b.id,(x->>'id')::uuid,x->>'path',(x->>'slot')::smallint from jsonb_array_elements(m)x;
 return marketplace_private.order_media_manifest(b.id);
end;$$;

create function public.marketplace_verify_order_media(p_asset uuid,p_mime text,p_size bigint,p_sha text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a marketplace_private.order_media_assets;b marketplace_private.order_media_batches;
begin
 select * into a from marketplace_private.order_media_assets where id=p_asset;
 select * into b from marketplace_private.order_media_batches where id=a.batch_id;
 perform 1 from public.listings where id=b.listing_id for update;
 select * into b from marketplace_private.order_media_batches where id=b.id for update;
 select * into a from marketplace_private.order_media_assets where id=p_asset for update;
 if b.state not in('preparing','prepared') or b.expires_at<=clock_timestamp() or b.material_hash is distinct from marketplace_private.listing_media_material_hash(b.listing_id)
 or not exists(select 1 from public.order_requests where id=b.offer_id and status='active' and protocol_version=2) then raise exception 'Stale preparation.' using errcode='23514';end if;
 if p_sha is null or p_sha!~'^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 3145728 or p_mime is null or p_mime not in('image/jpeg','image/png','image/webp')
 or not exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.path and metadata->>'mimetype'=p_mime and (metadata->>'size')::bigint=p_size) then raise exception 'Verified destination required.' using errcode='23514';end if;
 if a.verified_at is not null then
  if row(a.mime_type,a.size_bytes,a.sha256) is distinct from row(p_mime,p_size,p_sha) then raise exception 'Immutable asset evidence.' using errcode='23514';end if;
 else update marketplace_private.order_media_assets set mime_type=p_mime,size_bytes=p_size,sha256=p_sha,verified_at=clock_timestamp() where id=a.id;end if;
 if not exists(select 1 from marketplace_private.order_media_assets where batch_id=b.id and verified_at is null)
 and (select count(*) from marketplace_private.order_media_assets where batch_id=b.id)=jsonb_array_length(b.manifest) then
 update marketplace_private.order_media_batches set state='prepared' where id=b.id;
 end if;
 return marketplace_private.order_media_manifest(b.id);
end;$$;

-- Only a future owner-definer Accept may call this inside its transaction.
create function marketplace_private.bind_order_media(p_batch uuid,p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b marketplace_private.order_media_batches;o public.orders;
begin
 select * into b from marketplace_private.order_media_batches where id=p_batch;
 perform 1 from public.listings where id=b.listing_id for update;
 select * into b from marketplace_private.order_media_batches where id=p_batch for update;
 perform 1 from marketplace_private.order_media_assets where batch_id=b.id order by id for update;
 select * into o from public.orders where id=p_order for share;
 if b.state='bound' and b.order_id=o.id then return;end if;
 if b.state is distinct from 'prepared' or b.expires_at<=clock_timestamp() or o.id is null or o.request_id<>b.offer_id or o.listing_id<>b.listing_id
 or o.buyer_origin_id<>b.buyer_id or o.seller_origin_id<>b.seller_id
 or b.material_hash is distinct from marketplace_private.listing_media_material_hash(b.listing_id)
 or not exists(select 1 from public.order_requests where id=b.offer_id and protocol_version=2 and status in('active','accepted'))
 or (select count(*) from marketplace_private.order_media_assets where batch_id=b.id)<>jsonb_array_length(b.manifest)
 or exists(select 1 from marketplace_private.order_media_assets a where a.batch_id=b.id and (a.verified_at is null or not exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.path))) then raise exception 'Complete current prepared media required.' using errcode='23514';end if;
 insert into marketplace_private.order_snapshot_media(order_id,asset_id,position) select o.id,id,position from marketplace_private.order_media_assets where batch_id=b.id;
 update marketplace_private.order_media_batches set state='bound',order_id=o.id where id=b.id;
end;$$;

create function public.marketplace_claim_order_media_cleanup(p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b marketplace_private.order_media_batches;token uuid:=gen_random_uuid();
begin
 select * into b from marketplace_private.order_media_batches where id=p_batch for update;
 if not found or b.state='bound' or b.order_id is not null
 or exists(select 1 from marketplace_private.order_snapshot_media r join marketplace_private.order_media_assets a on a.id=r.asset_id where a.batch_id=b.id)
 or(b.state in('preparing','prepared') and b.expires_at>clock_timestamp())
 or(b.state='delete_claimed' and b.lease_expires_at>clock_timestamp()) then return null;end if;
 update marketplace_private.order_media_batches set state='delete_claimed',lease_token=token,lease_expires_at=clock_timestamp()+interval '2 minutes' where id=b.id;
 return jsonb_build_object('batch_id',b.id,'lease',token);
end;$$;
create function public.marketplace_order_media_delete_lease(p_batch uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b marketplace_private.order_media_batches;
begin
 select * into b from marketplace_private.order_media_batches where id=p_batch for update;
 if not found or b.state<>'delete_claimed' or b.lease_token is distinct from p_lease or b.lease_expires_at<=clock_timestamp() or b.order_id is not null
 or exists(select 1 from marketplace_private.order_snapshot_media r join marketplace_private.order_media_assets a on a.id=r.asset_id where a.batch_id=b.id) then raise exception 'Valid unbound delete lease required.' using errcode='23514';end if;
 return marketplace_private.order_media_manifest(b.id);
end;$$;
create function public.marketplace_finish_order_media_cleanup(p_batch uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.marketplace_order_media_delete_lease(p_batch,p_lease);
 if exists(select 1 from marketplace_private.order_media_assets a join storage.objects o on o.bucket_id=a.bucket and o.name=a.path where a.batch_id=p_batch) then raise exception 'Object deletion not verified.' using errcode='23514';end if;
 update marketplace_private.order_media_batches set state='deleted',lease_token=null,lease_expires_at=null,deleted_at=clock_timestamp() where id=p_batch;
 -- Tombstones keep exact paths tracked for reconciliation of late uploads.
end;$$;
create function public.marketplace_order_media_cleanup_candidates() returns setof uuid
language sql stable security definer set search_path='' as $$
 select id from marketplace_private.order_media_batches where
 (state in('preparing','prepared') and expires_at<=clock_timestamp()) or(state='delete_claimed' and lease_expires_at<=clock_timestamp())
 or(state='deleted' and deleted_at<clock_timestamp()-interval '1 hour') order by created_at,id limit 50;
$$;
create function public.marketplace_order_snapshot_media(p_order uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) or not exists(select 1 from public.orders where id=p_order and (buyer_id=auth.uid() or seller_id=auth.uid())) then raise exception 'Order not accessible.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'bucket',a.bucket,'path',a.path,'position',r.position,'mime_type',a.mime_type,'size_bytes',a.size_bytes) order by r.position)
 from marketplace_private.order_snapshot_media r join marketplace_private.order_media_assets a on a.id=r.asset_id
 join marketplace_private.order_media_batches b on b.id=a.batch_id where r.order_id=p_order and b.state='bound' and b.order_id=p_order),'[]'::jsonb);
end;$$;

-- Normal roles cannot mutate any internal lifecycle; trusted functions own transitions.
revoke all on function marketplace_private.listing_media_material_hash(uuid),marketplace_private.order_media_manifest(uuid),marketplace_private.bind_order_media(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_prepare_order_media(uuid,uuid,uuid),public.marketplace_verify_order_media(uuid,text,bigint,text),public.marketplace_claim_order_media_cleanup(uuid),public.marketplace_order_media_delete_lease(uuid,uuid),public.marketplace_finish_order_media_cleanup(uuid,uuid),public.marketplace_order_media_cleanup_candidates(),public.marketplace_order_snapshot_media(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_prepare_order_media(uuid,uuid,uuid),public.marketplace_verify_order_media(uuid,text,bigint,text),public.marketplace_claim_order_media_cleanup(uuid),public.marketplace_order_media_delete_lease(uuid,uuid),public.marketplace_finish_order_media_cleanup(uuid,uuid),public.marketplace_order_media_cleanup_candidates() to service_role;
grant execute on function public.marketplace_order_snapshot_media(uuid) to authenticated;
commit;

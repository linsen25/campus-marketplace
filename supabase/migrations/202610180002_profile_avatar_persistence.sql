-- B03: avatar persistence only. No historical identity/media backfill.
begin;
alter table public.profiles add column avatar_path text
 check (avatar_path is null or avatar_path ~ ('^'||id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'));

-- Retained owner UUID lets orphan cleanup survive account deletion. No email,
-- credentials, or second user identity is stored here.
create table marketplace_private.profile_avatar_uploads (
 id uuid primary key,
 owner_id uuid not null,
 generation bigint generated always as identity unique,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 stored_sha256 text not null check(stored_sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 3145728),
 expected_path text,
 path text generated always as (owner_id::text||'/'||id::text||'.webp') stored unique,
 state text not null default 'pending' check(state in('pending','committed','retired','deleting','deleted')),
 created_at timestamptz not null default clock_timestamp(),
 committed_at timestamptz,
 retired_at timestamptz
);
create index profile_avatar_owner_generation on marketplace_private.profile_avatar_uploads(owner_id,generation desc);
alter table marketplace_private.profile_avatar_uploads enable row level security;
revoke all on marketplace_private.profile_avatar_uploads from public,anon,authenticated,service_role;
revoke all on sequence marketplace_private.profile_avatar_uploads_generation_seq from public,anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,3145728,array['image/webp']);
-- Restrictive guard also blocks any future permissive browser Storage policy.
create policy profile_avatars_no_direct_client_access on storage.objects as restrictive
 for all to anon,authenticated using(bucket_id<>'profile-avatars') with check(bucket_id<>'profile-avatars');

create function public.marketplace_prepare_profile_avatar(
 p_owner uuid,p_action uuid,p_expected uuid,p_source_sha256 text,p_stored_sha256 text,p_size integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a marketplace_private.profile_avatar_uploads; current_path text; expected text;
begin
 if p_owner is null or p_action is null or not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null and lower(email) ~ '^[^[:space:]@]+@uwo[.]ca$') then
 raise exception 'Verified avatar owner required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('profile_avatar:'||p_owner::text,0));
 select avatar_path into current_path from public.profiles where id=p_owner for update;
 if not found then raise exception 'Profile unavailable.' using errcode='42501';end if;
 expected:=case when p_expected is null then null else p_owner::text||'/'||p_expected::text||'.webp' end;
 select * into a from marketplace_private.profile_avatar_uploads where id=p_action;
 if a.id is not null then
  if a.owner_id<>p_owner or a.source_sha256 is distinct from p_source_sha256 or a.stored_sha256 is distinct from p_stored_sha256 or a.size_bytes is distinct from p_size or a.expected_path is distinct from expected then
   raise exception 'Avatar command conflict.' using errcode='23505';end if;
  if a.state='committed' or a.state='retired' then
   return jsonb_build_object('complete',true,'currentPath',current_path);end if;
  if a.state<>'pending' or a.created_at<clock_timestamp()-interval '24 hours' then
   raise exception 'Avatar command expired.' using errcode='23505';end if;
 else
  if current_path is distinct from expected then raise exception 'Avatar changed; reload before retrying.' using errcode='23505';end if;
  if (select count(*) from marketplace_private.profile_avatar_uploads where owner_id=p_owner and created_at>clock_timestamp()-interval '1 hour')>=20 then
   raise exception 'Too many avatar requests.' using errcode='54000';end if;
  insert into marketplace_private.profile_avatar_uploads(id,owner_id,source_sha256,stored_sha256,size_bytes,expected_path)
   values(p_action,p_owner,p_source_sha256,p_stored_sha256,p_size,expected) returning * into a;
 end if;
 if current_path is distinct from a.expected_path or exists(select 1 from marketplace_private.profile_avatar_uploads where owner_id=p_owner and generation>a.generation) then
  raise exception 'A newer avatar request exists.' using errcode='23505';end if;
 return jsonb_build_object('complete',false,'path',a.path);
end;$$;

create function public.marketplace_commit_profile_avatar(p_owner uuid,p_action uuid)
returns text language plpgsql security definer set search_path='' as $$
declare a marketplace_private.profile_avatar_uploads;current_path text;
begin
 if not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null and lower(email) ~ '^[^[:space:]@]+@uwo[.]ca$') then
  raise exception 'Verified avatar owner required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('profile_avatar:'||p_owner::text,0));
 select avatar_path into current_path from public.profiles where id=p_owner for update;
 if not found then raise exception 'Profile unavailable.' using errcode='42501';end if;
 select * into a from marketplace_private.profile_avatar_uploads where id=p_action for update;
 if a.id is null or a.owner_id<>p_owner then raise exception 'Avatar unavailable.' using errcode='42501';end if;
 if a.state in('committed','retired') then return current_path;end if;
 if a.state<>'pending' or a.created_at<clock_timestamp()-interval '24 hours' or current_path is distinct from a.expected_path
  or exists(select 1 from marketplace_private.profile_avatar_uploads where owner_id=p_owner and generation>a.generation) then
  raise exception 'A newer avatar request exists.' using errcode='23505';end if;
 if not exists(select 1 from storage.objects where bucket_id='profile-avatars' and name=a.path) then
  raise exception 'Avatar upload missing.' using errcode='23514';end if;
 update marketplace_private.profile_avatar_uploads set state='retired',retired_at=clock_timestamp()
  where owner_id=p_owner and path=current_path and state='committed';
 update marketplace_private.profile_avatar_uploads set state='committed',committed_at=clock_timestamp() where id=a.id;
 update public.profiles set avatar_path=a.path where id=p_owner;
 return a.path;
end;$$;

-- Delayed cleanup is durable and retryable. A deleting command can never commit.
-- The grace period avoids racing requests still uploading immutable object names.
create function public.marketplace_claim_profile_avatar_cleanup(p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a marketplace_private.profile_avatar_uploads;result jsonb:='[]';
begin
 perform pg_advisory_xact_lock(hashtextextended('profile_avatar:'||p_owner::text,0));
 for a in select * from marketplace_private.profile_avatar_uploads u where u.owner_id=p_owner
  and ((u.state='pending' and u.created_at<clock_timestamp()-interval '24 hours')
   or (u.state='retired' and u.retired_at<clock_timestamp()-interval '24 hours')
   or (u.state='committed' and u.created_at<clock_timestamp()-interval '24 hours') or u.state='deleting'
   or (u.state='deleted' and exists(select 1 from storage.objects s where s.bucket_id='profile-avatars' and s.name=u.path)))
  and not exists(select 1 from public.profiles p where p.avatar_path=u.path)
  order by u.generation limit 10 for update loop
  update marketplace_private.profile_avatar_uploads set state='deleting' where id=a.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',a.id,'path',a.path));
 end loop;
 return result;
end;$$;
create function public.marketplace_finish_profile_avatar_cleanup(p_owner uuid,p_action uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('profile_avatar:'||p_owner::text,0));
 update marketplace_private.profile_avatar_uploads u set state='deleted' where u.id=p_action and u.owner_id=p_owner and u.state='deleting'
 and not exists(select 1 from public.profiles p where p.avatar_path=u.path);
end;$$;

revoke all on function public.marketplace_prepare_profile_avatar(uuid,uuid,uuid,text,text,integer),
 public.marketplace_commit_profile_avatar(uuid,uuid),public.marketplace_claim_profile_avatar_cleanup(uuid),
 public.marketplace_finish_profile_avatar_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_prepare_profile_avatar(uuid,uuid,uuid,text,text,integer),
 public.marketplace_commit_profile_avatar(uuid,uuid),public.marketplace_claim_profile_avatar_cleanup(uuid),
 public.marketplace_finish_profile_avatar_cleanup(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

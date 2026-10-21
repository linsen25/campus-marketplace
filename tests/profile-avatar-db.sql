-- Local PostgreSQL only; actual B03 migration and prior Profile triggers/RLS.
create function public.avatar_test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end;$$;
select public.avatar_test_assert((select data=(select to_jsonb(p)-'avatar_path' from public.profiles p where username='B03Legacy') from public.avatar_legacy_snapshot),'existing profile fields/timestamps unchanged by migration');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','avatar-a@uwo.ca',now(),'{"username":"AvatarA"}'),
 ('22222222-2222-4222-8222-222222222222','avatar-b@uwo.ca',now(),'{"username":"AvatarB"}');
select public.avatar_test_assert((select avatar_path is null from public.profiles limit 1),'legacy/default pointer NULL');
select public.avatar_test_assert((select not public and allowed_mime_types=array['image/webp'] and file_size_limit=3145728 from storage.buckets where id='profile-avatars'),'private WebP-only bucket');
select public.avatar_test_assert(not has_column_privilege('authenticated','public.profiles','avatar_path','UPDATE'),'no browser pointer update grant');
select public.avatar_test_assert(not has_table_privilege('service_role','marketplace_private.profile_avatar_uploads','UPDATE'),'no direct service table mutation grant');
do $$ begin
 begin set local role authenticated;perform public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',null,repeat('a',64),repeat('b',64),100);raise exception 'browser RPC accepted';exception when insufficient_privilege then null;end;
 begin set local role anon;perform public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');raise exception 'anon commit accepted';exception when insufficient_privilege then null;end;
end;$$;
set role service_role;
select public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',null,repeat('a',64),repeat('b',64),100);
-- Retry of the same validated intent is the same reservation.
select public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',null,repeat('a',64),repeat('b',64),100);
reset role;
insert into storage.objects(bucket_id,name) values('profile-avatars','11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.webp');
set role service_role;
select public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
reset role;
select public.avatar_test_assert((select count(*)=1 from marketplace_private.profile_avatar_uploads),'retry one reservation');
select public.avatar_test_assert((select avatar_path like '%aaa1.webp' from public.profiles where username='AvatarA'),'first commit persisted');
do $$ begin
 begin set local role authenticated;perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 insert into storage.objects(bucket_id,name) values('profile-avatars','11111111-1111-4111-8111-111111111111/forged.webp');raise exception 'direct Storage insert accepted';exception when insufficient_privilege then null;end;
end;$$;
set role authenticated;
select public.avatar_test_assert((select count(*)=0 from storage.objects where bucket_id='profile-avatars'),'browser cannot read private objects');
reset role;
set role service_role;
select public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('a',64),repeat('c',64),100);
select public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('a',64),repeat('d',64),100);
reset role;
insert into storage.objects(bucket_id,name) values
 ('profile-avatars','11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2.webp'),
 ('profile-avatars','11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3.webp');
set role service_role;
do $$ begin
 begin perform public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');raise exception 'older in-flight upload committed';exception when unique_violation then null;end;
 begin perform public.marketplace_commit_profile_avatar('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');raise exception 'wrong owner committed';exception when insufficient_privilege then null;end;
 begin perform public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('f',64),repeat('d',64),100);raise exception 'UUID reused for different content';exception when unique_violation then null;end;
end;$$;
select public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
-- Replaying a formerly successful request returns CURRENT, never reactivates old.
select public.avatar_test_assert(public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') like '%aaa3.webp','old successful retry does not overwrite current');
do $$ begin
 begin perform public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('a',64),repeat('e',64),100);raise exception 'stale initial version accepted';exception when unique_violation then null;end;
end;$$;
select public.marketplace_prepare_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',repeat('a',64),repeat('e',64),100);
do $$ begin
 begin perform public.marketplace_commit_profile_avatar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4');raise exception 'missing upload committed';exception when check_violation then null;end;
end;$$;
select public.avatar_test_assert(public.marketplace_claim_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111')='[]'::jsonb,'cleanup grace period');
reset role;
select public.avatar_test_assert((select avatar_path like '%aaa3.webp' from public.profiles where username='AvatarA'),'failed upload preserves previous pointer');
update marketplace_private.profile_avatar_uploads set created_at=now()-interval '25 hours',retired_at=case when retired_at is not null then now()-interval '25 hours' end;
set role service_role;
create temporary table cleanup_result as select public.marketplace_claim_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111') result;
select public.avatar_test_assert((select jsonb_array_length(result)=3 and not result::text like '%aaa3.webp%' from cleanup_result),'only unreferenced retired/pending objects claimed');
select public.avatar_test_assert(public.marketplace_claim_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111')=(select result from cleanup_result),'failed cleanup remains retryable');
select public.marketplace_finish_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
reset role;
select public.avatar_test_assert((select state='committed' from marketplace_private.profile_avatar_uploads where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),'current asset never cleaned');
delete from storage.objects where bucket_id='profile-avatars' and name in(select path from marketplace_private.profile_avatar_uploads where state='deleting');
set role service_role;
select public.marketplace_finish_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111',id) from (values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'::uuid)) t(id);
select public.avatar_test_assert(public.marketplace_claim_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111')='[]'::jsonb,'successful cleanup is idempotent');
reset role;
-- Even an unusually late Storage completion after a timeout/cleanup is tracked.
insert into storage.objects(bucket_id,name) values('profile-avatars','11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.webp');
set role service_role;
select public.avatar_test_assert(jsonb_array_length(public.marketplace_claim_profile_avatar_cleanup('11111111-1111-4111-8111-111111111111'))=1,'late orphan resurrection remains discoverable');
reset role;
select public.avatar_test_assert((select avatar_path is null from public.profiles where username='AvatarB'),'other owner unaffected');
insert into auth.users(id,email,raw_user_meta_data) values('44444444-4444-4444-8444-444444444444','unverified-avatar@uwo.ca','{"username":"AvatarUnverified"}');
set role service_role;
do $$ begin
 begin perform public.marketplace_prepare_profile_avatar('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,repeat('a',64),repeat('b',64),100);raise exception 'unverified owner accepted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select public.avatar_test_assert((select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc where proname in('marketplace_prepare_profile_avatar','marketplace_commit_profile_avatar','marketplace_claim_profile_avatar_cleanup','marketplace_finish_profile_avatar_cleanup')),'safe function search_path');

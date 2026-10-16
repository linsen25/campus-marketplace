-- Supabase's platform-injected service JWT may omit optional project-ref claims.
-- PostgREST verifies the project signature and service_role. The Edge worker also
-- fixes SUPABASE_URL and every RPC URL to staging; explicit mismatched refs fail.
begin;
create or replace function marketplace_private.require_notification_worker() returns void
language plpgsql stable set search_path='' as $$begin
 if auth.jwt()->>'role' is distinct from 'service_role'
 or (auth.jwt()->>'ref' is not null and auth.jwt()->>'ref'<>'pcaqxezdfxofysghssyo') then
 raise exception 'Trusted staging worker required.' using errcode='42501';end if;
end;$$;
revoke all on function marketplace_private.require_notification_worker() from public,anon,authenticated,service_role;
commit;

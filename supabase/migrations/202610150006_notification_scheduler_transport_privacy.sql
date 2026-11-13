-- Canonical notification transport stays disabled until deployment configures
-- an environment-specific worker endpoint and secret.
begin;
create function marketplace_private.call_email_worker(p_body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 raise exception 'Notification worker is not configured for this environment.' using errcode='42501';
end;$$;
create or replace function marketplace_private.invoke_email_worker() returns void
language plpgsql security definer set search_path='' as $$begin
 raise exception 'Notification worker is not configured for this environment.' using errcode='42501';
end;$$;
revoke all on function marketplace_private.call_email_worker(jsonb),marketplace_private.invoke_email_worker() from public,anon,authenticated,service_role;
-- Rotate only this newly-created worker credential, entirely within Vault.
-- No value is exported, logged or copied to local files/Edge configuration.
do $$declare secret_id uuid;begin
 select id into secret_id from vault.secrets where name='marketplace_notification_worker';
 perform vault.update_secret(secret_id,gen_random_uuid()::text||gen_random_uuid()::text);
end;$$;
commit;

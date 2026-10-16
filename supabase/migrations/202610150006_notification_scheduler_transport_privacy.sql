-- Staging: dispatch email worker without persisting auth headers in pg_net queues.
-- 004 introduced pg_net, whose managed PUBLIC ACL cannot be revoked by postgres.
-- Use the native synchronous HTTP extension only in the isolated scheduler call,
-- never inside a marketplace transaction. Resend still runs in the Edge worker.
begin;
create extension if not exists http with schema extensions;
create function marketplace_private.call_email_worker(p_body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare response record;
begin
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');
 select * into response from extensions.http(('POST',
  'https://pcaqxezdfxofysghssyo.supabase.co/functions/v1/notification-email-worker',
  array[extensions.http_header('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='marketplace_notification_worker'))],
  'application/json',p_body::text)::extensions.http_request);
 return jsonb_build_object('status',response.status,'body',response.content::jsonb);
end;$$;
create or replace function marketplace_private.invoke_email_worker() returns void
language plpgsql security definer set search_path='' as $$begin
 perform marketplace_private.call_email_worker('{}'::jsonb);
end;$$;
revoke all on function marketplace_private.call_email_worker(jsonb),marketplace_private.invoke_email_worker() from public,anon,authenticated,service_role;
-- Rotate only this newly-created worker credential, entirely within Vault.
-- No value is exported, logged or copied to local files/Edge configuration.
do $$declare secret_id uuid;begin
 select id into secret_id from vault.secrets where name='marketplace_notification_worker';
 perform vault.update_secret(secret_id,gen_random_uuid()::text||gen_random_uuid()::text);
end;$$;
commit;

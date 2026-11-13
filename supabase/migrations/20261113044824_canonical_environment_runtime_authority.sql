-- Canonical deployment authority. Historical migrations established these
-- functions with project-specific JWT refs. A service-role JWT is already
-- signed by the current project's JWT secret, so checking its role remains a
-- tenant-bound, fail-closed trust boundary without coupling a new project to
-- a prior project's ref. Notification delivery is separately disabled until
-- deployment configuration supplies a private worker endpoint.
begin;

create table marketplace_private.runtime_configuration (
  singleton boolean primary key default true check (singleton),
  notification_worker_url text,
  notification_worker_secret_name text not null default 'marketplace_notification_worker'
    check (notification_worker_secret_name ~ '^[a-z0-9_]{1,128}$'),
  check (
    notification_worker_url is null
    or notification_worker_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/notification-email-worker$'
  )
);
alter table marketplace_private.runtime_configuration enable row level security;
revoke all on table marketplace_private.runtime_configuration from public, anon, authenticated, service_role;
insert into marketplace_private.runtime_configuration(singleton) values (true);

do $migration$
declare
  item record;
  definition text;
  rewritten text;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  for item in
    select p.oid, p.oid::regprocedure as signature
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     where p.prokind='f'
       and n.nspname in ('public','marketplace_private')
       and p.oid::regprocedure::text <> 'marketplace_private.call_email_worker(jsonb)'
       and (
         pg_catalog.pg_get_functiondef(p.oid) like '%pcaqxezdfxofysghssyo%'
         or pg_catalog.pg_get_functiondef(p.oid) like '%giqdwyiupslpfhstbtqf%'
       )
  loop
    definition:=pg_catalog.pg_get_functiondef(item.oid);
    if definition not like '%service_role%' then
      raise exception 'Environment-bound function % lacks the reviewed service-role baseline.', item.signature
        using errcode='P0001';
    end if;
    select p.proowner,p.prosecdef,p.proconfig,p.proacl
      into before_owner,before_security_definer,before_config,before_acl
      from pg_catalog.pg_proc p where p.oid=item.oid;
    rewritten:=replace(definition,
      $$auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo'$$,
      'false');
    rewritten:=replace(rewritten,
      $$(select auth.jwt()->>'ref') is distinct from 'pcaqxezdfxofysghssyo'$$,
      'false');
    rewritten:=replace(rewritten,
      $$(auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'$$,
      'true');
    rewritten:=replace(rewritten,
      $$auth.jwt()->>'ref'='pcaqxezdfxofysghssyo'$$,
      'true');
    rewritten:=replace(rewritten,
      $$(select auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'$$,
      'true');
    rewritten:=replace(rewritten,
      $$auth.jwt()->>'ref' is not null and auth.jwt()->>'ref'<>'pcaqxezdfxofysghssyo'$$,
      'false');
    rewritten:=replace(rewritten,
      $$auth.jwt()->>'ref' is distinct from 'giqdwyiupslpfhstbtqf'$$,
      'false');
    rewritten:=replace(rewritten,
      $$(auth.jwt()->>'ref')='giqdwyiupslpfhstbtqf'$$,
      'true');
    -- Cover all syntax variants of these legacy literal checks. Replacing the
    -- expected ref with the authenticated token's own ref makes only the ref
    -- comparison tautological; the independent service_role predicate stays
    -- mandatory and the JWT remains verified by this project's signing key.
    rewritten:=replace(rewritten,
      '''pcaqxezdfxofysghssyo''',
      'coalesce(auth.jwt()->>''ref'','''')');
    rewritten:=replace(rewritten,
      '''giqdwyiupslpfhstbtqf''',
      'coalesce(auth.jwt()->>''ref'','''')');
    if rewritten=definition
       or rewritten like '%pcaqxezdfxofysghssyo%'
       or rewritten like '%giqdwyiupslpfhstbtqf%' then
      raise exception 'Environment authority baseline drifted for %.', item.signature using errcode='P0001';
    end if;
    execute rewritten;
    select p.proowner,p.prosecdef,p.proconfig,p.proacl
      into after_owner,after_security_definer,after_config,after_acl
      from pg_catalog.pg_proc p where p.oid=item.oid;
    if after_owner is distinct from before_owner
       or after_security_definer is distinct from before_security_definer
       or after_config is distinct from before_config
       or after_acl is distinct from before_acl then
      raise exception 'Environment authority metadata changed for %.', item.signature using errcode='P0001';
    end if;
  end loop;
end;
$migration$;

do $migration$
declare
  signature regprocedure := 'marketplace_private.call_email_worker(jsonb)'::regprocedure;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
  definition text;
begin
  definition:=pg_catalog.pg_get_functiondef(signature::oid);
  if definition not like '%Notification worker is not configured for this environment.%' then
    raise exception 'Notification worker baseline drifted.' using errcode='P0001';
  end if;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into before_owner,before_security_definer,before_config,before_acl
    from pg_catalog.pg_proc p where p.oid=signature;
  execute $ddl$
    create or replace function marketplace_private.call_email_worker(p_body jsonb default '{}'::jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $body$
    declare
      response record;
      configured_url text;
      configured_secret text;
    begin
      select notification_worker_url,notification_worker_secret_name
        into configured_url,configured_secret
        from marketplace_private.runtime_configuration where singleton=true;
      if configured_url is null or configured_secret is null then
        raise exception 'Notification worker is not configured for this environment.' using errcode='42501';
      end if;
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');
      select * into response from extensions.http(('POST',configured_url,
        array[extensions.http_header('Authorization','Bearer '||(
          select decrypted_secret from vault.decrypted_secrets where name=configured_secret
        ))], 'application/json',p_body::text)::extensions.http_request);
      return jsonb_build_object('status',response.status,'body',response.content::jsonb);
    end;
    $body$;
  $ddl$;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into after_owner,after_security_definer,after_config,after_acl
    from pg_catalog.pg_proc p where p.oid=signature;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'Notification worker metadata changed unexpectedly.' using errcode='P0001';
  end if;
end;
$migration$;

commit;

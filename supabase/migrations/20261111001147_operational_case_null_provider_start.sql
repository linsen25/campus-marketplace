-- B32 Stripe payment recovery: a fresh provider attempt has a NULL
-- provider_create_started_at.  SQL three-valued logic made NOT(overdue)
-- evaluate to NULL, so the old function created a false payment_exception
-- case before the provider binding was initialized.  This migration fixes
-- the predicate and narrowly repairs only that audited false-positive shape.
begin;

do $migration$
declare
  sync_signature constant regprocedure :=
    'marketplace_private.sync_operational_case(text,uuid)'::regprocedure;
  protect_signature constant regprocedure :=
    'marketplace_private.protect_operational_case()'::regprocedure;
  sync_definition text := pg_catalog.pg_get_functiondef(sync_signature::oid);
  old_guard constant text := $$if a.provider_reconcile_state is distinct from 'exception' and a.provider_exception_code is null
   and not(a.status='processing' and((a.provider_reference is null
    and a.provider_create_started_at<=t-interval '20 hours')
    or(a.provider_reference is not null and a.provider_reconcile_attempts>=10))) and not had_case then return null;end if;$$;
  new_guard constant text := $$if a.provider_reconcile_state is distinct from 'exception' and a.provider_exception_code is null
   and not coalesce(a.status='processing' and((a.provider_reference is null
    and a.provider_create_started_at<=t-interval '20 hours')
    or(a.provider_reference is not null and a.provider_reconcile_attempts>=10)),false) and not had_case then return null;end if;$$;
  old_declaration constant text :=
    'status_key text;observed_key timestamptz;changed boolean:=false;had_case boolean:=false;';
  new_declaration constant text :=
    'status_key text;observed_key timestamptz;changed boolean:=false;had_case boolean:=false;binding_enriched boolean:=false;';
  old_binding constant text := $$if c.order_id is distinct from order_key or c.payment_attempt_id is distinct from attempt_key
   or c.provider is distinct from provider_key or c.provider_mode is distinct from mode_key
   or c.provider_platform is distinct from platform_key or c.provider_object_ref is distinct from object_key
   or c.category is distinct from category_key then
   raise exception 'Operational case source binding conflict.' using errcode='23514';end if;
  changed:=c.risk_level is distinct from risk_key or c.priority is distinct from priority_key$$;
  new_binding constant text := $$if c.order_id is distinct from order_key or c.payment_attempt_id is distinct from attempt_key
   or c.category is distinct from category_key
   or(c.provider is not null and c.provider is distinct from provider_key)
   or(c.provider_mode is not null and c.provider_mode is distinct from mode_key)
   or(c.provider_platform is not null and c.provider_platform is distinct from platform_key)
   or(c.provider_object_ref is not null and c.provider_object_ref is distinct from object_key) then
   raise exception 'Operational case source binding conflict.' using errcode='23514';end if;
  binding_enriched:=p_source_kind='payment_exception' and(
   (c.provider is null and provider_key is not null)
   or(c.provider_mode is null and mode_key is not null)
   or(c.provider_platform is null and platform_key is not null)
   or(c.provider_object_ref is null and object_key is not null));
  if binding_enriched then
   update marketplace_private.operational_cases set
    provider=coalesce(provider,provider_key),provider_mode=coalesce(provider_mode,mode_key),
    provider_platform=coalesce(provider_platform,platform_key),
    provider_object_ref=coalesce(provider_object_ref,object_key),
    version=version+1,updated_at=t where id=c.id returning * into c;
   insert into marketplace_private.operational_case_audit(
    case_id,case_version,actor_kind,actor_subject,action,action_result,source_event_key)
   values(c.id,c.version,'system_service','database_trigger','source_refreshed','applied',
    c.id::text||':'||c.version::text) on conflict do nothing;
  end if;
  changed:=c.risk_level is distinct from risk_key or c.priority is distinct from priority_key$$;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
  protect_before_owner oid;
  protect_after_owner oid;
  protect_before_security_definer boolean;
  protect_after_security_definer boolean;
  protect_before_config text[];
  protect_after_config text[];
  protect_before_acl aclitem[];
  protect_after_acl aclitem[];
begin
  if (length(sync_definition)-length(replace(sync_definition,old_guard,''))) / length(old_guard) <> 1
     or position(new_guard in sync_definition) > 0
     or (length(sync_definition)-length(replace(sync_definition,old_declaration,''))) / length(old_declaration) <> 1
     or (length(sync_definition)-length(replace(sync_definition,old_binding,''))) / length(old_binding) <> 1 then
    raise exception 'Operational case synchronization baseline drifted.' using errcode='P0001';
  end if;
  if pg_catalog.pg_get_functiondef(protect_signature::oid)
     not like '%Operational case binding and review authority are immutable.%' then
    raise exception 'Operational case protection baseline drifted.' using errcode='P0001';
  end if;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into before_owner,before_security_definer,before_config,before_acl
    from pg_catalog.pg_proc p where p.oid=sync_signature::oid;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into protect_before_owner,protect_before_security_definer,protect_before_config,protect_before_acl
    from pg_catalog.pg_proc p where p.oid=protect_signature::oid;

  -- A payment case may only seal a previously NULL provider binding.  Any
  -- non-NULL source value remains immutable, including the PaymentIntent ref.
  create or replace function marketplace_private.protect_operational_case()
  returns trigger language plpgsql set search_path='' as $body$
  declare provider_enrichment boolean;
  begin
   if tg_op='DELETE' then
    raise exception 'Operational case binding and review authority are immutable.' using errcode='23514';end if;
   provider_enrichment:=old.source_kind='payment_exception'
    and new.source_kind=old.source_kind and new.source_id=old.source_id
    and new.order_id is not distinct from old.order_id
    and new.payment_attempt_id is not distinct from old.payment_attempt_id
    and new.category=old.category
    and new.provider='stripe' and new.provider_mode='test'
    and new.provider_platform is not null
    and(old.provider is null or new.provider is not distinct from old.provider)
    and(old.provider_mode is null or new.provider_mode is not distinct from old.provider_mode)
    and(old.provider_platform is null or new.provider_platform is not distinct from old.provider_platform)
    and(old.provider_object_ref is null or new.provider_object_ref is not distinct from old.provider_object_ref);
   if (to_jsonb(new)-array['risk_level','priority','response_due_at','hold_projection','release_projection',
     'source_status','source_observed_at','provider','provider_mode','provider_platform','provider_object_ref',
     'version','updated_at']) is distinct from
    (to_jsonb(old)-array['risk_level','priority','response_due_at','hold_projection','release_projection',
     'source_status','source_observed_at','provider','provider_mode','provider_platform','provider_object_ref',
     'version','updated_at'])
    or(not provider_enrichment and(
      new.provider is distinct from old.provider or new.provider_mode is distinct from old.provider_mode
      or new.provider_platform is distinct from old.provider_platform
      or new.provider_object_ref is distinct from old.provider_object_ref))
    or new.review_status is distinct from old.review_status
    or new.version<>old.version+1 then
    raise exception 'Operational case binding and review authority are immutable.' using errcode='23514';end if;
   return new;
  end;$body$;

  sync_definition:=replace(sync_definition,old_declaration,new_declaration);
  sync_definition:=replace(sync_definition,old_guard,new_guard);
  sync_definition:=replace(sync_definition,old_binding,new_binding);
  execute sync_definition;

  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into after_owner,after_security_definer,after_config,after_acl
    from pg_catalog.pg_proc p where p.oid=sync_signature::oid;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'Operational case synchronization metadata changed.' using errcode='P0001';
  end if;
  if not before_security_definer or before_config is distinct from array['search_path=""']::text[] then
    raise exception 'Operational case synchronization security baseline drifted.' using errcode='P0001';
  end if;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into protect_after_owner,protect_after_security_definer,protect_after_config,protect_after_acl
    from pg_catalog.pg_proc p where p.oid=protect_signature::oid;
  if protect_after_owner is distinct from protect_before_owner
     or protect_after_security_definer is distinct from protect_before_security_definer
     or protect_after_config is distinct from protect_before_config
     or protect_after_acl is distinct from protect_before_acl
     or protect_after_security_definer
     or protect_after_config is distinct from array['search_path=""']::text[] then
    raise exception 'Operational case protection metadata changed.' using errcode='P0001';
  end if;
end;
$migration$;

-- Resolve only the impossible pre-fix shape.  No row is deleted, source IDs
-- and evidence remain immutable, and every repaired row receives audit v+1.
do $migration$
declare
  candidate_count integer;
  item record;
begin
  select count(*) into candidate_count
    from marketplace_private.operational_cases c
    join marketplace_private.campus_payment_attempts a
      on a.id=c.source_id and a.id=c.payment_attempt_id
   where c.source_kind='payment_exception'
     and c.category='payment_reconciliation'
     and c.provider is null and c.provider_mode is null
     and c.provider_platform is null and c.provider_object_ref is null
     and c.review_status='open' and c.risk_level='medium' and c.priority=60
     and c.hold_projection='unknown' and c.release_projection='existing_rules_only'
     and c.source_status='unknown:none'
     and a.status='processing' and a.provider is null
     and a.provider_create_started_at is null
     and a.provider_reference is null
     and a.provider_reconcile_state is null
     and a.provider_exception_code is null
     and a.provider_reconcile_attempts=0;
  if candidate_count > 1 then
    raise exception 'Unexpected number of NULL-start phantom cases: %.',candidate_count using errcode='P0001';
  end if;

  alter table marketplace_private.operational_cases
    disable trigger operational_case_protected;
  for item in
    select c.id,c.version
      from marketplace_private.operational_cases c
      join marketplace_private.campus_payment_attempts a
        on a.id=c.source_id and a.id=c.payment_attempt_id
     where c.source_kind='payment_exception'
       and c.category='payment_reconciliation'
       and c.provider is null and c.provider_mode is null
       and c.provider_platform is null and c.provider_object_ref is null
       and c.review_status='open' and c.risk_level='medium' and c.priority=60
       and c.hold_projection='unknown' and c.release_projection='existing_rules_only'
       and c.source_status='unknown:none'
       and a.status='processing' and a.provider is null
       and a.provider_create_started_at is null
       and a.provider_reference is null
       and a.provider_reconcile_state is null
       and a.provider_exception_code is null
       and a.provider_reconcile_attempts=0
     for update of c
  loop
    update marketplace_private.operational_cases
       set review_status='resolved',source_status='phantom_null_start_repaired',
           version=version+1,updated_at=clock_timestamp()
     where id=item.id and version=item.version;
    if not found then raise exception 'Phantom case repair raced.' using errcode='40001';end if;
    insert into marketplace_private.operational_case_audit(
      case_id,case_version,actor_kind,actor_subject,action,action_result,source_event_key)
    values(item.id,item.version+1,'system_service','database_trigger','review_transition','applied',
      'migration013:phantom:'||item.id::text);
  end loop;
  alter table marketplace_private.operational_cases
    enable trigger operational_case_protected;
end;
$migration$;

-- Permissions and trigger topology remain fail closed.
do $migration$
begin
  if pg_catalog.has_function_privilege('anon','marketplace_private.sync_operational_case(text,uuid)','execute')
     or pg_catalog.has_function_privilege('authenticated','marketplace_private.sync_operational_case(text,uuid)','execute')
     or pg_catalog.has_function_privilege('service_role','marketplace_private.sync_operational_case(text,uuid)','execute') then
    raise exception 'Private operational case synchronization became executable.' using errcode='P0001';
  end if;
  if not exists(
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid='marketplace_private.campus_payment_attempts'::regclass
       and t.tgname='payment_exception_operational_index'
       and t.tgenabled<>'D' and not t.tgisinternal
  ) or not exists(
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid='marketplace_private.operational_cases'::regclass
       and t.tgname='operational_case_protected'
       and t.tgenabled<>'D' and not t.tgisinternal
  ) then
    raise exception 'Operational case trigger topology changed.' using errcode='P0001';
  end if;
end;
$migration$;

commit;

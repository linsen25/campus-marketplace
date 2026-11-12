-- B32 Stripe Test only: the historical V2 order guard still named the old
-- staging project's service-role JWT ref.  Reconciliation remains trusted
-- server work, but B32's own service role must be able to record an already
-- retrieved Stripe observation.  No client role gains any payment authority.
begin;

do $migration$
declare
  signature constant regprocedure := 'marketplace_private.protect_order()'::regprocedure;
  definition text := pg_catalog.pg_get_functiondef(signature::oid);
  old_fragment constant text :=
    $old$and (auth.jwt()->>'role')='service_role' and (auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'$old$;
  new_fragment constant text :=
    $new$and (auth.jwt()->>'role')='service_role' and (auth.jwt()->>'ref')='giqdwyiupslpfhstbtqf'$new$;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  if definition is null
     or (length(definition)-length(replace(definition,old_fragment,''))) / length(old_fragment) <> 1
     or position(new_fragment in definition) > 0
     or definition not like '%Trusted V2 payment receipt required.%'
     or definition not like '%marketplace_private.payment_mode(old.terms_snapshot->''terms'')%'
     or definition not like '%new.payment_paid_at=a.finished_at%' then
    raise exception 'B32 payment receipt authority baseline drifted.' using errcode='P0001';
  end if;

  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into before_owner,before_security_definer,before_config,before_acl
    from pg_catalog.pg_proc p where p.oid=signature::oid;
  if not found or not before_security_definer
     or before_config is distinct from array['search_path=""']::text[] then
    raise exception 'B32 payment receipt function security baseline drifted.' using errcode='P0001';
  end if;

  execute replace(definition,old_fragment,new_fragment);

  definition := pg_catalog.pg_get_functiondef(signature::oid);
  if position(old_fragment in definition) > 0
     or (length(definition)-length(replace(definition,new_fragment,''))) / length(new_fragment) <> 1
     or definition not like '%Trusted V2 payment receipt required.%' then
    raise exception 'B32 payment receipt authority replacement failed.' using errcode='P0001';
  end if;
  select p.proowner,p.prosecdef,p.proconfig,p.proacl
    into after_owner,after_security_definer,after_config,after_acl
    from pg_catalog.pg_proc p where p.oid=signature::oid;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'B32 payment receipt function metadata changed.' using errcode='P0001';
  end if;
end;
$migration$;

commit;

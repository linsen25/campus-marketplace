-- Fulfillment is a participant-scoped read projection. It
-- composes cancellation state, so its identity rule must not be stricter than
-- its own verified-participant guard.  Cancellation and refund mutations are
-- intentionally untouched.
begin;

do $migration$
declare
  signature text := 'public.marketplace_order_cancellation_state(uuid)';
  definition text;
  old_guard text := $$if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;$$;
  new_guard text := $$if auth.uid() is null or not coalesce(marketplace_private.is_verified_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;$$;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into before_owner, before_security_definer, before_config, before_acl
    from pg_catalog.pg_proc p
   where p.oid = signature::regprocedure::oid;
  if not found then
    raise exception 'Cancellation-state projection is absent from the reviewed baseline.'
      using errcode = 'P0001';
  end if;
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure::oid);
  if (length(definition) - length(replace(definition, old_guard, '')))
       / length(old_guard) <> 1
     or definition like '%' || new_guard || '%' then
    raise exception 'Cancellation-state projection identity baseline drifted.'
      using errcode = 'P0001';
  end if;
  if definition not like '%auth.uid() is distinct from o.buyer_id%'
     or definition not like '%auth.uid() is distinct from o.seller_id%'
     or definition not like '%order_cancellation_intents%'
     or definition not like '%order_settlement_authorizations%'
     or definition not like '%seller_delivery_starts%' then
    raise exception 'Cancellation-state participant/read baseline drifted.'
      using errcode = 'P0001';
  end if;
  execute replace(definition, old_guard, new_guard);
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure::oid);
  if definition like '%' || old_guard || '%'
     or definition not like '%' || new_guard || '%'
     or definition like '%is_western_user()%' then
    raise exception 'Cancellation-state projection did not receive the verified-user guard.'
      using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into after_owner, after_security_definer, after_config, after_acl
    from pg_catalog.pg_proc p
   where p.oid = signature::regprocedure::oid;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'Cancellation-state projection metadata changed unexpectedly.'
      using errcode = 'P0001';
  end if;
end;
$migration$;

commit;

-- Executed only against a disposable Supabase Local database after db reset.
do $$
declare definition text; target_oid oid;
begin
  target_oid := 'public.marketplace_notifications_filtered(timestamptz,uuid,text,text)'::regprocedure;
  definition := pg_get_functiondef(target_oid);
  if definition like '%marketplace_private.is_western_user()%' then
    raise exception 'filtered notification RPC still uses legacy Western predicate';
  end if;
  if definition not like '%marketplace_private.is_verified_user()%' then
    raise exception 'filtered notification RPC does not use verified predicate';
  end if;
  if definition not like '%limit 51%' or definition not like '%90 days%' then
    raise exception 'filtered notification pagination contract changed';
  end if;
  if not (select prosecdef from pg_proc where oid=target_oid) then
    raise exception 'filtered notification RPC lost SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', target_oid, 'execute')
     or has_function_privilege('service_role', target_oid, 'execute') then
    raise exception 'filtered notification RPC is exposed to an unauthorized role';
  end if;
  if not has_function_privilege('authenticated', target_oid, 'execute') then
    raise exception 'filtered notification RPC is not executable by authenticated';
  end if;
end $$;

select p.rolname as grantee, has_function_privilege(
  p.rolname,
  'public.marketplace_notifications_filtered(timestamptz,uuid,text,text)',
  'execute'
) as can_execute
from pg_roles p
where p.rolname in ('anon','authenticated','service_role');

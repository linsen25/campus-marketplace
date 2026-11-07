-- B31 database assertions. Executed only inside the disposable local Supabase DB.
begin;
do $$
declare
  gate record;
  fn record;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='marketplace_private' and table_name='order_protection'
      and column_name in ('buyer_confirmed_at','release_eligible_at')
    group by table_schema,table_name having count(*)=2
  ) then raise exception 'B31 protection columns missing'; end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='marketplace_private.order_protection'::regclass
      and conname='order_protection_release_window_check'
  ) then raise exception 'B31 release window constraint missing'; end if;
  if (timestamp with time zone '2026-01-01 00:00:00+00' + interval '48 hours')
      <> timestamp with time zone '2026-01-03 00:00:00+00' then
    raise exception '48-hour arithmetic failed';
  end if;
  select p.prosecdef,p.proconfig into fn
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='marketplace_confirm_buyer_receipt'
    and pg_get_function_identity_arguments(p.oid)='uuid, uuid';
  if not found or not fn.prosecdef or not coalesce(fn.proconfig @> ARRAY['search_path='],false) then
    raise exception 'buyer receipt RPC security metadata invalid';
  end if;
  if not exists(select 1 from pg_trigger where tgname='order_transfer_b31_release_gate') then
    raise exception 'B31 transfer release trigger missing';
  end if;
end $$;
rollback;

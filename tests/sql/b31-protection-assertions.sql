-- B31 database assertions. Executed only inside the disposable local Supabase DB.
begin;
do $$
declare
  gate record;
  fn record;
  protection_columns integer;
  release_constraint boolean;
  receipt_rpc_count integer;
  receipt_rpc_secure boolean;
  transfer_gate_count integer;
begin
  select count(*) into protection_columns
    from information_schema.columns
    where table_schema='marketplace_private' and table_name='order_protection'
      and column_name in ('buyer_confirmed_at','release_eligible_at');
  if protection_columns <> 2 then
    raise exception 'B31 protection columns mismatch: expected 2, got %', protection_columns;
  end if;
  select exists(
    select 1 from pg_constraint
    where conrelid='marketplace_private.order_protection'::regclass
      and conname='order_protection_release_window_check'
  ) into release_constraint;
  if not release_constraint then
    raise exception 'B31 release window constraint missing';
  end if;
  if (timestamp with time zone '2026-01-01 00:00:00+00' + interval '48 hours')
      <> timestamp with time zone '2026-01-03 00:00:00+00' then
    raise exception '48-hour arithmetic failed';
  end if;
  select count(*) into receipt_rpc_count
  from pg_proc p
  where p.oid=to_regprocedure('public.marketplace_confirm_buyer_receipt(uuid,uuid)');
  select p.prosecdef and coalesce(p.proconfig @> ARRAY['search_path=""'],false)
    into receipt_rpc_secure
  from pg_proc p
  where p.oid=to_regprocedure('public.marketplace_confirm_buyer_receipt(uuid,uuid)');
  if receipt_rpc_count <> 1 or not coalesce(receipt_rpc_secure,false) then
    raise exception 'buyer receipt RPC security metadata invalid: count %, secure %', receipt_rpc_count, receipt_rpc_secure;
  end if;
  select count(*) into transfer_gate_count from pg_trigger where tgname='order_transfer_b31_release_gate';
  if transfer_gate_count <> 1 then
    raise exception 'B31 transfer release trigger mismatch: expected 1, got %', transfer_gate_count;
  end if;
end $$;
rollback;

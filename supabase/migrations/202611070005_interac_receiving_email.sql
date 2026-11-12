-- B32: minimal Interac e-Transfer receiving address.
-- This is contact data, not bank credentials and never a payment confirmation.
begin;

create table if not exists marketplace_private.interac_receiving_emails (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  receiving_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interac_receiving_email_format check (
    length(receiving_email) between 3 and 254
    and receiving_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
);
alter table marketplace_private.interac_receiving_emails enable row level security;
revoke all on marketplace_private.interac_receiving_emails from public, anon, authenticated, service_role;
grant select, insert, update, delete on marketplace_private.interac_receiving_emails to authenticated;

drop policy if exists interac_receiving_email_owner_read on marketplace_private.interac_receiving_emails;
create policy interac_receiving_email_owner_read
  on marketplace_private.interac_receiving_emails for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists interac_receiving_email_owner_write on marketplace_private.interac_receiving_emails;
create policy interac_receiving_email_owner_write
  on marketplace_private.interac_receiving_emails for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create or replace function public.marketplace_get_interac_receiving_email()
returns text language sql stable set search_path='' as $$
  select receiving_email
  from marketplace_private.interac_receiving_emails
  where owner_id = auth.uid() and marketplace_private.is_verified_user();
$$;

create or replace function public.marketplace_set_interac_receiving_email(p_email text)
returns text language plpgsql set search_path='' as $$
declare normalized text;
begin
  if not coalesce(marketplace_private.is_verified_user(), false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  normalized := lower(btrim(coalesce(p_email, '')));
  if normalized = '' then
    delete from marketplace_private.interac_receiving_emails where owner_id = auth.uid();
    return null;
  end if;
  if length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid Interac receiving email.' using errcode='22023';
  end if;
  insert into marketplace_private.interac_receiving_emails(owner_id, receiving_email)
    values (auth.uid(), normalized)
  on conflict (owner_id) do update
    set receiving_email = excluded.receiving_email, updated_at = now();
  return normalized;
end;
$$;

create or replace function public.marketplace_get_order_interac_email(p_order_id uuid)
returns text language sql stable security definer set search_path='pg_catalog, public, marketplace_private' as $$
  select e.receiving_email
  from public.orders o
  join marketplace_private.interac_receiving_emails e on e.owner_id = o.seller_id
  where o.id = p_order_id
    and marketplace_private.is_verified_user()
    and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    and o.terms_snapshot->'terms'->>'payment_mode' = 'interac_etransfer';
$$;

revoke all on function public.marketplace_get_interac_receiving_email() from public, anon;
revoke all on function public.marketplace_set_interac_receiving_email(text) from public, anon;
revoke all on function public.marketplace_get_order_interac_email(uuid) from public, anon;
grant execute on function public.marketplace_get_interac_receiving_email() to authenticated;
grant execute on function public.marketplace_set_interac_receiving_email(text) to authenticated;
grant execute on function public.marketplace_get_order_interac_email(uuid) to authenticated;

commit;

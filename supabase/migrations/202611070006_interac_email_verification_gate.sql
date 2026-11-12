-- B32: never treat an arbitrary secondary email as verified.
begin;
alter table marketplace_private.interac_receiving_emails
  add column if not exists verified_at timestamptz;
update marketplace_private.interac_receiving_emails e
set verified_at = u.email_confirmed_at
from auth.users u
where u.id = e.owner_id and u.email_confirmed_at is not null
  and lower(u.email) = lower(e.receiving_email);
create or replace function public.marketplace_get_interac_receiving_email_status()
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('email', receiving_email, 'verified', verified_at is not null, 'verifiedAt', verified_at)
  from marketplace_private.interac_receiving_emails
  where owner_id = auth.uid() and marketplace_private.is_verified_user();
$$;
create or replace function public.marketplace_set_interac_receiving_email(p_email text)
returns text language plpgsql set search_path='' as $$
declare normalized text; confirmed_at timestamptz;
begin
  if not coalesce(marketplace_private.is_verified_user(), false) then raise exception 'Verified account required.' using errcode='42501'; end if;
  normalized := lower(btrim(coalesce(p_email, '')));
  if normalized = '' then delete from marketplace_private.interac_receiving_emails where owner_id = auth.uid(); return null; end if;
  if length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid Interac receiving email.' using errcode='22023'; end if;
  select u.email_confirmed_at into confirmed_at from auth.users u where u.id = auth.uid() and lower(u.email) = normalized;
  insert into marketplace_private.interac_receiving_emails(owner_id, receiving_email, verified_at) values (auth.uid(), normalized, confirmed_at)
  on conflict (owner_id) do update set receiving_email = excluded.receiving_email, verified_at = excluded.verified_at, updated_at = now();
  return normalized;
end; $$;
create or replace function public.marketplace_get_order_interac_email(p_order_id uuid)
returns text language sql stable security definer set search_path='pg_catalog, public, marketplace_private' as $$
  select e.receiving_email from public.orders o join marketplace_private.interac_receiving_emails e on e.owner_id = o.seller_id
  where o.id = p_order_id and e.verified_at is not null and marketplace_private.is_verified_user()
    and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    and o.terms_snapshot->'terms'->>'payment_mode' = 'interac_etransfer';
$$;
revoke all on function public.marketplace_get_interac_receiving_email_status() from public, anon;
grant execute on function public.marketplace_get_interac_receiving_email_status() to authenticated;
commit;

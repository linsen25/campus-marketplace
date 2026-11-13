-- B32: avoid granting authenticated access to auth.users for Interac settings.
begin;
-- The table was historically writable by authenticated users.  Interac
-- verification is security-sensitive, so all direct table access is removed;
-- the SECURITY DEFINER functions below are the only application write/read
-- path.  The function owner remains the trusted database owner, not the JWT
-- caller.
revoke all on table marketplace_private.interac_receiving_emails
  from public, anon, authenticated, service_role;

create or replace function public.marketplace_get_interac_receiving_email()
returns text
language sql stable security definer
set search_path='pg_catalog, public, marketplace_private'
as $$
  select e.receiving_email
  from marketplace_private.interac_receiving_emails e
  where e.owner_id = auth.uid()
    and marketplace_private.is_verified_user();
$$;

create or replace function public.marketplace_get_interac_receiving_email_status()
returns jsonb
language sql stable security definer
set search_path='pg_catalog, public, marketplace_private'
as $$
  select jsonb_build_object(
    'email', e.receiving_email,
    'verified', e.verified_at is not null,
    'verifiedAt', e.verified_at
  )
  from marketplace_private.interac_receiving_emails e
  where e.owner_id = auth.uid()
    and marketplace_private.is_verified_user();
$$;

create or replace function public.marketplace_set_interac_receiving_email(p_email text)
returns text language plpgsql security definer
set search_path='pg_catalog, public, marketplace_private' as $$
declare normalized text; confirmed_at timestamptz;
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
  -- The JWT email is only accepted when it still matches the current,
  -- confirmed Auth identity.  No client-supplied verified flag is trusted.
  select u.email_confirmed_at into confirmed_at
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and lower(u.email) = normalized
    and lower(coalesce(auth.jwt()->>'email', '')) = normalized;
  insert into marketplace_private.interac_receiving_emails(owner_id, receiving_email, verified_at)
    values (auth.uid(), normalized, confirmed_at)
  on conflict (owner_id) do update
    set receiving_email = excluded.receiving_email,
        verified_at = excluded.verified_at,
        updated_at = now();
  return normalized;
end;
$$;

revoke all on function public.marketplace_get_interac_receiving_email() from public, anon;
revoke all on function public.marketplace_get_interac_receiving_email_status() from public, anon;
revoke all on function public.marketplace_set_interac_receiving_email(text) from public, anon;
revoke all on function public.marketplace_get_order_interac_email(uuid) from public, anon;
grant execute on function public.marketplace_get_interac_receiving_email() to authenticated;
grant execute on function public.marketplace_get_interac_receiving_email_status() to authenticated;
grant execute on function public.marketplace_set_interac_receiving_email(text) to authenticated;
grant execute on function public.marketplace_get_order_interac_email(uuid) to authenticated;
commit;

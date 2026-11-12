-- B32-only compatibility guard for the independent Stripe Sandbox project.
-- Keep the service-role requirement; this migration is intentionally scoped to
-- the independent B32 test project and fails closed elsewhere.
create or replace function marketplace_private.require_stripe_staging() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role'
     or auth.jwt()->>'ref' is distinct from 'giqdwyiupslpfhstbtqf' then
    raise exception 'Trusted staging service required.' using errcode='42501';
  end if;
end;
$$;
revoke all on function marketplace_private.require_stripe_staging() from public, anon, authenticated, service_role;
grant execute on function marketplace_private.require_stripe_staging() to service_role;

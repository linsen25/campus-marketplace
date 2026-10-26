-- Public identity signal only; never exposes the UWO address or approval state.
begin;
create or replace function public.marketplace_uwo_identity_badge(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user_id is not null and marketplace_private.is_uwo_email_verified(p_user_id);
$$;
revoke all on function public.marketplace_uwo_identity_badge(uuid) from public,anon,service_role;
grant execute on function public.marketplace_uwo_identity_badge(uuid) to authenticated;
commit;

-- Read-only capability recovery; no account lookup input or mutation.
begin;
create function public.marketplace_pending_signup_resumable(p_ticket text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_ticket ~ '^[0-9a-f]{64}$' then exists (
    select 1 from marketplace_private.pending_signup_controls s
    join auth.users u on u.id = s.user_id
    join public.profiles p on p.id = u.id
    where s.ticket_hash = encode(sha256(convert_to(p_ticket, 'UTF8')), 'hex')
      and s.expires_at > now()
      and u.email_confirmed_at is null
      and lower(u.email) ~ '^[^[:space:]@]+@uwo[.]ca$'
  ) else false end;
$$;
revoke all on function public.marketplace_pending_signup_resumable(text) from public, anon, authenticated;
grant execute on function public.marketplace_pending_signup_resumable(text) to service_role;
commit;

-- Auth-only pending signup correction. Staging first; production remains pending.
begin;
create table marketplace_private.pending_signup_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ticket_hash text not null unique check (ticket_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  correction_transaction bigint
);
alter table marketplace_private.pending_signup_controls enable row level security;
revoke all on marketplace_private.pending_signup_controls from public, anon, authenticated, service_role;

-- Bind only during original Auth INSERT. Duplicate signUp cannot acquire ownership.
create or replace function marketplace_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare chosen text; ticket text;
begin
  chosen := new.raw_user_meta_data->>'username';
  if chosen is null then raise exception 'Username is required.' using errcode = '23514'; end if;
  insert into public.profiles(id, display_name, username) values (new.id, chosen, chosen);
  ticket := new.raw_user_meta_data->>'pending_signup_ticket';
  if new.email_confirmed_at is null and ticket ~ '^[0-9a-f]{64}$' then
    insert into marketplace_private.pending_signup_controls(user_id, ticket_hash)
      values (new.id, encode(sha256(convert_to(ticket, 'UTF8')), 'hex'));
  end if;
  -- Plaintext capability never remains in persisted Auth metadata.
  if new.raw_user_meta_data ? 'pending_signup_ticket' then
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'pending_signup_ticket' where id = new.id;
  end if;
  return new;
end; $$;

create or replace function marketplace_private.protect_username_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pending_correction boolean := false;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    if new.username_changed_at is distinct from old.username_changed_at then
      raise exception 'Username cooldown cannot be changed directly.' using errcode = '42501';
    end if;
    if new.username is not null then new.display_name := new.username; end if;
    return new;
  end if;
  if not marketplace_private.username_valid(new.username) then
    raise exception 'Use 3-20 letters, numbers, or underscores.' using errcode = '23514';
  end if;
  if marketplace_private.username_reserved(new.username) then
    raise exception 'That username is reserved.' using errcode = '23514';
  end if;
  -- Serialize current-name claims and release holds in the same transaction.
  -- The unique index remains a second authoritative race backstop.
  perform pg_catalog.pg_advisory_xact_lock(644032001);
  if tg_op = 'UPDATE' then
    select exists (select 1 from marketplace_private.pending_signup_controls s
      join auth.users u on u.id = s.user_id
      where s.user_id = new.id and s.correction_transaction = txid_current()
        and u.email_confirmed_at is null) into pending_correction;
  end if;
  if not pending_correction and tg_op = 'UPDATE' and old.username_changed_at is not null
    and now() < old.username_changed_at + interval '168 hours' then
    raise exception 'You can change your username again on %.',
      old.username_changed_at + interval '168 hours' using errcode = 'P0001',
      detail = (old.username_changed_at + interval '168 hours')::text;
  end if;
  if exists (select 1 from public.profiles p
    where p.username_normalized = lower(new.username) and p.id <> new.id)
    or exists (select 1 from marketplace_private.username_history h
      where h.previous_username_normalized = lower(new.username)
        and (tg_op = 'INSERT' or h.profile_id <> new.id
          or auth.uid() is distinct from new.id)
        and h.released_at > now() - interval '30 days') then
    raise exception 'That username is already taken.' using errcode = '23505';
  end if;
  if not pending_correction and tg_op = 'UPDATE' and old.username is not null then
    insert into marketplace_private.username_history(profile_id, previous_username_normalized)
      values (old.id, lower(old.username));
  end if;
  new.display_name := new.username;
  new.username_changed_at := now();
  return new;
end; $$;

-- Service-only call plus a random capability identifies one pending user.
create function public.marketplace_correct_pending_username(p_ticket text, p_email text, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; own_name text; verified_at timestamptz; own_email text;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{64}$' then
    raise exception 'Pending signup unavailable.' using errcode = '42501';
  end if;
  select s.user_id into actor from marketplace_private.pending_signup_controls s
    where s.ticket_hash = encode(sha256(convert_to(p_ticket, 'UTF8')), 'hex')
      and s.expires_at > now();
  if actor is null then raise exception 'Pending signup unavailable.' using errcode = '42501'; end if;
  select email, email_confirmed_at into own_email, verified_at from auth.users
    where id = actor for update;
  if not found or verified_at is not null or lower(own_email) is distinct from lower(p_email)
    or lower(own_email) !~ '^[^[:space:]@]+@uwo[.]ca$' then
    raise exception 'Pending signup unavailable.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(644032001);
  select username into own_name from public.profiles where id = actor for update;
  if not found then raise exception 'Marketplace profile missing.' using errcode = 'P0001'; end if;
  if own_name is distinct from p_username then
    update marketplace_private.pending_signup_controls set correction_transaction = txid_current() where user_id = actor;
    update public.profiles set username = p_username where id = actor;
    update marketplace_private.pending_signup_controls set correction_transaction = null where user_id = actor;
    update auth.users set raw_user_meta_data = raw_user_meta_data ||
      jsonb_build_object('username', p_username, 'display_name', p_username),
      confirmation_token = '' where id = actor;
    delete from auth.one_time_tokens where user_id = actor and token_type = 'confirmation_token';
  end if;
end; $$;
revoke all on function public.marketplace_correct_pending_username(text,text,text) from public, anon, authenticated;
grant execute on function public.marketplace_correct_pending_username(text,text,text) to service_role;
commit;

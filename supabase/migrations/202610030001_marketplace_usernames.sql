-- Pending: apply after 202609290001_marketplace.sql. No live SQL is applied here.
begin;
create function marketplace_private.username_valid(candidate text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(candidate ~ '^[A-Za-z0-9_]{3,20}$', false);
$$;
create function marketplace_private.username_reserved(candidate text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(candidate) = any(array['admin','administrator','moderator',
    'support','system','staff','official','western','uwo','campusmarketplace',
    'campus_marketplace']), false);
$$;
revoke all on function marketplace_private.username_valid(text),
  marketplace_private.username_reserved(text) from public, anon, authenticated;

alter table public.profiles add column username text
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
alter table public.profiles add column username_normalized text
  generated always as (lower(username)) stored;
alter table public.profiles add column username_changed_at timestamptz;
-- This is the only existing-row UPDATE. Backfill never starts a cooldown.
-- The base profiles_updated trigger also refreshes updated_at on eligible rows.
update public.profiles p set username = p.display_name
where marketplace_private.username_valid(p.display_name)
  and not marketplace_private.username_reserved(p.display_name)
  and not exists (select 1 from public.profiles other
    where other.id <> p.id and lower(other.display_name) = lower(p.display_name));
create unique index profiles_username_normalized_key
  on public.profiles(username_normalized) where username_normalized is not null;

-- No public owner lookup. Retain audit identifiers even after account deletion.
create table marketplace_private.username_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  previous_username_normalized text not null,
  released_at timestamptz not null default now()
);
create index username_history_hold on marketplace_private.username_history
  (previous_username_normalized, released_at);
alter table marketplace_private.username_history enable row level security;
revoke all on marketplace_private.username_history from public, anon, authenticated;
revoke all on sequence marketplace_private.username_history_id_seq from public, anon, authenticated;

-- Central authoritative boundary, including privileged RPC writes.
create function marketplace_private.protect_username_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
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
  if tg_op = 'UPDATE' and old.username_changed_at is not null
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
  if tg_op = 'UPDATE' and old.username is not null then
    insert into marketplace_private.username_history(profile_id, previous_username_normalized)
      values (old.id, lower(old.username));
  end if;
  new.display_name := new.username;
  new.username_changed_at := now();
  return new;
end; $$;
create trigger profiles_username_identity before insert or update on public.profiles
for each row execute function marketplace_private.protect_username_identity();
revoke all on function marketplace_private.protect_username_identity() from public, anon, authenticated;

-- Required for NEW Auth users. Trigger/profile failure rolls back Auth insertion.
create or replace function marketplace_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare chosen text;
begin
  chosen := new.raw_user_meta_data->>'username';
  if chosen is null then
    raise exception 'Username is required.' using errcode = '23514';
  end if;
  insert into public.profiles(id, display_name, username)
    values (new.id, chosen, chosen);
  return new;
end; $$;

create function public.marketplace_username_available(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select marketplace_private.username_valid(candidate)
    and not marketplace_private.username_reserved(candidate)
    and not exists (select 1 from public.profiles where username_normalized = lower(candidate))
    and not exists (select 1 from marketplace_private.username_history
      where previous_username_normalized = lower(candidate)
        and profile_id is distinct from (select auth.uid())
        and released_at > now() - interval '30 days');
$$;
revoke all on function public.marketplace_username_available(text) from public;
grant execute on function public.marketplace_username_available(text) to anon, authenticated;

-- Verification confirms an already-chosen name; it is not a rename shortcut.
create function public.marketplace_confirm_username(candidate text) returns void
language plpgsql security definer set search_path = '' as $$
declare current_name text;
begin
  if not marketplace_private.is_western_user() then
    raise exception 'Verified Western email required.' using errcode = '42501';
  end if;
  if not marketplace_private.username_valid(candidate) then
    raise exception 'Use 3-20 letters, numbers, or underscores.' using errcode = '23514';
  end if;
  if marketplace_private.username_reserved(candidate) then
    raise exception 'That username is reserved.' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(644032001);
  select username into current_name from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Marketplace profile missing.' using errcode = 'P0001'; end if;
  if current_name is not null then
    if lower(current_name) <> lower(candidate) then
      raise exception 'Use the username associated with this verification.' using errcode = '23514';
    end if;
    return;
  end if;
  -- A legacy NULL profile's first deliberate claim starts its cooldown.
  update public.profiles set username = candidate where id = auth.uid();
end; $$;
revoke all on function public.marketplace_confirm_username(text) from public, anon;
grant execute on function public.marketplace_confirm_username(text) to authenticated;

create function public.marketplace_change_username(candidate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare own public.profiles%rowtype;
begin
  if not marketplace_private.is_western_user() then
    raise exception 'Verified Western email required.' using errcode = '42501';
  end if;
  if not marketplace_private.username_valid(candidate) then
    raise exception 'Use 3-20 letters, numbers, or underscores.' using errcode = '23514';
  end if;
  if marketplace_private.username_reserved(candidate) then
    raise exception 'That username is reserved.' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(644032001);
  select * into own from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Marketplace profile missing.' using errcode = 'P0001'; end if;
  -- Exact case-sensitive equality is a no-op, even during cooldown.
  if own.username is distinct from candidate then
    update public.profiles set username = candidate where id = auth.uid() returning * into own;
  end if;
  return jsonb_build_object('username', own.username,
    'next_change_allowed_at', own.username_changed_at + interval '168 hours');
end; $$;
revoke all on function public.marketplace_change_username(text) from public, anon;
grant execute on function public.marketplace_change_username(text) to authenticated;
-- Existing column-level UPDATE(display_name) and owner RLS remain unchanged.
-- No client UPDATE grant is added for username or username_changed_at.
commit;

-- Open registration foundation. Existing UWO-gated marketplace policies remain
-- unchanged until their forward-only policy migration is separately qualified.
begin;

create or replace function public.before_western_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare email text := lower(trim(coalesce(event->'user'->>'email', '')));
begin
  if email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'A valid email address is required.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

-- The historical trigger prevented non-UWO Auth users from existing. Remove
-- only that gate; UWO identity remains separately represented below.
drop trigger if exists marketplace_western_email on auth.users;

create or replace function marketplace_private.is_verified_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and email_confirmed_at is not null
  );
$$;
revoke all on function marketplace_private.is_verified_user() from public, anon;
grant execute on function marketplace_private.is_verified_user() to authenticated, service_role;

create table if not exists marketplace_private.uwo_email_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  uwo_email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_sent_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lower(uwo_email) ~ '^[^[:space:]@]+@uwo[.]ca$')
);
create unique index if not exists uwo_email_verifications_email_unique
  on marketplace_private.uwo_email_verifications (lower(uwo_email));
alter table marketplace_private.uwo_email_verifications enable row level security;
revoke all on marketplace_private.uwo_email_verifications from public, anon, authenticated;

create or replace function marketplace_private.begin_uwo_email_verification(
  p_user_id uuid,
  p_uwo_email text,
  p_code_hash text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_uwo_email is null
     or lower(trim(p_uwo_email)) !~ '^[^[:space:]@]+@uwo[.]ca$'
     or p_code_hash is null or length(p_code_hash) < 32
     or p_expires_at <= now() or p_expires_at > now() + interval '30 minutes'
  then raise exception 'Invalid UWO verification request.' using errcode = '22023'; end if;
  insert into marketplace_private.uwo_email_verifications
    (user_id, uwo_email, code_hash, expires_at, last_sent_at)
  values (p_user_id, lower(trim(p_uwo_email)), p_code_hash, p_expires_at, now())
  on conflict (user_id) do update set
    uwo_email = excluded.uwo_email,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    last_sent_at = excluded.last_sent_at,
    updated_at = now()
  where marketplace_private.uwo_email_verifications.verified_at is null
    and (marketplace_private.uwo_email_verifications.last_sent_at is null
      or marketplace_private.uwo_email_verifications.last_sent_at < now() - interval '60 seconds');
end;
$$;

create or replace function marketplace_private.complete_uwo_email_verification(
  p_user_id uuid,
  p_code_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare matched boolean;
begin
  update marketplace_private.uwo_email_verifications
  set attempts = attempts + 1, updated_at = now()
  where user_id = p_user_id and verified_at is null and attempts < 10
  returning (code_hash = p_code_hash and expires_at > now()) into matched;
  if coalesce(matched, false) then
    update marketplace_private.uwo_email_verifications
    set verified_at = now(), updated_at = now()
    where user_id = p_user_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function marketplace_private.begin_uwo_email_verification(uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function marketplace_private.complete_uwo_email_verification(uuid,text) from public, anon, authenticated;
grant execute on function marketplace_private.begin_uwo_email_verification(uuid,text,text,timestamptz) to service_role;
grant execute on function marketplace_private.complete_uwo_email_verification(uuid,text) to service_role;

create or replace function marketplace_private.is_uwo_email_verified(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from marketplace_private.uwo_email_verifications
    where user_id = p_user_id and verified_at is not null
  );
$$;
revoke all on function marketplace_private.is_uwo_email_verified(uuid) from public, anon;
grant execute on function marketplace_private.is_uwo_email_verified(uuid) to authenticated, service_role;

commit;

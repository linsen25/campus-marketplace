-- B32-only follow-up. NOT DEPLOYED by this change. This migration preserves
-- the legacy badge RPC signature for existing callers, but makes its result a
-- read of the explicitly public, derived profile flag rather than of a private
-- verification record. It must not be replayed against another environment
-- without reviewing that environment's catalog baseline.
begin;

do $baseline$
declare
  badge_signature regprocedure := 'public.marketplace_uwo_identity_badge(uuid)'::regprocedure;
  badge_definition text;
  policy_definition text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('marketplace_private.uwo_email_verifications') is null
     or not exists (
       select 1 from pg_catalog.pg_proc p
        where p.oid = 'marketplace_private.is_uwo_email_verified(uuid)'::regprocedure
     ) then
    raise exception 'B32 UWO badge baseline objects are absent.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.profiles'::regclass
       and a.attname = 'uwo_email_verified' and not a.attisdropped
  ) then
    raise exception 'B32 UWO badge projection already exists; refusing a replay.' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'marketplace_private'
       and p.proname in ('sync_public_uwo_badge', 'guard_public_uwo_badge')
  ) or exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid in (
       'public.profiles'::regclass,
       'marketplace_private.uwo_email_verifications'::regclass
     )
       and t.tgname in (
         'profiles_public_uwo_badge_guard',
         'uwo_verifications_public_badge_sync'
       )
       and not t.tgisinternal
  ) then
    raise exception 'B32 UWO badge trigger baseline drifted; refusing to replace an existing projection.'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = badge_signature and p.prosecdef
  ) then
    raise exception 'B32 legacy badge RPC security baseline drifted.' using errcode = 'P0001';
  end if;
  select pg_catalog.pg_get_functiondef(badge_signature::oid) into badge_definition;
  if badge_definition not like '%marketplace_private.is_uwo_email_verified(p_user_id)%'
     or badge_definition not like '%SET search_path TO ''''%' then
    raise exception 'B32 legacy badge RPC baseline drifted.' using errcode = 'P0001';
  end if;
  select pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) into policy_definition
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'public.messages'::regclass
     and pol.polname = 'messages_participant_read'
     and pol.polcmd = 'r';
  if policy_definition is null
     or policy_definition not like '%conversations%'
     or policy_definition not like '%buyer_id%'
     or policy_definition not like '%seller_id%'
     or policy_definition like '%is_verified_user%' then
    raise exception 'B32 message participant-read policy baseline drifted.' using errcode = 'P0001';
  end if;
end;
$baseline$;

alter table public.profiles
  add column uwo_email_verified boolean not null default false;

-- Existing rows are derived once from the private verification ledger. No
-- identity email is copied into a public table.
update public.profiles p
   set uwo_email_verified = exists (
     select 1
       from marketplace_private.uwo_email_verifications v
      where v.user_id = p.id and v.verified_at is not null
   );

create function marketplace_private.sync_public_uwo_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.verified_at is distinct from old.verified_at then
    update public.profiles
       set uwo_email_verified = new.verified_at is not null
     where id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function marketplace_private.sync_public_uwo_badge()
  from public, anon, authenticated, service_role;

create function marketplace_private.guard_public_uwo_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.uwo_email_verified is distinct from old.uwo_email_verified
     and new.uwo_email_verified is distinct from marketplace_private.is_uwo_email_verified(new.id) then
    raise exception 'UWO badge is derived from verified identity.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function marketplace_private.guard_public_uwo_badge()
  from public, anon, authenticated, service_role;

create trigger profiles_public_uwo_badge_guard
before update of uwo_email_verified on public.profiles
for each row execute function marketplace_private.guard_public_uwo_badge();

create trigger uwo_verifications_public_badge_sync
after insert or update of verified_at on marketplace_private.uwo_email_verifications
for each row execute function marketplace_private.sync_public_uwo_badge();

do $badge$
declare
  signature regprocedure := 'public.marketplace_uwo_identity_badge(uuid)'::regprocedure;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
  definition text;
begin
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into before_owner, before_security_definer, before_config, before_acl
    from pg_catalog.pg_proc p where p.oid = signature;
  execute $sql$
    create or replace function public.marketplace_uwo_identity_badge(p_user_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $function$
      select coalesce((
        select p.uwo_email_verified
          from public.profiles p
         where p.id = p_user_id
      ), false);
    $function$;
  $sql$;
  select pg_catalog.pg_get_functiondef(signature::oid) into definition;
  if definition like '%marketplace_private.is_uwo_email_verified%'
     or definition not like '%uwo_email_verified%' then
    raise exception 'B32 badge RPC was not converted to the public projection.' using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into after_owner, after_security_definer, after_config, after_acl
    from pg_catalog.pg_proc p where p.oid = signature;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'B32 badge RPC metadata changed unexpectedly.' using errcode = 'P0001';
  end if;
end;
$badge$;

drop policy messages_participant_read on public.messages;
create policy messages_participant_read on public.messages
for select to authenticated
using (
  (select marketplace_private.is_verified_user())
  and exists (
    select 1
      from public.conversations c
     where c.id = conversation_id
       and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
  )
);

commit;

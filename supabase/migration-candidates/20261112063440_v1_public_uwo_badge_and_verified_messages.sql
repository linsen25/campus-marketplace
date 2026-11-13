-- V1 integration: expose only a derived public UWO badge and replace the
-- final Conversations/Messages verified-login predicates. The UWO address and
-- verification record remain private; transaction, Shop and payment guards
-- are not widened here.
begin;

alter table public.profiles
  add column if not exists uwo_email_verified boolean not null default false;

-- Backfill only the public boolean from already-private, completed records.
update public.profiles p
   set uwo_email_verified = exists (
     select 1
       from marketplace_private.uwo_email_verifications v
      where v.user_id = p.id
        and v.verified_at is not null
   );

create or replace function marketplace_private.sync_public_uwo_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified_at is distinct from old.verified_at then
    update public.profiles
       set uwo_email_verified = new.verified_at is not null
     where id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function marketplace_private.sync_public_uwo_badge()
  from public, anon, authenticated, service_role;

create or replace function marketplace_private.guard_public_uwo_badge()
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

drop trigger if exists profiles_public_uwo_badge_guard on public.profiles;
create trigger profiles_public_uwo_badge_guard
before update of uwo_email_verified on public.profiles
for each row execute function marketplace_private.guard_public_uwo_badge();

drop trigger if exists uwo_verifications_public_badge_sync
  on marketplace_private.uwo_email_verifications;
create trigger uwo_verifications_public_badge_sync
after update of verified_at on marketplace_private.uwo_email_verifications
for each row execute function marketplace_private.sync_public_uwo_badge();

do $migration$
declare
  item record;
  definition text;
  occurrences integer;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  for item in
    select v.signature
      from (values
        ('marketplace_private.protect_conversation_identity()'),
        ('marketplace_private.prepare_text_message()'),
        ('public.marketplace_find_or_create_conversation(uuid)'),
        ('public.marketplace_send_text(uuid,uuid,text)'),
        ('public.marketplace_mark_conversation_read(uuid,bigint)')
      ) v(signature)
  loop
    select p.proowner, p.prosecdef, p.proconfig, p.proacl
      into before_owner, before_security_definer, before_config, before_acl
      from pg_catalog.pg_proc p
     where p.oid = item.signature::regprocedure::oid;
    if not found then
      raise exception 'Conversation function % is absent from the reviewed baseline.', item.signature
        using errcode = 'P0001';
    end if;
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid);
    occurrences := (length(definition) - length(replace(
      definition, 'marketplace_private.is_western_user()', ''
    ))) / length('marketplace_private.is_western_user()');
    if occurrences <> 1
       or definition like '%marketplace_private.is_verified_user()%' then
      raise exception 'Conversation function % identity baseline drifted.', item.signature
        using errcode = 'P0001';
    end if;
    execute replace(
      definition,
      'marketplace_private.is_western_user()',
      'marketplace_private.is_verified_user()'
    );
    select p.proowner, p.prosecdef, p.proconfig, p.proacl
      into after_owner, after_security_definer, after_config, after_acl
      from pg_catalog.pg_proc p
     where p.oid = item.signature::regprocedure::oid;
    if after_owner is distinct from before_owner
       or after_security_definer is distinct from before_security_definer
       or after_config is distinct from before_config
       or after_acl is distinct from before_acl then
      raise exception 'Conversation function % metadata changed unexpectedly.', item.signature
        using errcode = 'P0001';
    end if;
  end loop;
end;
$migration$;

drop policy if exists conversations_participant_read on public.conversations;
create policy conversations_participant_read on public.conversations
for select to authenticated
using (
  (select marketplace_private.is_verified_user())
  and (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()))
);

drop policy if exists messages_participant_read on public.messages;
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

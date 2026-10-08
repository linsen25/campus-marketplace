-- Phase 3A AUTHORING ONLY: NOT APPLIED OR EXECUTED.
-- Apply only after hosted staging capability/privacy review and separate approval.
-- Private Broadcast invalidations; deliberately no Postgres Changes publication.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or pg_catalog.to_regprocedure('realtime.topic()') is null
    or not exists (select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'realtime' and c.relname = 'messages' and c.relrowsecurity)
    or not pg_catalog.has_table_privilege('authenticated', 'realtime.messages', 'SELECT') then
    raise exception 'Review hosted private Broadcast capabilities and grants before applying.';
  end if;
  -- Do not silently remove existing publication members or alter shared publish flags.
  -- Publishing these rows would retain the Postgres Changes DELETE/RLS limitation.
  if exists (select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('conversations','messages','message_images','image_message_submissions')) then
    raise exception 'Review unexpected messaging publication membership before applying.';
  end if;
end; $$;

-- Only this user's private topic. The fence also defeats unrelated broad permissive
-- policies; outside this reserved namespace existing platform policies are unchanged.
drop policy if exists marketplace_messages_realtime_receive on realtime.messages;
create policy marketplace_messages_realtime_receive on realtime.messages
for select to authenticated using (
  extension = 'broadcast'
  and topic = 'marketplace:messages:' || (select auth.uid())::text
  and topic = (select realtime.topic())
  and coalesce((select marketplace_private.is_western_user()), false)
);
drop policy if exists marketplace_messages_realtime_read_fence on realtime.messages;
create policy marketplace_messages_realtime_read_fence on realtime.messages
as restrictive for select to public using (
  case when topic like 'marketplace:messages:%' then
    case when (select auth.role()) = 'authenticated' then
      extension = 'broadcast'
      and topic = 'marketplace:messages:' || (select auth.uid())::text
      and topic = (select realtime.topic())
      and coalesce((select marketplace_private.is_western_user()), false)
    else false end
  else true end
);
-- Browsers cannot forge, move or remove notifications even if another policy grants writes.
drop policy if exists marketplace_messages_realtime_insert_fence on realtime.messages;
create policy marketplace_messages_realtime_insert_fence on realtime.messages
as restrictive for insert to public with check (coalesce(topic, '') not like 'marketplace:messages:%');
drop policy if exists marketplace_messages_realtime_update_fence on realtime.messages;
create policy marketplace_messages_realtime_update_fence on realtime.messages
as restrictive for update to public using (coalesce(topic, '') not like 'marketplace:messages:%')
with check (coalesce(topic, '') not like 'marketplace:messages:%');
drop policy if exists marketplace_messages_realtime_delete_fence on realtime.messages;
create policy marketplace_messages_realtime_delete_fence on realtime.messages
as restrictive for delete to public using (coalesce(topic, '') not like 'marketplace:messages:%');

create or replace function marketplace_private.notify_message_realtime() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record;
begin
  -- Derive recipients from current durable membership, not a client-supplied topic.
  -- Recheck current verified eligibility at emission as channel authorization is cached.
  for recipient in
    select members.id, members.role from public.conversations c
    cross join lateral (values (c.buyer_id, 'buying'), (c.seller_id, 'selling')) members(id,role)
    join auth.users u on u.id = members.id
    where c.id = new.conversation_id and u.email_confirmed_at is not null
      and pg_catalog.lower(u.email) ~ '^[^[:space:]@]+@uwo[.]ca$'
  loop
    perform realtime.send(pg_catalog.jsonb_build_object(
      'conversationId', new.conversation_id, 'role', recipient.role, 'scope', 'history'),
      'messages_changed', 'marketplace:messages:' || recipient.id::text, true);
  end loop;
  return new;
exception when others then
  -- Optional notification failure must never roll back a durable TEXT/IMAGE send.
  -- No provider detail, IDs, contents or credentials in this diagnostic.
  raise log 'Messages Realtime notification skipped; SQLSTATE=%', sqlstate;
  return new;
end; $$;

create or replace function marketplace_private.notify_conversation_realtime() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; shared_change boolean := true;
begin
  if tg_op = 'UPDATE' then
    shared_change := row(new.last_message_sequence,new.last_message_at,new.listing_id,new.buyer_id,new.seller_id)
      is distinct from row(old.last_message_sequence,old.last_message_at,old.listing_id,old.buyer_id,old.seller_id);
  end if;
  for recipient in
    select members.id, members.role from
      (values (new.buyer_id, 'buying'), (new.seller_id, 'selling')) members(id,role)
    join auth.users u on u.id = members.id
    where u.email_confirmed_at is not null
      and pg_catalog.lower(u.email) ~ '^[^[:space:]@]+@uwo[.]ca$'
  loop
    -- A read-only update invalidates only the reader's list, not a seen indicator.
    if not shared_change then
      if recipient.role = 'buying' and new.buyer_last_read_sequence = old.buyer_last_read_sequence then continue; end if;
      if recipient.role = 'selling' and new.seller_last_read_sequence = old.seller_last_read_sequence then continue; end if;
    end if;
    perform realtime.send(pg_catalog.jsonb_build_object(
      'conversationId', new.id, 'role', recipient.role, 'scope', 'list'),
      'messages_changed', 'marketplace:messages:' || recipient.id::text, true);
  end loop;
  return new;
exception when others then
  raise log 'Messages Realtime notification skipped; SQLSTATE=%', sqlstate;
  return new;
end; $$;

revoke all on function marketplace_private.notify_message_realtime(),
  marketplace_private.notify_conversation_realtime() from public, anon, authenticated, service_role;
-- Only the new named objects are replaced on a deliberate retry; Phase 1/2 guards stay.
drop trigger if exists messages_realtime_signal on public.messages;
create trigger messages_realtime_signal after insert on public.messages
for each row execute function marketplace_private.notify_message_realtime();
drop trigger if exists conversations_realtime_signal on public.conversations;
create trigger conversations_realtime_signal after insert or update on public.conversations
for each row execute function marketplace_private.notify_conversation_realtime();
commit;

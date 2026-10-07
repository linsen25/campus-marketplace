-- REVIEW BEFORE APPLY: authored for Phase 1A; NOT APPLIED or executed.
-- Apply only after 202610050001_marketplace_publication_favorites.sql is reviewed/applied.
-- TEXT only: no API integration, image table/bucket/policies or Realtime configuration.
begin;

create function marketplace_private.trim_message_text(value text) returns text
language sql immutable strict set search_path = '' as $$
  select pg_catalog.regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- Immutable original identity survives deletion; this UUID is deliberately not a FK.
  listing_origin_id uuid not null,
  listing_id uuid references public.listings(id) on delete set null,
  -- NULL is only a historical deletion outcome, never allowed for new conversations.
  -- Existing listings.seller_id still requires deliberate cleanup before account deletion.
  buyer_id uuid references public.profiles(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  listing_title_snapshot text not null check (length(listing_title_snapshot) between 1 and 120),
  listing_price_cents_snapshot bigint not null
    check (listing_price_cents_snapshot between 0 and 9007199254740991),
  listing_currency_snapshot text not null check (listing_currency_snapshot = 'CAD'),
  -- Historical text, not a live taxonomy FK/check that future renaming can invalidate.
  listing_category_snapshot text not null check (length(btrim(listing_category_snapshot)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_sequence bigint not null default 0
    check (last_message_sequence between 0 and 9007199254740991),
  buyer_last_read_sequence bigint not null default 0,
  seller_last_read_sequence bigint not null default 0,
  activity_at timestamptz generated always as (coalesce(last_message_at, created_at)) stored,
  constraint conversations_identity unique (listing_origin_id, buyer_id, seller_id),
  constraint conversations_distinct_participants
    check (buyer_id is null or seller_id is null or buyer_id <> seller_id),
  check (buyer_last_read_sequence between 0 and last_message_sequence),
  check (seller_last_read_sequence between 0 and last_message_sequence),
  check ((last_message_sequence = 0) = (last_message_at is null))
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- Only deliberate administrative conversation removal may cascade, not listing deletion.
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Historical Auth UUID, checked against participants on insert. No Auth FK cascade.
  sender_id uuid not null,
  client_message_id uuid not null,
  type text not null default 'TEXT' check (type in ('TEXT', 'IMAGE')),
  -- Reserve the discriminator only; Phase 2 must deliberately replace this restriction.
  constraint messages_text_phase_only check (type = 'TEXT'),
  content text not null,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  constraint messages_text_content check (
    char_length(content) between 1 and 2000
    and content = marketplace_private.trim_message_text(content)
  ),
  constraint messages_sequence unique (conversation_id, sequence),
  constraint messages_client_idempotency unique (conversation_id, sender_id, client_message_id)
);

-- Each destination lists its own conversations, newest activity first, stable UUID tie.
create index conversations_buyer_activity on public.conversations (buyer_id, activity_at desc, id asc);
create index conversations_seller_activity on public.conversations (seller_id, activity_at desc, id asc);
-- Live FK deletion/SET NULL; the identity index already covers original-listing lookup.
create index conversations_live_listing on public.conversations (listing_id);
-- Latest preview and deterministic timestamp/UUID history cursor; no duplicate preview string.
create index messages_history on public.messages (conversation_id, created_at desc, id desc);
-- messages_sequence already supports history/read validation and unread sequence ranges.
-- Unread must COUNT rows after the viewer watermark AND sender_id <> auth.uid(),
-- not subtract last_message_sequence - last_read_sequence (own messages are excluded).

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations, public.messages from public, anon, authenticated;
grant select on public.conversations, public.messages to authenticated;
-- No direct INSERT/UPDATE/DELETE grants or user write policies: all writes use guarded RPCs.
create policy conversations_participant_read on public.conversations for select to authenticated
using ((select marketplace_private.is_western_user()) and
  (buyer_id = (select auth.uid()) or seller_id = (select auth.uid())));
create policy messages_participant_read on public.messages for select to authenticated
using (exists (select 1 from public.conversations c where c.id = conversation_id
  and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))));

create function marketplace_private.protect_conversation_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source public.listings;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or not coalesce(marketplace_private.is_western_user(), false)
      or new.buyer_id is distinct from auth.uid() or new.seller_id is null
      or new.listing_id is null or new.listing_origin_id is distinct from new.listing_id then
      raise exception 'Verified buyer and real listing participants required.' using errcode = '42501';
    end if;
    select * into source from public.listings l where l.id = new.listing_id for share;
    if not found or source.published_at is null or source.status <> 'available'
      or source.seller_id is distinct from new.seller_id or new.buyer_id = new.seller_id then
      raise exception 'Only another seller''s published available listing can start a conversation.' using errcode = '23514';
    end if;
    -- Derive the snapshot even if a privileged caller mistakenly supplies different values.
    new.listing_title_snapshot := source.title;
    new.listing_price_cents_snapshot := source.price_cents;
    new.listing_currency_snapshot := source.currency;
    new.listing_category_snapshot := source.category;
    new.created_at := clock_timestamp();
    new.updated_at := now();
    new.last_message_at := null;
    new.last_message_sequence := 0;
    new.buyer_last_read_sequence := 0;
    new.seller_last_read_sequence := 0;
    return new;
  end if;
  if row(new.id,new.listing_origin_id,new.created_at,new.listing_title_snapshot,
      new.listing_price_cents_snapshot,new.listing_currency_snapshot,new.listing_category_snapshot)
    is distinct from row(old.id,old.listing_origin_id,old.created_at,old.listing_title_snapshot,
      old.listing_price_cents_snapshot,old.listing_currency_snapshot,old.listing_category_snapshot) then
    raise exception 'Conversation identity and listing snapshot are immutable.' using errcode = '23514';
  end if;
  -- Permit FK SET NULL only once the referenced parent no longer exists in this transaction.
  if new.listing_id is distinct from old.listing_id and not
    (new.listing_id is null and not exists (select 1 from public.listings l where l.id = old.listing_id)) then
    raise exception 'The live listing reference cannot be reassigned.' using errcode = '23514';
  end if;
  if new.buyer_id is distinct from old.buyer_id and not
    (new.buyer_id is null and not exists (select 1 from public.profiles p where p.id = old.buyer_id)) then
    raise exception 'The buyer cannot be reassigned.' using errcode = '23514';
  end if;
  if new.seller_id is distinct from old.seller_id and not
    (new.seller_id is null and not exists (select 1 from public.profiles p where p.id = old.seller_id)) then
    raise exception 'The seller cannot be reassigned.' using errcode = '23514';
  end if;
  if new.buyer_last_read_sequence < old.buyer_last_read_sequence
    or new.seller_last_read_sequence < old.seller_last_read_sequence then
    raise exception 'Read watermarks cannot move backwards.' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger conversations_identity_guard before insert or update on public.conversations
for each row execute function marketplace_private.protect_conversation_identity();
-- Reuse the established timestamp convention; read changes do not change message activity.
create trigger conversations_updated before update on public.conversations
for each row execute function marketplace_private.touch_updated_at();

create function marketplace_private.prepare_text_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.conversations; actor uuid := auth.uid();
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(), false)
    or new.sender_id is distinct from actor then
    raise exception 'Verified sender required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = new.conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not found or not accessible.' using errcode = '42501';
  end if;
  new.content := marketplace_private.trim_message_text(new.content);
  if new.type is distinct from 'TEXT' or new.content is null or char_length(new.content) not between 1 and 2000 then
    raise exception 'Send 1-2000 characters of nonblank TEXT.' using errcode = '23514';
  end if;
  -- Holding this parent lock through commit serializes sends within this conversation.
  -- Caller-supplied sequence/time cannot override the durable database assignment.
  new.sequence := target.last_message_sequence + 1;
  new.created_at := greatest(clock_timestamp(), target.created_at,
    target.last_message_at + interval '1 microsecond');
  return new;
end; $$;
create trigger messages_prepare_text before insert on public.messages
for each row execute function marketplace_private.prepare_text_message();

create function marketplace_private.apply_text_message_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Approved Phase 1A: a send from inside Chat acknowledges prior messages too.
  -- Own unread is also excluded by sender_id, never maintained as a manual integer.
  update public.conversations c set last_message_sequence = new.sequence,
    last_message_at = new.created_at,
    buyer_last_read_sequence = case when c.buyer_id = new.sender_id
      then greatest(c.buyer_last_read_sequence, new.sequence) else c.buyer_last_read_sequence end,
    seller_last_read_sequence = case when c.seller_id = new.sender_id
      then greatest(c.seller_last_read_sequence, new.sequence) else c.seller_last_read_sequence end
  where c.id = new.conversation_id;
  return new;
end; $$;
create trigger messages_apply_activity after insert on public.messages
for each row execute function marketplace_private.apply_text_message_activity();

create function marketplace_private.protect_sent_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Administrative parent removal can cascade once that conversation has gone.
  if tg_op = 'DELETE' and not exists
    (select 1 from public.conversations c where c.id = old.conversation_id) then return old; end if;
  raise exception 'Sent messages are immutable.' using errcode = '23514';
end; $$;
create trigger messages_immutable before update or delete on public.messages
for each row execute function marketplace_private.protect_sent_message();

create function public.marketplace_find_or_create_conversation(p_listing_id uuid)
returns public.conversations language plpgsql security definer set search_path = '' as $$
declare source public.listings; target public.conversations; actor uuid := auth.uid();
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  -- Marketplace entry checks eligibility even for a prior conversation; historical
  -- access/send uses conversation ID directly and never depends on live listing status.
  select * into source from public.listings l where l.id = p_listing_id for share;
  if not found or source.published_at is null or source.status <> 'available' then
    raise exception 'A published available listing is required.' using errcode = '23514';
  end if;
  if source.seller_id = actor then
    raise exception 'You cannot start a conversation with yourself.' using errcode = '23514';
  end if;
  insert into public.conversations (listing_origin_id,listing_id,buyer_id,seller_id,
    listing_title_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot)
  values (source.id,source.id,actor,source.seller_id,source.title,source.price_cents,source.currency,source.category)
  on conflict on constraint conversations_identity do nothing returning * into target;
  if not found then
    select * into target from public.conversations c where c.listing_origin_id = source.id
      and c.buyer_id = actor and c.seller_id = source.seller_id;
    if not found then
      raise exception 'Retry conversation creation after concurrent change.' using errcode = '40001';
    end if;
  end if;
  return target;
end; $$;

create function public.marketplace_send_text(p_conversation_id uuid, p_client_message_id uuid, p_content text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare target public.conversations; result public.messages; actor uuid := auth.uid(); clean text;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = p_conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not found or not accessible.' using errcode = '42501';
  end if;
  clean := marketplace_private.trim_message_text(p_content);
  if p_client_message_id is null or clean is null or char_length(clean) not between 1 and 2000 then
    raise exception 'A client message UUID and 1-2000 characters of nonblank TEXT are required.' using errcode = '23514';
  end if;
  select * into result from public.messages m where m.conversation_id = target.id
    and m.sender_id = actor and m.client_message_id = p_client_message_id;
  if found then
    if result.type <> 'TEXT' or result.content is distinct from clean then
      raise exception 'This client message UUID was used for different content.' using errcode = '23505';
    end if;
    -- Retry neither consumes a sequence nor re-acknowledges newer incoming messages.
    return result;
  end if;
  -- Triggers allocate sequence/time and update activity/read state in this transaction.
  -- No listing join: sold/deleted listings do not block existing conversation sends.
  insert into public.messages (conversation_id,sender_id,client_message_id,type,content)
    values (target.id,actor,p_client_message_id,'TEXT',clean) returning * into result;
  return result;
end; $$;

create function public.marketplace_mark_conversation_read(p_conversation_id uuid, p_through_sequence bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.conversations; actor uuid := auth.uid(); watermark bigint; unread bigint;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = p_conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not found or not accessible.' using errcode = '42501';
  end if;
  -- Explicit rendered boundary avoids marking a message arriving after history fetch read.
  if p_through_sequence is null or p_through_sequence < 0
    or p_through_sequence > target.last_message_sequence
    or (p_through_sequence > 0 and not exists (select 1 from public.messages m
      where m.conversation_id = target.id and m.sequence = p_through_sequence)) then
    raise exception 'Read through a valid message sequence in this conversation.' using errcode = '23514';
  end if;
  if target.buyer_id = actor then
    watermark := greatest(target.buyer_last_read_sequence, p_through_sequence);
    if watermark > target.buyer_last_read_sequence then
      update public.conversations set buyer_last_read_sequence = watermark where id = target.id;
    end if;
  else
    watermark := greatest(target.seller_last_read_sequence, p_through_sequence);
    if watermark > target.seller_last_read_sequence then
      update public.conversations set seller_last_read_sequence = watermark where id = target.id;
    end if;
  end if;
  select count(*) into unread from public.messages m where m.conversation_id = target.id
    and m.sequence > watermark and m.sender_id <> actor;
  return jsonb_build_object('conversation_id',target.id,'last_read_sequence',watermark,'unread_count',unread);
end; $$;

revoke all on function marketplace_private.trim_message_text(text),
  marketplace_private.protect_conversation_identity(), marketplace_private.prepare_text_message(),
  marketplace_private.apply_text_message_activity(), marketplace_private.protect_sent_message()
  from public, anon, authenticated;
revoke all on function public.marketplace_find_or_create_conversation(uuid),
  public.marketplace_send_text(uuid,uuid,text), public.marketplace_mark_conversation_read(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.marketplace_find_or_create_conversation(uuid),
  public.marketplace_send_text(uuid,uuid,text), public.marketplace_mark_conversation_read(uuid,bigint)
  to authenticated;
commit;

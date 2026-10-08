-- Phase 2A: AUTHORED ONLY. NOT APPLIED or executed. Review/verify on hosted staging first.
-- Additive to 202610070001; no Realtime, frontend upload integration or listing bucket changes.
begin;

-- Matches the Storage columns in the existing local production backup. Fail closed
-- if a bucket already exists; never silently convert a public bucket containing data.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-images','chat-images',false,3145728,array['image/jpeg','image/png','image/webp']);

-- Pending uploads are NOT messages: no sequence, activity, unread or recipient visibility.
-- Historical sender UUID intentionally has no Auth/profile FK cascade.
create table public.image_message_submissions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null,
  client_message_id uuid not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'
    and jsonb_array_length(manifest) between 1 and 4),
  -- Server-only verified byte/signature/hash receipts, keyed by image UUID -> Storage object UUID.
  verified_objects jsonb not null default '{}'::jsonb check (jsonb_typeof(verified_objects) = 'object'),
  state text not null default 'pending' check (state in ('pending','finalized','abandoned')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  unique (conversation_id,sender_id,client_message_id)
);
create index image_submissions_expiry on public.image_message_submissions(expires_at,id)
where state = 'pending';

alter table public.messages alter column content drop not null;
alter table public.messages add column image_count smallint;
alter table public.messages drop constraint messages_text_phase_only;
alter table public.messages drop constraint messages_text_content;
alter table public.messages add constraint messages_payload check (
  (type = 'TEXT' and content is not null and image_count is null
    and char_length(content) between 1 and 2000
    and content = marketplace_private.trim_message_text(content))
  or (type = 'IMAGE' and content is null and image_count is not null and image_count between 1 and 4)
);

create table public.message_images (
  id uuid primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  storage_path text not null unique check (storage_path ~
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  original_name text not null check (char_length(original_name) between 1 and 255
    and original_name !~ '[[:cntrl:]]'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  -- Binds exact retry payloads to actual bytes; not an image deduplication system.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (message_id,position)
);

-- Passive operator worklist, not a worker/cron job. No FK: cleanup survives parent removal.
create table marketplace_private.chat_image_cleanup (
  storage_path text primary key,
  queued_at timestamptz not null default clock_timestamp()
);
alter table public.image_message_submissions enable row level security;
alter table public.message_images enable row level security;
alter table marketplace_private.chat_image_cleanup enable row level security;
revoke all on public.image_message_submissions, public.message_images,
  marketplace_private.chat_image_cleanup from public, anon, authenticated;
grant select on public.image_message_submissions, public.message_images to authenticated;
grant usage on schema marketplace_private to service_role;
grant select on marketplace_private.chat_image_cleanup to service_role;
create policy image_submissions_author_read on public.image_message_submissions
for select to authenticated using (sender_id = (select auth.uid()) and exists
  (select 1 from public.conversations c where c.id = conversation_id));
create policy message_images_participant_read on public.message_images
for select to authenticated using (exists
  (select 1 from public.messages m where m.id = message_id));

create function marketplace_private.guard_image_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item jsonb; slot bigint;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.conversations c where c.id = old.conversation_id) then
      return old;
    end if;
    raise exception 'Keep submission tombstones for retry and cleanup.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.sender_id is distinct from auth.uid() or auth.uid() is null
      or not coalesce(marketplace_private.is_western_user(),false)
      or not exists (select 1 from public.conversations c where c.id = new.conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid()))
      or new.state <> 'pending' or new.verified_objects <> '{}'::jsonb then
      raise exception 'Verified participant reservation required.' using errcode = '42501';
    end if;
    for item,slot in select value,ordinality from jsonb_array_elements(new.manifest) with ordinality loop
      if jsonb_typeof(item) is distinct from 'object'
        or item->>'position' is distinct from slot::text
        or coalesce(item->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or item->>'storage_path' is distinct from
          new.conversation_id::text || '/' || new.id::text || '/' || (item->>'id')
        or coalesce(item->>'mime_type','') not in ('image/jpeg','image/png','image/webp')
        or jsonb_typeof(item->'mime_type') is distinct from 'string'
        or coalesce(item->>'size_bytes','') !~ '^[0-9]{1,7}$'
        or jsonb_typeof(item->'size_bytes') is distinct from 'number'
        or coalesce(item->>'sha256','') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(item->'sha256') is distinct from 'string'
        or jsonb_typeof(item->'original_name') is distinct from 'string'
        or coalesce(char_length(item->>'original_name'),0) not between 1 and 255
        or item->>'original_name' ~ '[[:cntrl:]]' then
        raise exception 'Invalid canonical image manifest.' using errcode = '23514';
      end if;
      if (item->>'size_bytes')::integer not between 1 and 3145728 then
        raise exception 'Image size outside 1-3145728 bytes.' using errcode = '23514';
      end if;
    end loop;
    new.created_at := clock_timestamp();
    new.expires_at := new.created_at + interval '24 hours';
    return new;
  end if;
  if row(new.id,new.conversation_id,new.sender_id,new.client_message_id,new.manifest,new.created_at,new.expires_at)
    is distinct from row(old.id,old.conversation_id,old.sender_id,old.client_message_id,old.manifest,old.created_at,old.expires_at)
    or old.state <> 'pending' then
    raise exception 'Submission identity and terminal state are immutable.' using errcode = '23514';
  end if;
  if new.verified_objects is distinct from old.verified_objects and
    (auth.role() is distinct from 'service_role' or new.state <> 'pending'
      or not new.verified_objects @> old.verified_objects) then
    raise exception 'Only trusted server verification may append receipts.' using errcode = '42501';
  end if;
  if new.state = 'finalized' and not exists (select 1 from public.messages m
    where m.id = new.id and m.type = 'IMAGE' and m.conversation_id = new.conversation_id
      and m.sender_id = new.sender_id and m.client_message_id = new.client_message_id) then
    raise exception 'Finalize the durable message atomically.' using errcode = '23514';
  end if;
  if new.state = 'abandoned' then
    insert into marketplace_private.chat_image_cleanup(storage_path)
    select value->>'storage_path' from jsonb_array_elements(new.manifest)
    on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger image_submission_guard before insert or update or delete on public.image_message_submissions
for each row execute function marketplace_private.guard_image_submission();

-- Participant identity is rechecked at every operation, independent of live listing state.
create function marketplace_private.lock_image_submission(p_id uuid)
returns public.image_message_submissions language plpgsql security definer set search_path = '' as $$
declare submission public.image_message_submissions; target public.conversations; actor uuid := auth.uid();
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into submission from public.image_message_submissions s where s.id = p_id;
  if not found or submission.sender_id <> actor then
    raise exception 'Submission not accessible.' using errcode = '42501';
  end if;
  -- Same lock order as TEXT: conversation, then submission, then objects.
  select * into target from public.conversations c where c.id = submission.conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not accessible.' using errcode = '42501';
  end if;
  select * into submission from public.image_message_submissions s where s.id = p_id for update;
  if not found then raise exception 'Submission not accessible.' using errcode = '42501'; end if;
  return submission;
end; $$;

create function public.marketplace_prepare_image_message(p_conversation_id uuid,p_client_message_id uuid,p_images jsonb)
returns public.image_message_submissions language plpgsql security definer set search_path = '' as $$
declare target public.conversations; submission public.image_message_submissions;
  actor uuid := auth.uid(); submission_id uuid := gen_random_uuid(); image_id uuid;
  item jsonb; normalized jsonb := '[]'::jsonb; canonical jsonb := '[]'::jsonb; old_input jsonb; slot bigint;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = p_conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not accessible.' using errcode = '42501';
  end if;
  if p_client_message_id is null or p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Submission UUID and ordered image descriptors required.' using errcode = '23514';
  end if;
  if jsonb_array_length(p_images) not between 1 and 4 then
    raise exception 'Choose 1-4 images.' using errcode = '23514';
  end if;
  for item,slot in select value,ordinality from jsonb_array_elements(p_images) with ordinality loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Image descriptor must be an object.' using errcode = '23514';
    end if;
    if (select count(*) from jsonb_object_keys(item)) <> 4
      or not item ?& array['original_name','mime_type','size_bytes','sha256'] then
      raise exception 'Only filename, MIME, size and SHA256 are accepted.' using errcode = '23514';
    end if;
    normalized := normalized || jsonb_build_array(item);
    image_id := gen_random_uuid();
    canonical := canonical || jsonb_build_array(item || jsonb_build_object(
      'id',image_id,'position',slot,'storage_path',target.id::text || '/' || submission_id::text || '/' || image_id::text));
  end loop;
  select * into submission from public.image_message_submissions s where s.conversation_id = target.id
    and s.sender_id = actor and s.client_message_id = p_client_message_id for update;
  if found then
    select jsonb_agg(value - 'id' - 'position' - 'storage_path' order by ordinality)
      into old_input from jsonb_array_elements(submission.manifest) with ordinality;
    if old_input is distinct from normalized then
      raise exception 'Submission UUID already used for a different image manifest.' using errcode = '23505';
    end if;
    -- Do not renew expiry or reopen abandoned drafts. Return state for reconciliation.
    return submission;
  end if;
  if exists (select 1 from public.messages m where m.conversation_id = target.id
    and m.sender_id = actor and m.client_message_id = p_client_message_id) then
    raise exception 'Submission UUID already used by a sent message.' using errcode = '23505';
  end if;
  insert into public.image_message_submissions(id,conversation_id,sender_id,client_message_id,manifest)
    values (submission_id,target.id,actor,p_client_message_id,canonical) returning * into submission;
  return submission;
end; $$;

-- Browser/user Storage access is intentionally denied for this bucket. All byte
-- operations use the server-only Storage client after normal user/RLS authorization.
-- This also prevents clients minting two-hour signed upload tokens with upsert=true.
create policy chat_images_no_client_read on storage.objects as restrictive for select to public
using (bucket_id <> 'chat-images');
create policy chat_images_no_client_insert on storage.objects as restrictive for insert to public
with check (bucket_id <> 'chat-images');
create policy chat_images_no_client_delete on storage.objects as restrictive for delete to public
using (bucket_id <> 'chat-images');
create policy chat_images_no_client_update on storage.objects as restrictive for update to public
using (bucket_id <> 'chat-images') with check (bucket_id <> 'chat-images');
-- Service role bypasses RLS: it must remain server-only, path-bounded, upsert=false.
-- No custom storage.objects triggers or raw Storage metadata DML are added.

-- Trusted server receives verified session actor, re-downloads stored bytes through
-- the server-only Storage client, checks signature/length/SHA256, then calls this RPC.
-- Direct authenticated callers cannot forge verification, even with a spoofed MIME.
create function public.marketplace_record_verified_chat_image(p_submission_id uuid,p_image_id uuid,
  p_actor_id uuid,p_object_id uuid,p_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
declare submission public.image_message_submissions; item jsonb; object storage.objects;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server verification required.' using errcode = '42501';
  end if;
  select * into submission from public.image_message_submissions s where s.id = p_submission_id for update;
  if not found or submission.sender_id is distinct from p_actor_id or submission.state <> 'pending'
    or submission.expires_at <= clock_timestamp() or not exists (select 1 from public.conversations c
      where c.id = submission.conversation_id and (c.buyer_id = p_actor_id or c.seller_id = p_actor_id)) then
    raise exception 'Active participant reservation required.' using errcode = '42501';
  end if;
  select value into item from jsonb_array_elements(submission.manifest) where value->>'id' = p_image_id::text;
  if not found or p_sha256 is distinct from item->>'sha256' then
    raise exception 'Verified bytes do not match reserved payload.' using errcode = '23514';
  end if;
  select * into object from storage.objects o where o.bucket_id = 'chat-images'
    and o.name = item->>'storage_path' and o.id = p_object_id for share;
  if not found or object.metadata->>'mimetype' is distinct from item->>'mime_type'
    or object.metadata->>'size' is distinct from item->>'size_bytes' then
    raise exception 'Uploaded object identity/metadata mismatch.' using errcode = '23514';
  end if;
  if submission.verified_objects ? p_image_id::text then
    if submission.verified_objects->>p_image_id::text is distinct from p_object_id::text then
      raise exception 'Verified object cannot be replaced.' using errcode = '23505';
    end if;
    return;
  end if;
  update public.image_message_submissions set verified_objects =
    verified_objects || jsonb_build_object(p_image_id::text,p_object_id::text) where id = submission.id;
end; $$;

create function marketplace_private.assert_image_objects(p_submission public.image_message_submissions)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; object storage.objects;
begin
  if p_submission.state <> 'pending' or p_submission.expires_at <= clock_timestamp() then
    raise exception 'Submission expired or no longer pending.' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(p_submission.manifest) loop
    select * into object from storage.objects o where o.bucket_id = 'chat-images'
      and o.name = item->>'storage_path' for share;
    if not found or p_submission.verified_objects->>(item->>'id') is distinct from object.id::text
      or object.metadata->>'mimetype' is distinct from item->>'mime_type'
      or object.metadata->>'size' is distinct from item->>'size_bytes' then
      raise exception 'All reserved objects must exist and have verified bytes.' using errcode = '23514';
    end if;
  end loop;
end; $$;

-- Retain the trigger name and TEXT allocation logic. All messages remain sent-only.
create or replace function marketplace_private.prepare_text_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.conversations; actor uuid := auth.uid(); submission public.image_message_submissions;
begin
  if actor is null or not coalesce(marketplace_private.is_western_user(),false)
    or new.sender_id is distinct from actor then
    raise exception 'Verified sender required.' using errcode = '42501';
  end if;
  select * into target from public.conversations c where c.id = new.conversation_id for update;
  if not found or (target.buyer_id is distinct from actor and target.seller_id is distinct from actor) then
    raise exception 'Conversation not found or not accessible.' using errcode = '42501';
  end if;
  if new.type = 'TEXT' then
    new.content := marketplace_private.trim_message_text(new.content);
    if new.content is null or char_length(new.content) not between 1 and 2000 or new.image_count is not null then
      raise exception 'Send 1-2000 characters of nonblank TEXT.' using errcode = '23514';
    end if;
    if exists (select 1 from public.image_message_submissions s where s.conversation_id = target.id
      and s.sender_id = actor and s.client_message_id = new.client_message_id) then
      raise exception 'Submission UUID reserved for IMAGE.' using errcode = '23505';
    end if;
  elsif new.type = 'IMAGE' then
    submission := marketplace_private.lock_image_submission(new.id);
    if submission.conversation_id <> target.id or submission.client_message_id <> new.client_message_id
      or new.content is not null or new.image_count is distinct from jsonb_array_length(submission.manifest) then
      raise exception 'IMAGE must match its canonical reservation.' using errcode = '23514';
    end if;
    perform marketplace_private.assert_image_objects(submission);
  else
    raise exception 'Unsupported message type.' using errcode = '23514';
  end if;
  new.sequence := target.last_message_sequence + 1;
  new.created_at := greatest(clock_timestamp(),target.created_at,target.last_message_at + interval '1 microsecond');
  return new;
end; $$;
-- Existing activity/read and sent-message immutability triggers are unchanged.

create function marketplace_private.guard_message_image() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.messages; submission public.image_message_submissions; item jsonb;
begin
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' and not exists (select 1 from public.messages m where m.id = old.message_id) then
      return old;
    end if;
    raise exception 'Sent image records are immutable.' using errcode = '23514';
  end if;
  select * into parent from public.messages m where m.id = new.message_id;
  if not found or parent.type <> 'IMAGE' or parent.sender_id is distinct from auth.uid() then
    raise exception 'IMAGE parent and canonical sender required.' using errcode = '42501';
  end if;
  submission := marketplace_private.lock_image_submission(parent.id);
  if submission.state <> 'pending' then
    raise exception 'Cannot append to a sent image manifest.' using errcode = '23514';
  end if;
  select value into item from jsonb_array_elements(submission.manifest) where value->>'id' = new.id::text;
  if not found or row(new.position::text,new.storage_path,new.original_name,new.mime_type,new.size_bytes::text,new.sha256)
    is distinct from row(item->>'position',item->>'storage_path',item->>'original_name',item->>'mime_type',item->>'size_bytes',item->>'sha256') then
    raise exception 'Image must match its reserved slot.' using errcode = '23514';
  end if;
  new.created_at := parent.created_at;
  return new;
end; $$;
create trigger message_images_guard before insert or update or delete on public.message_images
for each row execute function marketplace_private.guard_message_image();

create function marketplace_private.check_message_image_manifest() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid; parent public.messages; amount bigint; first_slot smallint; last_slot smallint;
begin
  if tg_table_name = 'messages' then
    parent_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    parent_id := case when tg_op = 'DELETE' then old.message_id else new.message_id end;
  end if;
  select * into parent from public.messages m where m.id = parent_id;
  if not found then return null; end if;
  select count(*),min(position),max(position) into amount,first_slot,last_slot
    from public.message_images i where i.message_id = parent.id;
  if (parent.type = 'TEXT' and amount <> 0) or (parent.type = 'IMAGE' and
    (amount <> parent.image_count or first_slot is distinct from 1::smallint
      or last_slot is distinct from parent.image_count)) then
    raise exception 'Sent IMAGE needs exactly 1-4 contiguous image rows; TEXT needs none.' using errcode = '23514';
  end if;
  return null;
end; $$;
create constraint trigger messages_complete_image_manifest after insert or update or delete on public.messages
deferrable initially deferred for each row execute function marketplace_private.check_message_image_manifest();
create constraint trigger images_complete_message_manifest after insert or update or delete on public.message_images
deferrable initially deferred for each row execute function marketplace_private.check_message_image_manifest();

create function public.marketplace_finalize_image_message(p_submission_id uuid)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare submission public.image_message_submissions; result public.messages; item jsonb;
begin
  submission := marketplace_private.lock_image_submission(p_submission_id);
  if submission.state = 'finalized' then
    select * into result from public.messages m where m.id = submission.id;
    if not found then raise exception 'Finalized message missing.' using errcode = '23514'; end if;
    -- No new sequence, activity or re-acknowledgment on exact finalize retry.
    return result;
  end if;
  perform marketplace_private.assert_image_objects(submission);
  insert into public.messages(id,conversation_id,sender_id,client_message_id,type,content,image_count)
  values (submission.id,submission.conversation_id,submission.sender_id,submission.client_message_id,
    'IMAGE',null,jsonb_array_length(submission.manifest)) returning * into result;
  for item in select value from jsonb_array_elements(submission.manifest) loop
    insert into public.message_images(id,message_id,position,storage_path,original_name,mime_type,size_bytes,sha256)
    values ((item->>'id')::uuid,result.id,(item->>'position')::smallint,item->>'storage_path',
      item->>'original_name',item->>'mime_type',(item->>'size_bytes')::integer,item->>'sha256');
  end loop;
  update public.image_message_submissions set state = 'finalized' where id = submission.id;
  return result;
end; $$;

create function public.marketplace_abandon_image_message(p_submission_id uuid)
returns public.image_message_submissions language plpgsql security definer set search_path = '' as $$
declare submission public.image_message_submissions;
begin
  submission := marketplace_private.lock_image_submission(p_submission_id);
  if submission.state = 'finalized' then
    raise exception 'Sent IMAGE cannot be cancelled. Reconcile history.' using errcode = '23514';
  end if;
  if submission.state = 'pending' then
    update public.image_message_submissions set state = 'abandoned' where id = submission.id returning * into submission;
  end if;
  return submission;
end; $$;

-- Bounded operator action only; does not install a background job or delete bytes.
create function public.marketplace_expire_image_submissions(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare amount integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted operator required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Choose a batch size 1-100.' using errcode = '23514';
  end if;
  with expired as (select s.id from public.image_message_submissions s
    where s.state = 'pending' and s.expires_at <= clock_timestamp()
    order by s.expires_at,s.id limit p_limit for update skip locked)
  update public.image_message_submissions set state = 'abandoned' where id in (select id from expired);
  get diagnostics amount = row_count;
  return amount;
end; $$;

create function marketplace_private.queue_conversation_chat_images() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into marketplace_private.chat_image_cleanup(storage_path)
  select i.storage_path from public.message_images i join public.messages m on m.id = i.message_id
    where m.conversation_id = old.id
  union select item->>'storage_path' from public.image_message_submissions s,
    lateral jsonb_array_elements(s.manifest) item where s.conversation_id = old.id
  on conflict do nothing;
  return old;
end; $$;
create trigger conversations_queue_chat_image_cleanup before delete on public.conversations
for each row execute function marketplace_private.queue_conversation_chat_images();

create function public.marketplace_ack_chat_image_cleanup(p_storage_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted operator required.' using errcode = '42501';
  end if;
  if exists (select 1 from public.message_images i where i.storage_path = p_storage_path)
    or exists (select 1 from storage.objects o where o.bucket_id = 'chat-images' and o.name = p_storage_path)
    or exists (select 1 from public.image_message_submissions s where s.state <> 'abandoned'
      and exists (select 1 from jsonb_array_elements(s.manifest) i where i->>'storage_path' = p_storage_path)) then
    return false;
  end if;
  -- Leave a 10-minute reconciliation window for bounded in-flight API uploads.
  if exists (select 1 from marketplace_private.chat_image_cleanup q
    where q.storage_path = p_storage_path and q.queued_at > clock_timestamp() - interval '10 minutes') then
    return false;
  end if;
  -- Only call after Storage API remove confirms the object is gone, never raw Storage DML.
  delete from marketplace_private.chat_image_cleanup where storage_path = p_storage_path;
  return true;
end; $$;

revoke all on function marketplace_private.guard_image_submission(),
  marketplace_private.lock_image_submission(uuid),
  marketplace_private.assert_image_objects(public.image_message_submissions),
  marketplace_private.prepare_text_message(), marketplace_private.guard_message_image(),
  marketplace_private.check_message_image_manifest(), marketplace_private.queue_conversation_chat_images()
  from public, anon, authenticated;
revoke all on function public.marketplace_prepare_image_message(uuid,uuid,jsonb),
  public.marketplace_finalize_image_message(uuid), public.marketplace_abandon_image_message(uuid),
  public.marketplace_record_verified_chat_image(uuid,uuid,uuid,uuid,text),
  public.marketplace_expire_image_submissions(integer), public.marketplace_ack_chat_image_cleanup(text)
  from public, anon, authenticated;
grant execute on function public.marketplace_prepare_image_message(uuid,uuid,jsonb),
  public.marketplace_finalize_image_message(uuid), public.marketplace_abandon_image_message(uuid) to authenticated;
grant execute on function public.marketplace_record_verified_chat_image(uuid,uuid,uuid,uuid,text),
  public.marketplace_expire_image_submissions(integer), public.marketplace_ack_chat_image_cleanup(text) to service_role;

commit;

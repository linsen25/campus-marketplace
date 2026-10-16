begin;

-- Explicit provenance: sender_id remains the initiating Buyer for generated
-- messages. The acknowledgement is Marketplace-authored, never a Seller send.
alter table public.messages add column origin text not null default 'user'
 check(origin in('user','buyer_interest','marketplace_auto_reply'));
create table marketplace_private.conversation_first_contacts (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 buyer_id uuid not null,
 intro_message_id uuid not null unique,
 acknowledgement_message_id uuid not null unique,
 acknowledgement_template text not null default 'marketplace_default_v1',
 initialized_at timestamptz not null default clock_timestamp(),
 check(intro_message_id<>acknowledgement_message_id)
);
alter table marketplace_private.conversation_first_contacts enable row level security;
revoke all on marketplace_private.conversation_first_contacts from public,anon,authenticated,service_role;

create function marketplace_private.default_contact_acknowledgement() returns text
language sql immutable set search_path='' as $$
 select 'Thanks for reaching out. I''ve received your message and will get back to you as soon as I can.'::text;
$$;
create function marketplace_private.guard_message_origin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.origin is distinct from old.origin or old.origin='marketplace_auto_reply' then
   raise exception 'Marketplace message provenance is immutable.' using errcode='42501';
  end if;
  return new;
 end if;
 if new.origin='user' then return new;end if;
 if new.type<>'TEXT' or new.sender_id is distinct from auth.uid() or not exists(
  select 1 from marketplace_private.conversation_first_contacts f
  join public.conversations c on c.id=f.conversation_id
  where f.conversation_id=new.conversation_id and f.buyer_id=auth.uid() and c.buyer_id=auth.uid()
  and ((new.origin='buyer_interest' and new.id=f.intro_message_id)
   or(new.origin='marketplace_auto_reply' and new.id=f.acknowledgement_message_id))) then
  raise exception 'Server-created first contact required.' using errcode='42501';
 end if;
 return new;
end;$$;
create trigger messages_origin_guard before insert or update on public.messages
for each row execute function marketplace_private.guard_message_origin();

create function public.marketplace_contact_seller(p_listing_id uuid)
returns public.conversations language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();source public.listings;target public.conversations;
 intro uuid:=gen_random_uuid();ack uuid:=gen_random_uuid();public_name text;intro_text text;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified Western account required.' using errcode='42501';end if;
 -- Serializes independent first-contact callers, with unique identity as the final fence.
 perform pg_advisory_xact_lock(hashtextextended('contact-seller:'||actor::text||':'||p_listing_id::text,0));
 select * into target from public.conversations where listing_origin_id=p_listing_id and buyer_id=actor;
 if found then return target;end if;
 select * into source from public.listings where id=p_listing_id for share;
 if not found or source.published_at is null or source.status<>'available' or source.seller_id=actor then
  raise exception 'Another seller''s published available listing required.' using errcode='23514';end if;
 insert into public.conversations(listing_origin_id,listing_id,buyer_id,seller_id,
  listing_title_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot)
 values(source.id,source.id,actor,source.seller_id,source.title,source.price_cents,source.currency,source.category)
 on conflict on constraint conversations_identity do nothing returning * into target;
 if not found then
  -- A different existing entry path may have created it; never backfill its history.
  select * into target from public.conversations where listing_origin_id=source.id and buyer_id=actor and seller_id=source.seller_id;
  if not found then raise exception 'Retry concurrent conversation change.' using errcode='40001';end if;
  return target;
 end if;
 select btrim(regexp_replace(display_name,'[[:cntrl:]]','','g')) into public_name from public.profiles where id=actor;
 if public_name is null or length(public_name) not between 1 and 120 or position('@' in public_name)>0
  or public_name ~* '^[0-9a-f]{8}-[0-9a-f-]{27,}$' then
  intro_text:='Hi, I''m interested in your '||source.title||'. Is it still available?';
 else
  intro_text:='Hi, I''m '||public_name||'. I''m interested in your '||source.title||'. Is it still available?';
 end if;
 insert into marketplace_private.conversation_first_contacts(conversation_id,buyer_id,intro_message_id,acknowledgement_message_id)
 values(target.id,actor,intro,ack);
 insert into public.messages(id,conversation_id,sender_id,client_message_id,type,content,origin)
 values(intro,target.id,actor,intro,'TEXT',intro_text,'buyer_interest');
 insert into public.messages(id,conversation_id,sender_id,client_message_id,type,content,origin)
 values(ack,target.id,actor,ack,'TEXT',marketplace_private.default_contact_acknowledgement(),'marketplace_auto_reply');
 select * into target from public.conversations where id=target.id;
 return target;
end;$$;

-- Keep the canonical new-message projector and in-app-only event matrix.
create or replace function marketplace_private.project_message_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.conversations;eid uuid;
begin
 if new.type not in('TEXT','IMAGE') or new.origin='marketplace_auto_reply' then return new;end if;
 select * into c from public.conversations where id=new.conversation_id;
 insert into marketplace_private.notification_events(source_key,event_type,destination)
 values('message:'||new.id,'new_message',jsonb_build_object('section','messages','conversationId',c.id)) on conflict(source_key) do nothing;
 select id into eid from marketplace_private.notification_events where source_key='message:'||new.id;
 perform marketplace_private.deliver_notification(eid,case when new.sender_id=c.buyer_id then c.seller_id else c.buyer_id end,'INFORMATIONAL');
 return new;
end;$$;
revoke all on function marketplace_private.default_contact_acknowledgement(),marketplace_private.guard_message_origin(),
 public.marketplace_contact_seller(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_contact_seller(uuid) to authenticated;

create or replace function public.marketplace_mark_conversation_read(p_conversation_id uuid, p_through_sequence bigint)
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
    and m.sequence > watermark and m.sender_id <> actor and m.origin<>'marketplace_auto_reply';
  return jsonb_build_object('conversation_id',target.id,'last_read_sequence',watermark,'unread_count',unread);
end; $$;


commit;

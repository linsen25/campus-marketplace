-- Ordinary confirmed-email account permissions for core marketplace features.
-- UWO verification, Shop approval, Offer/Order and financial authority remain
-- separate. This migration only replaces legacy Western-email predicates in
-- the explicitly listed username, messaging, notification, favorite and media
-- paths; marketplace_private.is_western_user() itself is unchanged.
begin;

-- Replace the final definitions of the selected functions without changing
-- their validation, ownership, participant or transaction logic. The function
-- list is intentionally explicit so financial and order functions are not
-- widened by a global replacement.
do $migration$
declare
  item record;
  definition text;
  actual integer;
  changed integer := 0;
begin
  for item in
    select v.signature::regprocedure::oid as oid,v.signature,v.expected
    from (values
      ('public.marketplace_confirm_username(text)',1),
      ('public.marketplace_change_username(text)',1),
      -- 202610260004 already converted these definitions; verify the new
      -- predicate instead of expecting a legacy occurrence.
      ('marketplace_private.protect_conversation_identity()',0),
      ('marketplace_private.prepare_text_message()',1),
      ('public.marketplace_find_or_create_conversation(uuid)',0),
      ('public.marketplace_send_text(uuid,uuid,text)',1),
      ('public.marketplace_mark_conversation_read(uuid,bigint)',1),
      ('marketplace_private.guard_image_submission()',1),
      ('marketplace_private.lock_image_submission(uuid)',1),
      ('public.marketplace_prepare_image_message(uuid,uuid,jsonb)',1),
      ('public.marketplace_record_verified_chat_image(uuid,uuid,uuid,uuid,text)',0),
      ('public.marketplace_finalize_image_message(uuid)',0),
      ('public.marketplace_abandon_image_message(uuid)',0),
      ('public.marketplace_expire_image_submissions(integer)',0),
      ('public.marketplace_notifications(timestamptz,uuid)',2),
      ('public.marketplace_mark_notification_read(uuid)',1),
      ('public.marketplace_mark_all_notifications_read()',1),
      ('public.marketplace_mutate_notifications(uuid[],text)',1),
      ('public.marketplace_notification_preferences()',1),
      ('public.marketplace_set_notification_preference(text,boolean)',1),
      ('public.marketplace_favorite_shops(jsonb)',1),
      ('public.marketplace_shop_favorite_states(uuid[])',1),
      ('public.marketplace_set_shop_favorite(uuid,boolean)',1)
    ) v(signature,expected)
  loop
    definition := pg_catalog.pg_get_functiondef(item.oid);
    actual := (length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
      / length('marketplace_private.is_western_user()');
    if actual <> item.expected then
      raise exception 'Unexpected legacy predicate count for %: expected %, got %.',item.signature,item.expected,actual
        using errcode='P0001';
    end if;
    if actual > 0 then
      execute replace(
        definition,
        'marketplace_private.is_western_user()',
        'marketplace_private.is_verified_user()'
      );
      changed := changed + 1;
    end if;
  end loop;
  if changed = 0 then
    raise exception 'Verified-account permission migration matched no legacy function definitions.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from (values
      ('marketplace_private.protect_conversation_identity()'),
      ('public.marketplace_find_or_create_conversation(uuid)')
    ) v(signature)
    where pg_catalog.pg_get_functiondef(v.signature::regprocedure::oid)
      not like '%marketplace_private.is_verified_user()%'
  ) then
    raise exception 'Previously converted conversation function is missing the verified predicate.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from (values
      ('public.marketplace_confirm_username(text)'),
      ('public.marketplace_change_username(text)'),
      ('marketplace_private.protect_conversation_identity()'),
      ('marketplace_private.prepare_text_message()'),
      ('public.marketplace_find_or_create_conversation(uuid)'),
      ('public.marketplace_send_text(uuid,uuid,text)'),
      ('public.marketplace_mark_conversation_read(uuid,bigint)'),
      ('marketplace_private.guard_image_submission()'),
      ('marketplace_private.lock_image_submission(uuid)'),
      ('public.marketplace_prepare_image_message(uuid,uuid,jsonb)'),
      ('public.marketplace_record_verified_chat_image(uuid,uuid,uuid,uuid,text)'),
      ('public.marketplace_finalize_image_message(uuid)'),
      ('public.marketplace_abandon_image_message(uuid)'),
      ('public.marketplace_expire_image_submissions(integer)'),
      ('public.marketplace_notifications(timestamptz,uuid)'),
      ('public.marketplace_mark_notification_read(uuid)'),
      ('public.marketplace_mark_all_notifications_read()'),
      ('public.marketplace_mutate_notifications(uuid[],text)'),
      ('public.marketplace_notification_preferences()'),
      ('public.marketplace_set_notification_preference(text,boolean)'),
      ('public.marketplace_favorite_shops(jsonb)'),
      ('public.marketplace_shop_favorite_states(uuid[])'),
      ('public.marketplace_set_shop_favorite(uuid,boolean)')
    ) v(signature)
    where (v.signature::regprocedure::oid)::regproc::text is not null
      and pg_catalog.pg_get_functiondef(v.signature::regprocedure::oid) like '%marketplace_private.is_western_user()%'
  ) then
    raise exception 'Verified-account permission migration left a legacy Western predicate in a selected function.'
      using errcode = 'P0001';
  end if;
end;
$migration$;

-- Messages: preserve participant-only reads and guarded RPC writes.
drop policy if exists conversations_participant_read on public.conversations;
create policy conversations_participant_read on public.conversations for select to authenticated
using ((select marketplace_private.is_verified_user()) and
  (buyer_id = (select auth.uid()) or seller_id = (select auth.uid())));

drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read on public.messages for select to authenticated
using (exists (select 1 from public.conversations c where c.id = conversation_id
  and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))));

-- Realtime: only the authenticated user's reserved topic remains readable.
drop policy if exists marketplace_messages_realtime_receive on realtime.messages;
create policy marketplace_messages_realtime_receive on realtime.messages
for select to authenticated using (
  extension = 'broadcast'
  and topic = 'marketplace:messages:' || (select auth.uid())::text
  and topic = (select realtime.topic())
  and coalesce((select marketplace_private.is_verified_user()), false)
);
drop policy if exists marketplace_messages_realtime_read_fence on realtime.messages;
create policy marketplace_messages_realtime_read_fence on realtime.messages
as restrictive for select to public using (
  case when topic like 'marketplace:messages:%' then
    case when (select auth.role()) = 'authenticated' then
      extension = 'broadcast'
      and topic = 'marketplace:messages:' || (select auth.uid())::text
      and topic = (select realtime.topic())
      and coalesce((select marketplace_private.is_verified_user()), false)
    else false end
  else true end
);

-- Notifications: recipient ownership and the existing bounded 90-day window
-- remain unchanged.
alter policy notifications_own_read on public.notifications using(
  (select marketplace_private.is_verified_user())
  and recipient_user_id=(select auth.uid())
  and created_at>=statement_timestamp()-interval '90 days'
);
alter policy notification_preferences_own on public.notification_preferences using(
  user_id=(select auth.uid()) and (select marketplace_private.is_verified_user())
);

-- Shop Favorites: user ownership and Shop projection eligibility remain intact.
drop policy if exists shop_favorites_own_read on public.shop_favorites;
create policy shop_favorites_own_read on public.shop_favorites for select to authenticated
using(user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists shop_favorites_own_insert on public.shop_favorites;
create policy shop_favorites_own_insert on public.shop_favorites for insert to authenticated
with check(user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists shop_favorites_own_delete on public.shop_favorites;
create policy shop_favorites_own_delete on public.shop_favorites for delete to authenticated
using(user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));

-- Listing media: all remaining legacy Storage policies use the same confirmed
-- email predicate while retaining path, listing, bucket and owner checks.
drop policy if exists marketplace_storage_owner_read on storage.objects;
create policy marketplace_storage_owner_read on storage.objects for select to authenticated using (
  bucket_id='listing-images' and (storage.foldername(name))[1]=(select auth.uid())::text
  and (select marketplace_private.is_verified_user())
);
drop policy if exists listing_legacy_insert_guard on storage.objects;
create policy listing_legacy_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'listing-images' or ((select marketplace_private.is_verified_user()) and exists(
  select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
  where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
    and l.published_at is null and l.status='available' and l.listing_channel<>'resale')));
drop policy if exists marketplace_storage_owner_delete on storage.objects;
create policy marketplace_storage_owner_delete on storage.objects for delete to authenticated using (
  bucket_id in ('listing-images','listing-images-private')
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (select marketplace_private.is_verified_user())
  and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id)
);
drop policy if exists listing_private_delete_guard on storage.objects;
create policy listing_private_delete_guard on storage.objects as restrictive for delete to anon,authenticated using (
  bucket_id<>'listing-images-private' or ((storage.foldername(name))[1]=(select auth.uid())::text
    and (select marketplace_private.is_verified_user())
    and not exists(select 1 from public.listing_images i where i.path=name and i.storage_bucket=bucket_id))
);

commit;

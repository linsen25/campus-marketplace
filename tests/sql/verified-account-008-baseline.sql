-- Read-only catalog report for the disposable database at the 008 boundary.
-- This file intentionally reports facts; it does not mutate roles or data.
with targets(signature, expected_old) as (
  values
    ('public.marketplace_confirm_username(text)',1),
    ('public.marketplace_change_username(text)',1),
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
), definitions as (
  select t.signature,t.expected_old,
    p.oid,p.prosecdef,p.proowner,p.proacl,p.proconfig,
    pg_get_functiondef(p.oid) as definition
  from targets t
  join pg_proc p on p.oid=t.signature::regprocedure
)
select signature,expected_old,
  (length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
    / length('marketplace_private.is_western_user()') as old_predicates,
  (length(definition)-length(replace(definition,'marketplace_private.is_verified_user()','')))
    / length('marketplace_private.is_verified_user()') as new_predicates,
  pg_get_userbyid(proowner) as owner,
  prosecdef as security_definer,
  coalesce(array_to_string(proconfig,','),'') as config,
  coalesce(array_to_string(proacl,','),'PUBLIC') as acl
from definitions
order by signature;

-- Read-only catalog report for the disposable database at the 008 boundary.
-- This file intentionally reports facts; it does not mutate roles or data.
create temporary table verified_account_008_baseline(
 signature text,
 expected_old integer,
 old_predicates integer,
 new_predicates integer,
 present boolean,
 owner_name text,
 security_definer boolean,
 config text,
 acl text
) on commit drop;

do $$
declare
 target record;
 target_oid oid;
 definition text;
 owner_name text;
 security_definer boolean;
 config text;
 acl text;
begin
 for target in
  select * from (values
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
   ('public.marketplace_notifications(timestamptz,uuid)',1),
   ('public.marketplace_mark_notification_read(uuid)',1),
   ('public.marketplace_mark_all_notifications_read()',1),
   ('public.marketplace_mutate_notifications(uuid[],text)',1),
   ('public.marketplace_notification_preferences()',1),
   ('public.marketplace_set_notification_preference(text,boolean)',1),
   ('public.marketplace_favorite_shops(jsonb)',1),
   ('public.marketplace_shop_favorite_states(uuid[])',1),
   ('public.marketplace_set_shop_favorite(uuid,boolean)',1)
  ) v(signature,expected_old)
 loop
  target_oid := pg_catalog.to_regprocedure(target.signature);
  if target_oid is null then
   insert into verified_account_008_baseline values(target.signature,target.expected_old,0,0,false,null,null,null,null);
  else
   select pg_catalog.pg_get_functiondef(target_oid),pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,coalesce(array_to_string(p.proconfig,','),''),coalesce(array_to_string(p.proacl,','),'PUBLIC')
    into definition,owner_name,security_definer,config,acl from pg_catalog.pg_proc p where p.oid=target_oid;
   insert into verified_account_008_baseline values(target.signature,target.expected_old,
    (length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
      / length('marketplace_private.is_western_user()'),
    (length(definition)-length(replace(definition,'marketplace_private.is_verified_user()','')))
      / length('marketplace_private.is_verified_user()'),true,owner_name,security_definer,config,acl);
  end if;
 end loop;
end $$;

select * from verified_account_008_baseline order by signature;

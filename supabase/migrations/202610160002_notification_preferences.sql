-- Staging notification preferences; no transaction-state or historical backfill changes.
begin;
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 in_app_notifications boolean not null default true,
 notification_sounds boolean not null default false,
 email_notifications boolean not null default true
);
alter table public.notification_preferences enable row level security;
create policy notification_preferences_own on public.notification_preferences for select to authenticated
 using(user_id=(select auth.uid()) and (select marketplace_private.is_western_user()));
revoke all on public.notification_preferences from public,anon,authenticated,service_role;
grant select on public.notification_preferences to authenticated;

create function public.marketplace_notification_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();result jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select jsonb_build_object('inApp',in_app_notifications,'sounds',notification_sounds,'email',email_notifications) into result
 from public.notification_preferences where user_id=actor;
 return coalesce(result,'{"inApp":true,"sounds":false,"email":true}'::jsonb);
end;$$;
create function public.marketplace_set_notification_preference(p_key text,p_value boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_key is null or p_key not in('inApp','sounds','email') or p_value is null then raise exception 'Invalid preference.' using errcode='23514';end if;
 insert into public.notification_preferences(user_id,in_app_notifications,notification_sounds,email_notifications)
 values(actor,case when p_key='inApp' then p_value else true end,case when p_key='sounds' then p_value else false end,case when p_key='email' then p_value else true end)
 on conflict(user_id) do update set
 in_app_notifications=case when p_key='inApp' then p_value else notification_preferences.in_app_notifications end,
 notification_sounds=case when p_key='sounds' then p_value else notification_preferences.notification_sounds end,
 email_notifications=case when p_key='email' then p_value else notification_preferences.email_notifications end;
 -- Retire unsent work; never erase sent audit or invalidate an active send lease.
 if p_key='email' and not p_value then
  update marketplace_private.notification_deliveries d set status='permanent_failure',last_error_code='notification_opt_out',lease_id=null,lease_until=null
  from public.notifications n where n.id=d.notification_id and n.recipient_user_id=actor and d.status in('pending','retryable');
 end if;
 begin
  perform realtime.send(jsonb_build_object('changed',true,'preferencesChanged',true),'notifications_changed','marketplace:messages:'||actor,true);
 exception when others then null;end;
 return public.marketplace_notification_preferences();
end;$$;
revoke all on function public.marketplace_notification_preferences(),public.marketplace_set_notification_preference(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_notification_preferences(),public.marketplace_set_notification_preference(text,boolean) to authenticated;

create or replace function marketplace_private.notify_notification_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare signal jsonb:=jsonb_build_object('changed',true);
begin
 if tg_op='INSERT' then
  if marketplace_private.notification_email_enabled(new.event_type) and coalesce((select email_notifications from public.notification_preferences where user_id=new.recipient_user_id),true) then
   insert into marketplace_private.notification_deliveries(notification_id,notification_identity) values(new.id,new.id) on conflict do nothing;
  end if;
  -- Same recipient-only private channel; only the existing safe inbox projection.
  signal:=signal||jsonb_build_object('inserted',true,'notification',jsonb_build_object('id',new.id,'event_type',new.event_type,'created_at',new.created_at,'read_at',new.read_at,'destination',new.destination));
 end if;
 begin
  perform realtime.send(signal,'notifications_changed','marketplace:messages:'||new.recipient_user_id,true);
 exception when others then null;end;
 return new;
end;$$;

-- Preserve the existing lease/retry/idempotency implementation behind narrow guards.
alter function public.marketplace_claim_email_deliveries(integer,uuid) set schema marketplace_private;
alter function marketplace_private.marketplace_claim_email_deliveries(integer,uuid) rename to claim_notification_emails_before_preferences;
revoke all on function marketplace_private.claim_notification_emails_before_preferences(integer,uuid) from public,anon,authenticated,service_role;
create function public.marketplace_claim_email_deliveries(p_limit integer default 10,p_test_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform marketplace_private.require_notification_worker();
 update marketplace_private.notification_deliveries d set status='permanent_failure',last_error_code='notification_opt_out',lease_id=null,lease_until=null
 from public.notifications n join public.notification_preferences p on p.user_id=n.recipient_user_id
 where n.id=d.notification_id and not p.email_notifications and (d.status in('pending','retryable') or (d.status='sending' and d.lease_until<=clock_timestamp()));
 return marketplace_private.claim_notification_emails_before_preferences(p_limit,p_test_id);
end;$$;
alter function public.marketplace_prepare_email(uuid,uuid,jsonb) set schema marketplace_private;
alter function marketplace_private.marketplace_prepare_email(uuid,uuid,jsonb) rename to prepare_notification_email_before_preferences;
revoke all on function marketplace_private.prepare_notification_email_before_preferences(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.marketplace_prepare_email(p_id uuid,p_lease uuid,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform marketplace_private.require_notification_worker();
 if exists(select 1 from marketplace_private.notification_deliveries d join public.notifications n on n.id=d.notification_id
 join public.notification_preferences p on p.user_id=n.recipient_user_id where d.id=p_id and not p.email_notifications) then
  raise exception 'Notification email disabled.' using errcode='23514';
 end if;
 return marketplace_private.prepare_notification_email_before_preferences(p_id,p_lease,p_envelope);
end;$$;
revoke all on function public.marketplace_claim_email_deliveries(integer,uuid),public.marketplace_prepare_email(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_claim_email_deliveries(integer,uuid),public.marketplace_prepare_email(uuid,uuid,jsonb) to service_role;
commit;

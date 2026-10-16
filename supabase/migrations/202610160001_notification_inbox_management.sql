-- Staging-only notification inbox management. Source facts and email audit stay independent.
begin;

create or replace function public.marketplace_notifications(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); items jsonb; cutoff timestamptz:=statement_timestamp()-interval '90 days';
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501'; end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'Complete cursor required.' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc),'[]'::jsonb) into items from (
  select id,event_type,priority,created_at,updated_at,read_at,destination,original_price_cents,latest_price_cents
  from public.notifications where recipient_user_id=actor and created_at>=cutoff
  and(p_before is null or(created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50
 ) v;
 return jsonb_build_object('notifications',items,'unreadCount',(
  select count(*) from public.notifications where recipient_user_id=actor and read_at is null and created_at>=cutoff));
end;$$;

alter policy notifications_own_read on public.notifications using(
 (select marketplace_private.is_western_user()) and recipient_user_id=(select auth.uid())
 and created_at>=statement_timestamp()-interval '90 days');

create or replace function public.marketplace_mark_notification_read(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.notifications; actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 update public.notifications set read_at=coalesce(read_at,clock_timestamp())
 where id=p_id and recipient_user_id=actor and created_at>=statement_timestamp()-interval '90 days' returning * into n;
 if n.id is null then raise exception 'Notification not accessible.' using errcode='42501';end if;
 return jsonb_build_object('id',n.id,'readAt',n.read_at);
end;$$;

create or replace function public.marketplace_mark_all_notifications_read() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 update public.notifications set read_at=clock_timestamp() where recipient_user_id=auth.uid()
 and read_at is null and created_at>=statement_timestamp()-interval '90 days';
 return jsonb_build_object('ok',true);
end;$$;

create function public.marketplace_mutate_notifications(p_ids uuid[],p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cutoff timestamptz:=statement_timestamp()-interval '90 days';
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 if p_action is null or p_action not in('markRead','delete') or p_ids is null
 or array_ndims(p_ids) is distinct from 1 or cardinality(p_ids) not between 1 and 500
 or array_position(p_ids,null) is not null then raise exception 'Invalid notification batch.' using errcode='23514';end if;
 -- Deterministic row locking; foreign/missing IDs are indistinguishable no-ops.
 perform id from public.notifications where recipient_user_id=actor and id=any(p_ids) and created_at>=cutoff order by id for update;
 if p_action='markRead' then
  update public.notifications set read_at=clock_timestamp() where recipient_user_id=actor and id=any(p_ids) and read_at is null and created_at>=cutoff;
 else
  delete from public.notifications where recipient_user_id=actor and id=any(p_ids) and created_at>=cutoff;
 end if;
 return jsonb_build_object('ok',true,'unreadCount',(select count(*) from public.notifications where recipient_user_id=actor and read_at is null and created_at>=cutoff));
end;$$;

create function marketplace_private.broadcast_notification_removal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 begin
  perform realtime.send(jsonb_build_object('changed',true),'notifications_changed','marketplace:messages:'||old.recipient_user_id,true);
 exception when others then null; end;
 return old;
end;$$;
create trigger notification_removal_invalidation after delete on public.notifications
for each row execute function marketplace_private.broadcast_notification_removal();

create function marketplace_private.cleanup_notification_inbox(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 with expired as (
  select id from public.notifications where created_at<statement_timestamp()-interval '90 days'
  order by created_at,id limit greatest(1,least(coalesce(p_limit,1000),10000)) for update skip locked
 ), deleted as (delete from public.notifications n using expired e where n.id=e.id returning n.id)
 select count(*) into removed from deleted;
 return removed;
end;$$;
create index notifications_retention on public.notifications(created_at,id);
-- Bound each cleanup pass. API, RLS and unread count exclude expired rows immediately.
select cron.schedule('marketplace-notification-inbox-retention','15 * * * *',
 'select marketplace_private.cleanup_notification_inbox();');

revoke all on function public.marketplace_mutate_notifications(uuid[],text),marketplace_private.broadcast_notification_removal(),
 marketplace_private.cleanup_notification_inbox(integer) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_mutate_notifications(uuid[],text) to authenticated;
grant execute on function marketplace_private.cleanup_notification_inbox(integer) to service_role;
-- Existing list/read privileges stay as before; no direct INSERT/UPDATE/DELETE grants.
commit;

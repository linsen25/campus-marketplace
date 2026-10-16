-- Runs inside one rollback-only transaction. No canonical fixtures are mutated.
create temporary table ni_people as select gen_random_uuid() owner,gen_random_uuid() other;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'ni_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','NI_'||left(replace(id::text,'-',''),12))
from ni_people cross join lateral(values(owner),(other)) v(id);
create function pg_temp.ni_assert(v boolean,label text) returns void language plpgsql as $$begin
 if v is not true then raise exception 'Inbox assertion: %',label;end if;end;$$;
create function pg_temp.ni_actor(v uuid) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',v,'role','authenticated')::text,true);$$;
create function pg_temp.ni_sources() returns jsonb language plpgsql as $$
declare t record; value text; result jsonb:='{}';
begin
 for t in select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name<>'notifications' order by table_name loop
 execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t',t.table_name) into value;
 result:=result||jsonb_build_object(t.table_name,value);
 end loop;
 return result;
end;$$;
create temporary table ni_baseline as select pg_temp.ni_sources() source;
create temporary table ni_ids(id uuid,kind text);
insert into marketplace_private.notification_events(source_key,event_type,destination)
select 'inbox-rollback:'||gen_random_uuid(),'notification_test','{}'::jsonb from generate_series(1,7);
with seeded as (
 insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination,read_at)
 select case when rn=7 then (select other from ni_people) else (select owner from ni_people) end,id,'notification_test','INFORMATIONAL',
 statement_timestamp()-case when rn in(5,6) then interval '91 days' else interval '89 days' end,statement_timestamp(),'{}',
 case when rn in(2,6) then statement_timestamp() else null end
 from (select id,row_number() over(order by id) rn from marketplace_private.notification_events where source_key like 'inbox-rollback:%') e
 returning id,recipient_user_id,created_at,read_at
) insert into ni_ids select id,case when recipient_user_id=(select other from ni_people) then 'foreign' when created_at<statement_timestamp()-interval '90 days' then case when read_at is null then 'old_unread' else 'old_read' end when read_at is not null then 'read' else 'unread' end from seeded;
-- Sent audit must survive deletion, including original provider identity.
insert into marketplace_private.notification_deliveries(notification_id,notification_identity,status,attempt_count,first_attempt_at,sent_at,provider_message_id,test_only)
select id,id,'sent',1,clock_timestamp(),clock_timestamp(),'synthetic-inbox-audit',true from ni_ids where kind='unread' limit 1;

insert into marketplace_private.notification_deliveries(notification_id,notification_identity,status,attempt_count,first_attempt_at,sent_at,provider_message_id,test_only)
select id,id,'sent',1,clock_timestamp(),clock_timestamp(),'synthetic-inbox-retention-audit',true from ni_ids where kind='old_unread';
do $$declare own uuid; foreign_id uuid; picked uuid[]; result jsonb; original timestamptz; begin
 select owner into own from ni_people;perform pg_temp.ni_actor(own);
 result:=public.marketplace_notifications();
 perform pg_temp.ni_assert(jsonb_array_length(result->'notifications')=4 and (result->>'unreadCount')::int=3,'API/count exclude both expired statuses; <90d remains');
 select id into foreign_id from ni_ids where kind='foreign';
 select array_agg(id) into picked from ni_ids where kind in('unread','read','foreign');
 result:=public.marketplace_mutate_notifications(picked,'markRead');
 perform pg_temp.ni_assert((result->>'unreadCount')::int=0,'batch own unread count');
 perform pg_temp.ni_assert((select read_at is null from public.notifications where id=foreign_id),'foreign mark ignored');
 perform pg_temp.ni_assert((select count(*)=4 from public.notifications where recipient_user_id=own and read_at is not null and created_at>=statement_timestamp()-interval '90 days'),'mixed batch keeps records');
 select n.read_at into original from public.notifications n join ni_ids i using(id) where kind='read';
 perform public.marketplace_mutate_notifications(picked,'markRead');
 perform pg_temp.ni_assert((select n.read_at=original from public.notifications n join ni_ids i using(id) where kind='read'),'read timestamp idempotent');
 perform public.marketplace_mark_all_notifications_read();
 perform pg_temp.ni_assert((select read_at is null from public.notifications n join ni_ids i using(id) where kind='old_unread'),'mark all excludes expired unread');
 perform public.marketplace_mutate_notifications(picked,'delete');
 perform public.marketplace_mutate_notifications(picked,'delete');
 perform pg_temp.ni_assert((select count(*)=2 from public.notifications where recipient_user_id=own),'one/multiple delete idempotent; only expired own remain');
 perform pg_temp.ni_assert(exists(select 1 from public.notifications where id=foreign_id),'foreign delete ignored');
 perform pg_temp.ni_assert(exists(select 1 from marketplace_private.notification_deliveries where provider_message_id='synthetic-inbox-audit' and notification_id is null and status='sent'),'sent email audit preserved');
 perform pg_temp.ni_assert((select count(*)=7 from marketplace_private.notification_events where source_key like 'inbox-rollback:%'),'source events preserved');
 begin perform public.marketplace_mutate_notifications('{}','delete');raise exception 'empty accepted';exception when check_violation then null;end;
 begin perform public.marketplace_mutate_notifications(array[gen_random_uuid()],'wrong');raise exception 'action accepted';exception when check_violation then null;end;
 begin perform public.marketplace_mutate_notifications(array_fill(gen_random_uuid(),array[501]),'delete');raise exception 'oversize accepted';exception when check_violation then null;end;
 -- Deleting unread own rows also adjusts authoritative global count.
 insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination)
 select own,domain_event_id,event_type,priority,statement_timestamp(),statement_timestamp(),destination from public.notifications where id=foreign_id returning id into foreign_id;
 result:=public.marketplace_mutate_notifications(array[foreign_id],'delete');
 perform pg_temp.ni_assert((result->>'unreadCount')::int=0 and not exists(select 1 from public.notifications where id=foreign_id),'unread delete count and single delete');
 perform pg_temp.ni_assert(not has_function_privilege('anon','public.marketplace_mutate_notifications(uuid[],text)','execute'),'anon RPC denied');
 perform pg_temp.ni_assert(has_function_privilege('authenticated','public.marketplace_mutate_notifications(uuid[],text)','execute'),'authenticated RPC grant');
 perform pg_temp.ni_assert(not has_table_privilege('authenticated','public.notifications','DELETE'),'no direct delete grant');
 perform pg_temp.ni_assert(not has_function_privilege('authenticated','marketplace_private.cleanup_notification_inbox(integer)','execute'),'retention worker inaccessible');
end;$$;
-- Exercise real RLS as authenticated; the foreign and expired rows stay hidden.
grant select on ni_people,ni_ids to authenticated;
set local role authenticated;
select pg_temp.ni_actor(owner) from ni_people;
select pg_temp.ni_assert((select count(*)=0 from public.notifications),'RLS hides foreign and expired');
reset role;

do $$declare own uuid; begin
 select owner into own from ni_people;
 perform marketplace_private.cleanup_notification_inbox(10000);
 perform pg_temp.ni_assert(not exists(select 1 from public.notifications n join ni_ids i using(id) where kind in('old_unread','old_read')),'retention physically removes read and unread >90d');
 perform pg_temp.ni_assert(exists(select 1 from public.notifications n join ni_ids i using(id) where kind='foreign'),'retention keeps younger source');
 perform pg_temp.ni_assert(exists(select 1 from marketplace_private.notification_events where source_key like 'inbox-rollback:%'),'retention keeps source events');
 perform pg_temp.ni_assert(exists(select 1 from marketplace_private.notification_deliveries where provider_message_id='synthetic-inbox-retention-audit' and notification_id is null and status='sent'),'retention preserves email history');
 perform pg_temp.ni_assert((select source=pg_temp.ni_sources() from ni_baseline),'all public business source tables unchanged');
 perform pg_temp.ni_assert((select count(*)=1 from cron.job where jobname='marketplace-notification-inbox-retention' and schedule='15 * * * *'),'single retention schedule');
end;$$;
select 'PASS rollback-only inbox ownership, RLS, mixed batch/idempotency, 90-day API/RLS/physical retention, email audit and all public source records preserved' as result;

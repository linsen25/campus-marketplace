create temporary table np_users as select gen_random_uuid() owner,gen_random_uuid() other;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
 select id,'np_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','NP_'||left(replace(id::text,'-',''),12))
 from np_users cross join lateral(values(owner),(other)) u(id);
create function pg_temp.np_assert(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'Preference assertion: %',label;end if;end;$$;
create function pg_temp.np_actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
create function pg_temp.np_notice(actor uuid) returns uuid language plpgsql as $$declare eid uuid; nid uuid;begin
 insert into marketplace_private.notification_events(source_key,event_type,destination) values('np-rollback:'||gen_random_uuid(),'incoming_offer','{}') returning id into eid;
 insert into public.notifications(recipient_user_id,domain_event_id,event_type,priority,destination,created_at,updated_at) values(actor,eid,'incoming_offer','ACTION_REQUIRED','{}',clock_timestamp(),clock_timestamp()) returning id into nid;
 update marketplace_private.notification_deliveries set test_only=true where notification_id=nid;
 return nid;
end;$$;
create temporary table np_notices(id uuid,kind text);
do $$declare owner uuid; other_id uuid; d uuid; n uuid; result jsonb; lease uuid; audit uuid;
begin
 select u.owner,u.other into owner,other_id from np_users u;
 perform pg_temp.np_actor(owner);
 perform pg_temp.np_assert(public.marketplace_notification_preferences()='{"inApp":true,"sounds":false,"email":true}'::jsonb,'compatibility defaults');
 perform public.marketplace_set_notification_preference('sounds',true);
 perform public.marketplace_set_notification_preference('inApp',false);
 perform pg_temp.np_assert(public.marketplace_notification_preferences()='{"inApp":false,"sounds":true,"email":true}'::jsonb,'partial update preserves other settings');
 n:=pg_temp.np_notice(owner);insert into np_notices values(n,'enabled');
 select id into d from marketplace_private.notification_deliveries where notification_id=n;
 perform pg_temp.np_assert(d is not null,'email enabled queues even if in-app popup disabled');
 perform public.marketplace_set_notification_preference('email',false);
 perform pg_temp.np_assert((select status='permanent_failure' and last_error_code='notification_opt_out' from marketplace_private.notification_deliveries where id=d),'queued email retired without deleting audit');
 n:=pg_temp.np_notice(owner);insert into np_notices values(n,'disabled');
 perform pg_temp.np_assert(not exists(select 1 from marketplace_private.notification_deliveries where notification_id=n),'email disabled suppresses queue');
 perform pg_temp.np_assert((public.marketplace_notifications()->>'unreadCount')::int=2,'inbox/unread survive both switches disabled');
 perform pg_temp.np_actor(other_id);
 perform pg_temp.np_assert(public.marketplace_notification_preferences()='{"inApp":true,"sounds":false,"email":true}'::jsonb,'other account unaffected');
 n:=pg_temp.np_notice(other_id);insert into np_notices values(n,'other');
 perform pg_temp.np_assert(exists(select 1 from marketplace_private.notification_deliveries where notification_id=n),'other account email unaffected');
 perform pg_temp.np_actor(owner);
 perform public.marketplace_set_notification_preference('email',true);
 n:=pg_temp.np_notice(owner);insert into np_notices values(n,'claimed');
 select id into d from marketplace_private.notification_deliveries where notification_id=n;
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 result:=public.marketplace_claim_email_deliveries(1,d);
 perform pg_temp.np_assert(jsonb_array_length(result)=1,'eligible legacy claim preserved');
 lease:=(result->0->>'leaseId')::uuid;
 perform pg_temp.np_actor(owner);perform public.marketplace_set_notification_preference('email',false);
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 begin
  perform public.marketplace_prepare_email(d,lease,'{"from":"fixture","to":["delivered@resend.dev"],"subject":"test","text":"test","html":"test"}');
  raise exception 'Expected prepare opt-out denial';
 exception when check_violation then null;end;
 -- Already in-flight provider acknowledgement must remain recordable, never erased by opt-out.
 perform public.marketplace_finish_email(d,lease,'synthetic-already-inflight',null,false);
 perform pg_temp.np_assert((select status='sent' and provider_message_id='synthetic-already-inflight' from marketplace_private.notification_deliveries where id=d),'existing send audit may complete safely');
 perform pg_temp.np_actor(owner);perform public.marketplace_set_notification_preference('email',false);
 perform pg_temp.np_assert((select status='sent' from marketplace_private.notification_deliveries where id=d),'sent history unchanged');
 begin perform public.marketplace_set_notification_preference('userId',true);raise exception 'Expected invalid preference rejection';exception when check_violation then null;end;
end;$$;
-- Test actual grants/RLS, not just SECURITY DEFINER filtering.
select pg_temp.np_actor(owner) from np_users;
set local role authenticated;
select pg_temp.np_assert((select count(*) from public.notification_preferences)=1,'RLS exposes only own preferences');
do $$begin
 begin update public.notification_preferences set email_notifications=true;raise exception 'Direct update unexpectedly permitted';exception when insufficient_privilege then null;end;
 begin perform marketplace_private.claim_notification_emails_before_preferences(1,null);raise exception 'Legacy worker bypass unexpectedly permitted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$begin begin perform public.marketplace_notification_preferences();raise exception 'Anon preferences unexpectedly permitted';exception when insufficient_privilege then null;end;end;$$;
reset role;
select 'PASS defaults, durable per-user settings, partial saves, email queue/claim/prepare guards, inbox/unread, audit, RLS/grants and rollback-only synthetic isolation' result;

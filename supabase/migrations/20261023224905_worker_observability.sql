-- B28-B: private worker receipts, bounded queue health and failure propagation.
-- This migration observes existing work only. It cannot create provider or
-- marketplace operations and it grants no browser or human-operator authority.
begin;

create table marketplace_private.worker_runtime_runs (
 id uuid primary key default gen_random_uuid(),
 run_key uuid not null unique,
 worker_kind text not null check(worker_kind in(
  'stripe_worker','notification_email','transaction_due_work',
  'notification_inbox_retention','shop_suspension_lifecycle','media_cleanup')),
 stage text not null check(stage in('dispatch','delivery','due_work','retention','lifecycle','cleanup')),
 provider_platform text check(provider_platform is null or provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 enabled boolean not null,
 status text not null check(status in(
  'running','completed','idle','disabled','busy','degraded','failed','interrupted')),
 lease uuid,
 lease_until timestamptz,
 processed_count integer not null default 0 check(processed_count>=0),
 retry_count integer not null default 0 check(retry_count>=0),
 needs_attention_count integer not null default 0 check(needs_attention_count>=0),
 skipped_due_to_lease boolean not null default false,
 budget_interrupted boolean not null default false,
 error_codes text[] not null default '{}'::text[] check(cardinality(error_codes)<=20),
 phase_results jsonb not null default '{}'::jsonb
  check(jsonb_typeof(phase_results)='object' and octet_length(phase_results::text)<=8192),
 started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='running' and lease is not null and lease_until is not null and completed_at is null)
  or(status<>'running' and lease is null and lease_until is null and completed_at is not null)),
 check((worker_kind='stripe_worker' and provider_platform is not null)
  or(worker_kind<>'stripe_worker')),
 check(updated_at>=created_at and(completed_at is null or completed_at>=started_at))
);
alter table marketplace_private.worker_runtime_runs enable row level security;
revoke all on marketplace_private.worker_runtime_runs from public,anon,authenticated,service_role;
create unique index worker_runtime_one_running_idx
 on marketplace_private.worker_runtime_runs(worker_kind) where status='running';
create index worker_runtime_history_idx
 on marketplace_private.worker_runtime_runs(worker_kind,started_at desc,id);

create function marketplace_private.protect_worker_runtime_run() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'running' or
  (to_jsonb(new)-array['status','lease','lease_until','processed_count','retry_count',
   'needs_attention_count','skipped_due_to_lease','budget_interrupted','error_codes',
   'phase_results','completed_at','updated_at']) is distinct from
  (to_jsonb(old)-array['status','lease','lease_until','processed_count','retry_count',
   'needs_attention_count','skipped_due_to_lease','budget_interrupted','error_codes',
   'phase_results','completed_at','updated_at']) then
  raise exception 'Worker runtime audit is immutable.' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger worker_runtime_run_immutable before update or delete
 on marketplace_private.worker_runtime_runs for each row
 execute function marketplace_private.protect_worker_runtime_run();

-- Counts are deliberately capped at 10,001. A value of 10,001 means
-- "more than the operational display cap", not an exact unbounded count.
create function marketplace_private.worker_queue_snapshot(p_platform text)
returns jsonb language sql stable security definer set search_path='' as $$
 with t as(select clock_timestamp() n),
 webhook as(
  select count(*) c,min(next_attempt_at) oldest,count(*) filter(where lease_until<(select n from t)) stale,
   count(*) filter(where attempts>=10) exhausted
  from(select next_attempt_at,lease_until,attempts,purpose from marketplace_private.stripe_webhook_inbox
   where platform=p_platform and mode='test' and status<>'done' and next_attempt_at<=(select n from t)
   order by next_attempt_at limit 10001)q),
 payment as(
  select count(*) c,min(due) oldest,count(*) filter(where lease_until<(select n from t)) stale,
   count(*) filter(where attempts>=10) exhausted from(
   select coalesce(provider_reconcile_after,provider_bound_at,provider_create_started_at) due,
    provider_reconcile_lease_until lease_until,provider_reconcile_attempts attempts
   from marketplace_private.campus_payment_attempts where provider='stripe' and provider_mode='test'
    and provider_platform=p_platform and provider_purpose='marketplace_order' and status='processing'
    and coalesce(provider_reconcile_after,provider_bound_at,provider_create_started_at)<=(select n from t)
   order by coalesce(provider_reconcile_after,provider_bound_at,provider_create_started_at) limit 10001)q),
 refund as(
  select count(*) c,min(next_reconcile_at) oldest,count(*) filter(where lease_until<(select n from t)) stale,
   count(*) filter(where attempts>=10 or state in('failed','exception')) attention from(
   select next_reconcile_at,lease_until,attempts,state from marketplace_private.order_refund_operations
   where provider_platform=p_platform and provider_mode='test'
    and state in('prepared','in_flight','reconciling','failed','exception')
    and(state in('failed','exception') or next_reconcile_at<=(select n from t))
   order by next_reconcile_at limit 10001)q),
 transfer as(
  select count(*) c,min(next_reconcile_at) oldest,count(*) filter(where lease_until<(select n from t)) stale,
   count(*) filter(where attempts>=10 or state in('failed','exception')) attention from(
   select next_reconcile_at,lease_until,attempts,state from marketplace_private.order_transfer_operations
   where provider_platform=p_platform and provider_mode='test'
    and state in('prepared','in_flight','reconciling','failed','exception')
    and(state in('failed','exception') or next_reconcile_at<=(select n from t))
   order by next_reconcile_at limit 10001)q),
 email as(
  select count(*) c,min(next_attempt_at) oldest,count(*) filter(where lease_until<(select n from t)) stale,
   count(*) filter(where status='permanent_failure') attention from(
   select next_attempt_at,lease_until,status from marketplace_private.notification_deliveries
   where(status in('pending','retryable','sending') and next_attempt_at<=(select n from t))
      or status='permanent_failure' order by next_attempt_at limit 10001)q),
 cases as(
  select count(*) c,min(created_at) oldest from(
   select created_at from marketplace_private.operational_cases
   where review_status<>'resolved' and requires_manual_review
    and(provider_platform=p_platform or provider_platform is null)
   order by created_at limit 10001)q),
 media as(
  select count(*) c,min(expires_at) oldest,count(*) filter(where lease_expires_at<(select n from t)) stale from(
   select expires_at,lease_expires_at from marketplace_private.order_media_batches
   where(state in('preparing','prepared') and expires_at<=(select n from t))
      or(state='delete_claimed' and lease_expires_at<(select n from t))
   order by expires_at limit 10001)q)
 select jsonb_build_object(
  'cap',10000,
  'stripeWebhook',jsonb_build_object('dueCount',least((select c from webhook),10000),'capped',(select c from webhook)>10000,'oldestDueAt',(select oldest from webhook),'staleLeaseCount',(select stale from webhook),'needsAttentionCount',(select exhausted from webhook)),
  'stripeWebhookPurposes',(select coalesce(jsonb_object_agg(purpose,jsonb_build_object(
    'dueCount',c,'oldestDueAt',oldest,'staleLeaseCount',stale,'needsAttentionCount',attention)),'{}'::jsonb)
   from(select purpose,count(*) c,min(next_attempt_at) oldest,
    count(*) filter(where lease_until<(select n from t)) stale,
    count(*) filter(where attempts>=10) attention
    from(select purpose,next_attempt_at,lease_until,attempts from marketplace_private.stripe_webhook_inbox
     where platform=p_platform and mode='test' and status<>'done' and next_attempt_at<=(select n from t)
     order by next_attempt_at limit 10001)z group by purpose)p),
  'paymentReconciliation',jsonb_build_object('dueCount',least((select c from payment),10000),'capped',(select c from payment)>10000,'oldestDueAt',(select oldest from payment),'staleLeaseCount',(select stale from payment),'needsAttentionCount',(select exhausted from payment)),
  'refundOperations',jsonb_build_object('dueCount',least((select c from refund),10000),'capped',(select c from refund)>10000,'oldestDueAt',(select oldest from refund),'staleLeaseCount',(select stale from refund),'needsAttentionCount',(select attention from refund)),
  'transferOperations',jsonb_build_object('dueCount',least((select c from transfer),10000),'capped',(select c from transfer)>10000,'oldestDueAt',(select oldest from transfer),'staleLeaseCount',(select stale from transfer),'needsAttentionCount',(select attention from transfer)),
  'notificationEmail',jsonb_build_object('dueCount',least((select c from email),10000),'capped',(select c from email)>10000,'oldestDueAt',(select oldest from email),'staleLeaseCount',(select stale from email),'needsAttentionCount',(select attention from email)),
  'operationalCases',jsonb_build_object('dueCount',least((select c from cases),10000),'capped',(select c from cases)>10000,'oldestDueAt',(select oldest from cases),'staleLeaseCount',0,'needsAttentionCount',least((select c from cases),10000)),
  'mediaCleanup',jsonb_build_object('dueCount',least((select c from media),10000),'capped',(select c from media)>10000,'oldestDueAt',(select oldest from media),'staleLeaseCount',(select stale from media),'needsAttentionCount',0),
  'shopLifecycle',(select jsonb_build_object('lastRunAt',last_run_at,'staleLeaseCount',case when lease_until<(select n from t) then 1 else 0 end) from marketplace_private.shop_membership_lifecycle_cursor where singleton)
 );
$$;

create function marketplace_private.worker_scheduler_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if to_regclass('cron.job') is null then
  return jsonb_build_object('available',false,'missing',jsonb_build_array(
   'marketplace-v2-transaction-due-work','marketplace-notification-email','marketplace-notification-inbox-retention'));
 end if;
 execute $query$
  with expected(name) as(values
   ('marketplace-v2-transaction-due-work'),('marketplace-notification-email'),
   ('marketplace-notification-inbox-retention')),
  jobs as(select e.name,j.jobid,j.active from expected e left join cron.job j on j.jobname=e.name),
  history as(select * from cron.job_run_details order by start_time desc,runid desc limit 3000),
  receipts as(select j.name,j.active,r.status,r.start_time,r.end_time,
    row_number() over(partition by j.name order by r.start_time desc,r.runid desc) rn,
    max(r.end_time) filter(where r.status='succeeded') over(partition by j.name) last_success
   from jobs j left join history r on r.jobid=j.jobid)
  select jsonb_build_object('available',true,
   'missing',coalesce((select jsonb_agg(name order by name) from jobs where jobid is null or not active),'[]'::jsonb),
   'jobs',coalesce((select jsonb_object_agg(name,jsonb_build_object('active',active,'lastStatus',status,
    'lastStartedAt',start_time,'lastEndedAt',end_time,'lastSuccessfulAt',last_success)) from receipts where rn=1),'{}'::jsonb))
 $query$ into result;
 return result;
exception when undefined_table or insufficient_privilege then
 return jsonb_build_object('available',false,'missing','[]'::jsonb,'error','scheduler_metadata_unavailable');
end;$$;

create function public.marketplace_worker_observability(
 p_action text,p_worker text default null,p_platform text default null,p_token uuid default null,
 p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r marketplace_private.worker_runtime_runs;t timestamptz:=clock_timestamp();keys text[];
 token uuid;run_id uuid;errors text[];phases jsonb;snapshot jsonb;schedulers jsonb;anomalies jsonb:='[]'::jsonb;
 queue_age integer:=900;worker_stale integer:=900;failure_count integer:=3;item record;metric jsonb;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action not in('start','finish','summary') or p_value is null or jsonb_typeof(p_value)<>'object'
  or(p_platform is not null and p_platform !~ '^acct_[A-Za-z0-9]+$') then
  raise exception 'Invalid worker observability request.' using errcode='23514';end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;

 if p_action='start' then
  if p_token is not null or p_worker not in('stripe_worker','notification_email')
   or keys is distinct from array['enabled','stage']::text[]
   or jsonb_typeof(p_value->'enabled')<>'boolean'
   or(p_worker='stripe_worker' and p_platform is null)
   or(p_worker='notification_email' and p_platform is not null)
   or(p_worker='stripe_worker' and p_value->>'stage'<>'dispatch')
   or(p_worker='notification_email' and p_value->>'stage'<>'delivery') then
   raise exception 'Invalid worker start.' using errcode='23514';end if;
  update marketplace_private.worker_runtime_runs set status='interrupted',lease=null,lease_until=null,
   completed_at=t,error_codes=array['lease_expired'],updated_at=t
   where worker_kind=p_worker and status='running' and lease_until<=t;
  run_id:=gen_random_uuid();token:=gen_random_uuid();
  insert into marketplace_private.worker_runtime_runs(
   id,run_key,worker_kind,stage,provider_platform,enabled,status,lease,lease_until)
  values(run_id,gen_random_uuid(),p_worker,p_value->>'stage',p_platform,(p_value->>'enabled')::boolean,
   'running',token,t+interval '10 minutes')
  on conflict(worker_kind) where status='running' do nothing returning * into r;
  if r.id is null then
   insert into marketplace_private.worker_runtime_runs(
    run_key,worker_kind,stage,provider_platform,enabled,status,skipped_due_to_lease,
    started_at,completed_at,created_at,updated_at)
   values(gen_random_uuid(),p_worker,p_value->>'stage',p_platform,(p_value->>'enabled')::boolean,
    'busy',true,t,t,t,t) returning * into r;
   return jsonb_build_object('acquired',false,'status','busy','runId',r.id);
  end if;
  return jsonb_build_object('acquired',true,'runId',r.id,'token',r.lease,'leaseUntil',r.lease_until);
 end if;

 if p_action='finish' then
  if p_worker not in('stripe_worker','notification_email') or p_token is null
   or keys is distinct from array['budgetInterrupted','errorCodes','needsAttentionCount','phases',
    'processedCount','retryCount','skippedDueToLease','status']::text[]
   or p_value->>'status' not in('completed','idle','disabled','busy','degraded','failed')
   or jsonb_typeof(p_value->'phases')<>'object' or octet_length((p_value->'phases')::text)>8192
   or jsonb_typeof(p_value->'errorCodes')<>'array'
   or p_value->>'processedCount' !~ '^[0-9]+$' or p_value->>'retryCount' !~ '^[0-9]+$'
   or p_value->>'needsAttentionCount' !~ '^[0-9]+$'
   or jsonb_typeof(p_value->'skippedDueToLease')<>'boolean'
   or jsonb_typeof(p_value->'budgetInterrupted')<>'boolean' then
   raise exception 'Invalid worker completion.' using errcode='23514';end if;
  select coalesce(array_agg(v),array[]::text[]) into errors from jsonb_array_elements_text(p_value->'errorCodes') x(v);
  if cardinality(errors)>20 or exists(select 1 from unnest(errors)e where e !~ '^[a-z][a-z0-9_]{0,79}$') then
   raise exception 'Invalid worker error classification.' using errcode='23514';end if;
  select * into r from marketplace_private.worker_runtime_runs
   where worker_kind=p_worker and status='running' and lease=p_token for update;
  if r.id is null or r.lease_until<=t or r.provider_platform is distinct from p_platform then
   raise exception 'Stale worker runtime lease.' using errcode='40001';end if;
  update marketplace_private.worker_runtime_runs set status=p_value->>'status',lease=null,lease_until=null,
   processed_count=(p_value->>'processedCount')::integer,retry_count=(p_value->>'retryCount')::integer,
   needs_attention_count=(p_value->>'needsAttentionCount')::integer,
   skipped_due_to_lease=(p_value->>'skippedDueToLease')::boolean,
   budget_interrupted=(p_value->>'budgetInterrupted')::boolean,error_codes=errors,
   phase_results=p_value->'phases',completed_at=t,updated_at=t where id=r.id returning * into r;
  return jsonb_build_object('runId',r.id,'status',r.status,'completedAt',r.completed_at);
 end if;

 if p_worker is not null or p_token is not null or p_platform is null
  or(keys is not null and keys is distinct from array['consecutiveFailures','queueAgeSeconds','workerStaleSeconds']::text[])
  then raise exception 'Invalid worker summary.' using errcode='23514';end if;
 if keys is not null then
  if p_value->>'queueAgeSeconds' !~ '^[0-9]+$' or p_value->>'workerStaleSeconds' !~ '^[0-9]+$'
   or p_value->>'consecutiveFailures' !~ '^[0-9]+$' then raise exception 'Invalid worker thresholds.' using errcode='23514';end if;
  queue_age:=(p_value->>'queueAgeSeconds')::integer;worker_stale:=(p_value->>'workerStaleSeconds')::integer;
  failure_count:=(p_value->>'consecutiveFailures')::integer;
  if queue_age not between 60 and 86400 or worker_stale not between 60 and 86400 or failure_count not between 2 and 10 then
   raise exception 'Invalid worker thresholds.' using errcode='22023';end if;
 end if;
 snapshot:=marketplace_private.worker_queue_snapshot(p_platform);
 for item in select key,value from jsonb_each(snapshot) where key not in('cap','shopLifecycle','stripeWebhookPurposes') loop
  metric:=item.value;
  if coalesce((metric->>'staleLeaseCount')::integer,0)>0 then
   anomalies:=anomalies||jsonb_build_array(jsonb_build_object('key','stale_lease:'||item.key,'kind','stale_lease','queue',item.key));end if;
  if metric->>'oldestDueAt' is not null and (metric->>'oldestDueAt')::timestamptz<t-make_interval(secs=>queue_age) then
   anomalies:=anomalies||jsonb_build_array(jsonb_build_object('key','oldest_due:'||item.key,'kind','oldest_due','queue',item.key));end if;
  if coalesce((metric->>'needsAttentionCount')::integer,0)>0 then
   anomalies:=anomalies||jsonb_build_array(jsonb_build_object('key','manual_review:'||item.key,'kind','manual_review','queue',item.key));end if;
 end loop;
 if coalesce((select (w.phase_results#>>'{shopLifecycle,enabled}')::boolean
   from marketplace_private.worker_runtime_runs w where w.worker_kind='stripe_worker'
   order by w.started_at desc,w.id desc limit 1),false)
  and coalesce((snapshot#>>'{shopLifecycle,lastRunAt}')::timestamptz,'epoch'::timestamptz)
    <t-make_interval(secs=>worker_stale) then
  anomalies:=anomalies||jsonb_build_array(jsonb_build_object(
   'key','shop_lifecycle:stale','kind','shop_lifecycle_delayed','queue','shopLifecycle'));
 end if;
 schedulers:=marketplace_private.worker_scheduler_snapshot();
 for item in select value #>> '{}' name from jsonb_array_elements(coalesce(schedulers->'missing','[]'::jsonb)) loop
  anomalies:=anomalies||jsonb_build_array(jsonb_build_object(
   'key','scheduler_missing:'||item.name,'kind','scheduler_missing','scheduler',item.name));
 end loop;
 for item in
  select w.worker_kind,w.enabled,w.status,w.started_at,
   (select count(*) from(select x.status from marketplace_private.worker_runtime_runs x
    where x.worker_kind=w.worker_kind order by x.started_at desc limit failure_count)y
    where y.status in('degraded','failed','interrupted')) failures
  from(select distinct on(worker_kind) * from marketplace_private.worker_runtime_runs order by worker_kind,started_at desc,id desc)w
 loop
  if item.enabled and item.status<>'disabled' and item.started_at<t-make_interval(secs=>worker_stale)
   and not exists(select 1 from marketplace_private.worker_runtime_runs s where s.worker_kind=item.worker_kind
    and s.status in('completed','idle') and s.completed_at>=t-make_interval(secs=>worker_stale)) then
   anomalies:=anomalies||jsonb_build_array(jsonb_build_object('key','worker_stale:'||item.worker_kind,'kind','worker_stale','worker',item.worker_kind));end if;
  if item.enabled and item.failures>=failure_count then
   anomalies:=anomalies||jsonb_build_array(jsonb_build_object('key','worker_failures:'||item.worker_kind,'kind','consecutive_failures','worker',item.worker_kind));end if;
 end loop;
 return jsonb_build_object('generatedAt',t,'thresholds',jsonb_build_object(
   'queueAgeSeconds',queue_age,'workerStaleSeconds',worker_stale,'consecutiveFailures',failure_count),
  'queues',snapshot,'schedulers',schedulers,'anomalies',anomalies,
  'runs',(select coalesce(jsonb_object_agg(worker_kind,to_jsonb(x)-'worker_kind'),'{}'::jsonb) from(
    select distinct on(worker_kind) worker_kind,status,enabled,started_at "startedAt",completed_at "completedAt",
     case when completed_at is null then null else floor(extract(epoch from(completed_at-started_at))*1000)::bigint end "durationMs",
     (select max(s.completed_at) from marketplace_private.worker_runtime_runs s
       where s.worker_kind=w.worker_kind and s.status in('completed','idle')) "lastSuccessfulAt",
     processed_count "processedCount",retry_count "retryCount",needs_attention_count "needsAttentionCount",
     error_codes "errorCodes" from marketplace_private.worker_runtime_runs w order by worker_kind,started_at desc,id desc)x));
end;$$;

-- The previous wrapper ignored the Edge response status. A non-2xx result must
-- make the pg_cron receipt fail, while keeping response bodies out of errors.
create or replace function marketplace_private.invoke_email_worker() returns void
language plpgsql security definer set search_path='' as $$
declare result jsonb;status integer;
begin
 result:=marketplace_private.call_email_worker('{}'::jsonb);
 status:=coalesce((result->>'status')::integer,0);
 if status<200 or status>=300 then
  raise exception 'Notification email worker returned a non-success status.' using errcode='P0001';
 end if;
end;$$;

revoke all on function marketplace_private.protect_worker_runtime_run(),
 marketplace_private.worker_queue_snapshot(text),marketplace_private.worker_scheduler_snapshot()
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_worker_observability(text,text,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_worker_observability(text,text,text,uuid,jsonb) to service_role;
revoke all on function marketplace_private.invoke_email_worker() from public,anon,authenticated,service_role;

commit;

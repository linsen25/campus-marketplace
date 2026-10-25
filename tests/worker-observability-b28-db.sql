-- B28-B observability contract in the disposable full migration-chain database.
select public.b14_assert(
 not has_table_privilege('anon','marketplace_private.worker_runtime_runs','select')
 and not has_table_privilege('authenticated','marketplace_private.worker_runtime_runs','select')
 and not has_table_privilege('service_role','marketplace_private.worker_runtime_runs','select')
 and not has_function_privilege('anon','public.marketplace_worker_observability(text,text,text,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.marketplace_worker_observability(text,text,text,uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.marketplace_worker_observability(text,text,text,uuid,jsonb)','execute'),
 'B28 worker audit is private and service-role RPC only');

select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false);

do $$declare first jsonb;busy jsonb;done jsonb;stale uuid;replacement jsonb;
begin
 first:=public.marketplace_worker_observability('start','notification_email',null,null,
  '{"enabled":false,"stage":"delivery"}'::jsonb);
 perform public.b14_assert((first->>'acquired')::boolean,'first Worker lease acquired');
 busy:=public.marketplace_worker_observability('start','notification_email',null,null,
  '{"enabled":false,"stage":"delivery"}'::jsonb);
 perform public.b14_assert(not(busy->>'acquired')::boolean and busy->>'status'='busy','concurrent Worker is busy');
 done:=public.marketplace_worker_observability('finish','notification_email',null,(first->>'token')::uuid,
  '{"status":"disabled","processedCount":0,"retryCount":0,"needsAttentionCount":0,"skippedDueToLease":false,"budgetInterrupted":false,"errorCodes":[],"phases":{"delivery":{"status":"disabled"}}}'::jsonb);
 perform public.b14_assert(done->>'status'='disabled','disabled is an explicit terminal receipt');

 first:=public.marketplace_worker_observability('start','notification_email',null,null,
  '{"enabled":true,"stage":"delivery"}'::jsonb);stale:=(first->>'token')::uuid;
 update marketplace_private.worker_runtime_runs set lease_until=clock_timestamp()-interval '1 second'
  where lease=stale;
 replacement:=public.marketplace_worker_observability('start','notification_email',null,null,
  '{"enabled":true,"stage":"delivery"}'::jsonb);
 perform public.b14_assert((replacement->>'acquired')::boolean
  and exists(select 1 from marketplace_private.worker_runtime_runs where status='interrupted' and error_codes=array['lease_expired']),
  'expired crash lease records interruption and is recoverable');
 begin
  perform public.marketplace_worker_observability('finish','notification_email',null,stale,
   '{"status":"completed","processedCount":1,"retryCount":0,"needsAttentionCount":0,"skippedDueToLease":false,"budgetInterrupted":false,"errorCodes":[],"phases":{}}'::jsonb);
  raise exception 'stale token unexpectedly accepted';
 exception when serialization_failure then null;end;
 perform public.marketplace_worker_observability('finish','notification_email',null,(replacement->>'token')::uuid,
  '{"status":"failed","processedCount":0,"retryCount":1,"needsAttentionCount":1,"skippedDueToLease":false,"budgetInterrupted":false,"errorCodes":["provider_unavailable"],"phases":{"delivery":{"sent":0,"failed":1}}}'::jsonb);
end$$;

insert into marketplace_private.notification_deliveries(notification_identity,status,next_attempt_at)
values(gen_random_uuid(),'pending',clock_timestamp()-interval '10 minutes'),
 (gen_random_uuid(),'pending',clock_timestamp()+interval '1 day'),
 (gen_random_uuid(),'permanent_failure',clock_timestamp()-interval '1 hour');

do $$declare a jsonb;b jsonb;queues jsonb;
begin
 a:=public.marketplace_worker_observability('summary',null,'acct_TestPlatform',null,
  '{"queueAgeSeconds":60,"workerStaleSeconds":60,"consecutiveFailures":2}'::jsonb);
 b:=public.marketplace_worker_observability('summary',null,'acct_TestPlatform',null,
  '{"queueAgeSeconds":60,"workerStaleSeconds":60,"consecutiveFailures":2}'::jsonb);
 queues:=a->'queues';
 perform public.b14_assert((queues#>>'{notificationEmail,dueCount}')::integer=2,
  'future email is excluded while due and permanent failure are visible');
 perform public.b14_assert(a->'anomalies'=b->'anomalies','same facts produce stable logical anomaly identities');
 perform public.b14_assert(not(a->'anomalies' @> '[{"key":"worker_stale:notification_email"}]'::jsonb),
  'disabled run does not create a false stale-worker anomaly');
 perform public.b14_assert((a#>>'{queues,cap}')::integer=10000,'queue monitoring exposes its hard cap');
end$$;

do $$begin
 update marketplace_private.worker_runtime_runs set processed_count=999 where status='failed';
 raise exception 'terminal Worker audit unexpectedly mutable';
exception when check_violation then null;end$$;

select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claims','{"role":"authenticated","ref":"pcaqxezdfxofysghssyo"}',false);
do $$begin
 perform public.marketplace_worker_observability('summary',null,'acct_TestPlatform',null,'{}'::jsonb);
 raise exception 'authenticated Worker summary unexpectedly permitted';
exception when insufficient_privilege then null;end$$;

select set_config('request.jwt.claim.role','',false);
select set_config('request.jwt.claims','{}',false);

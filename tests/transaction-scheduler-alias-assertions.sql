-- Run only inside the isolated local fixture created by the companion harness.
create temporary table scheduler_result as
select marketplace_private.run_transaction_due_work() as result;
select marketplace_private.test_assert(
 (select result->>'ordersChecked'='2' and result ? 'serverTime' from scheduler_result),
 'distinct held V2 open Listing scan and response preserved');
select marketplace_private.test_assert(
 (select count(*)=1 and min(target::text)='10000000-0000-4000-8000-000000000001'
  from marketplace_private.test_calls where operation='expire'),
 'only due active V2 Meeting Offer conversation expires');
select marketplace_private.test_assert(
 (select string_agg(operation,',' order by sequence)='delivery,meetup,protection,delivery,meetup,protection'
  from marketplace_private.test_calls where operation in('delivery','meetup','protection')),
 'downstream settlement invocation order preserved');
select marketplace_private.test_assert(
 (select array_agg(identity order by identity)=array['claim-ok','meet-latest','payment-processing']
  from marketplace_private.notification_reminders where delivered_at is not null),
 'latest revision, unstarted claim and processing payment reminders delivered');
select marketplace_private.test_assert(
 (select array_agg(identity order by identity)=array['claim-started','completed','external-started','meet-stale']
  from marketplace_private.notification_reminders where suppressed_at is not null),
 'stale revision, started claim, completed and external-started reminders suppressed');
select marketplace_private.test_assert(
 (select delivered_at is null and suppressed_at is null
  from marketplace_private.notification_reminders where identity='future'),
 'future reminder untouched');
select marketplace_private.test_assert(
 (select count(*)=3 from marketplace_private.notification_events)
 and (select count(*)=3 from marketplace_private.test_calls where operation='notify'),
 'one event and notification call per eligible reminder');
-- Already-delivered/suppressed reminders must not emit duplicates on repeat runs.
select marketplace_private.run_transaction_due_work();
select marketplace_private.test_assert(
 (select count(*)=3 from marketplace_private.notification_events)
 and (select count(*)=3 from marketplace_private.test_calls where operation='notify'),
 'retry does not duplicate reminder events or deliveries');
select marketplace_private.test_assert(
 not has_function_privilege('anon','marketplace_private.run_transaction_due_work()','EXECUTE')
 and not has_function_privilege('authenticated','marketplace_private.run_transaction_due_work()','EXECUTE')
 and not has_function_privilege('service_role','marketplace_private.run_transaction_due_work()','EXECUTE'),
 'CREATE OR REPLACE preserves existing private scheduler ACL');
select marketplace_private.test_assert(
 (select prosecdef and proconfig=array['search_path=""']
  from pg_proc where oid='marketplace_private.run_transaction_due_work()'::regprocedure),
 'SECURITY DEFINER and empty search_path preserved');

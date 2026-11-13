-- B25-C: bounded operational recovery run fencing, audit and case rescan.
-- This migration cannot create or resolve a financial provider operation.
begin;

alter table marketplace_private.stripe_webhook_inbox
 drop constraint stripe_webhook_inbox_error_code_check;
alter table marketplace_private.stripe_webhook_inbox
 add constraint stripe_webhook_inbox_error_code_check
  check(error_code is null or error_code in('reconcile_failed','binding_not_ready','provider_mismatch','late_payment_review','retry_exhausted'));

alter table marketplace_private.operational_cases
 drop constraint operational_cases_source_kind_check,
 drop constraint operational_cases_category_check;
alter table marketplace_private.operational_cases
 add constraint operational_cases_source_kind_check check(source_kind in(
  'uu_protection','stripe_dispute','payment_exception','refund_exception','transfer_exception',
  'payout_exception','provider_event_exception')),
 add constraint operational_cases_category_check check(category in(
  'internal_protection','provider_dispute','payment_reconciliation','refund_reconciliation',
  'transfer_reconciliation','payout_reconciliation','provider_event_reconciliation'));
alter table marketplace_private.operational_case_evidence_refs
 drop constraint operational_case_evidence_refs_evidence_kind_check;
alter table marketplace_private.operational_case_evidence_refs
 add constraint operational_case_evidence_refs_evidence_kind_check check(evidence_kind in(
  'order','transaction_history','protection_case','payment_attempt','stripe_dispute',
  'refund_operation','transfer_operation','payout_observation','provider_event_exception'));

create table marketplace_private.operational_provider_event_exceptions (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 account_scope text not null check(account_scope ~ '^acct_[A-Za-z0-9]+$'),
 event_id text not null check(event_id ~ '^evt_[A-Za-z0-9]+$'),
 purpose text not null check(purpose in(
  'marketplace_order','marketplace_order_refund','marketplace_order_transfer','connected_payout','marketplace_dispute')),
 provider_object_ref text not null check(provider_object_ref ~ '^(pi|re|tr|po|du)_[A-Za-z0-9]+$'),
 attempts integer not null check(attempts>=10),
 error_code text not null check(error_code='retry_exhausted'),
 observed_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 unique(provider_platform,provider_mode,account_scope,event_id)
);
alter table marketplace_private.operational_provider_event_exceptions enable row level security;
revoke all on marketplace_private.operational_provider_event_exceptions from public,anon,authenticated,service_role;

create function marketplace_private.protect_operational_provider_event_exception() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['attempts','observed_at']) is distinct from(to_jsonb(old)-array['attempts','observed_at'])
  or new.attempts<old.attempts or new.observed_at<old.observed_at then
  raise exception 'Provider event exception binding is immutable.' using errcode='23514';end if;
 return new;
end;$$;
create trigger operational_provider_event_exception_immutable before update or delete
 on marketplace_private.operational_provider_event_exceptions for each row
 execute function marketplace_private.protect_operational_provider_event_exception();

create function marketplace_private.capture_exhausted_provider_events(p_platform text,p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;x marketplace_private.operational_provider_event_exceptions;
 c marketplace_private.operational_cases;t timestamptz:=clock_timestamp();captured integer:=0;
begin
 if p_platform !~ '^acct_[A-Za-z0-9]+$' or p_limit not between 1 and 50 then
  raise exception 'Invalid exhausted event scan.' using errcode='23514';end if;
 for e in select * from marketplace_private.stripe_webhook_inbox
  where platform=p_platform and mode='test' and purpose<>'account_setup' and status in('pending','processing')
   and attempts>=10 and next_attempt_at<=t and(lease_until is null or lease_until<t)
  order by next_attempt_at,received_at,event_id for update skip locked limit p_limit
 loop
  insert into marketplace_private.operational_provider_event_exceptions(
   provider,provider_mode,provider_platform,account_scope,event_id,purpose,provider_object_ref,attempts,error_code,observed_at)
  values('stripe','test',e.platform,e.account_scope,e.event_id,e.purpose,e.provider_ref,e.attempts,'retry_exhausted',t)
  on conflict(provider_platform,provider_mode,account_scope,event_id) do update set
   attempts=greatest(marketplace_private.operational_provider_event_exceptions.attempts,excluded.attempts),
   observed_at=greatest(marketplace_private.operational_provider_event_exceptions.observed_at,excluded.observed_at)
  returning * into x;
  update marketplace_private.stripe_webhook_inbox set status='done',lease=null,lease_until=null,
   processed_at=t,error_code='retry_exhausted' where platform=e.platform and mode=e.mode
    and account_scope=e.account_scope and event_id=e.event_id;
  insert into marketplace_private.operational_cases(source_kind,source_id,provider,provider_mode,provider_platform,
   provider_object_ref,category,risk_level,priority,hold_projection,release_projection,source_status,source_observed_at)
  values('provider_event_exception',x.id,'stripe','test',x.provider_platform,x.provider_object_ref,
   'provider_event_reconciliation','high',85,'unknown','unknown','retry_exhausted:'||x.purpose,x.observed_at)
  on conflict(source_kind,source_id) do nothing returning * into c;
  if c.id is null then select * into c from marketplace_private.operational_cases
   where source_kind='provider_event_exception' and source_id=x.id;end if;
  insert into marketplace_private.operational_case_evidence_refs(case_id,evidence_kind,reference_id,source_observed_at)
  values(c.id,'provider_event_exception',x.id,x.observed_at) on conflict do nothing;
  insert into marketplace_private.operational_case_audit(
   case_id,case_version,actor_kind,actor_subject,action,action_result,source_event_key)
  values(c.id,c.version,'system_service','database_trigger','case_created','applied',c.id::text||':'||c.version::text)
  on conflict do nothing;
  captured:=captured+1;
 end loop;
 return captured;
end;$$;

create table marketplace_private.operational_recovery_runs (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 run_key uuid not null unique,
 status text not null check(status in('running','completed','degraded','crashed')),
 lease uuid,
 lease_until timestamptz,
 step_results jsonb not null default '{}'::jsonb
  check(jsonb_typeof(step_results)='object' and octet_length(step_results::text)<=8192),
 error_codes text[] not null default '{}'::text[]
  check(error_codes <@ array[
   'setup_failed','order_payments_failed','order_disputes_failed','order_refunds_failed',
   'order_transfers_failed','connected_payouts_failed','case_sweep_failed','lease_expired']::text[]),
 started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='running' and lease is not null and lease_until is not null and completed_at is null)
  or(status<>'running' and lease is null and lease_until is null and completed_at is not null)),
 check(updated_at>=created_at and(completed_at is null or completed_at>=started_at))
);
alter table marketplace_private.operational_recovery_runs enable row level security;
revoke all on marketplace_private.operational_recovery_runs from public,anon,authenticated,service_role;
create unique index operational_recovery_one_running_idx
 on marketplace_private.operational_recovery_runs(provider_platform,provider_mode) where status='running';
create index operational_recovery_history_idx
 on marketplace_private.operational_recovery_runs(provider_platform,provider_mode,started_at desc,id);

create function marketplace_private.protect_operational_recovery_run() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['status','lease','lease_until','step_results','error_codes','completed_at','updated_at'])
   is distinct from
  (to_jsonb(old)-array['status','lease','lease_until','step_results','error_codes','completed_at','updated_at'])
  or old.status<>'running' then
  raise exception 'Operational recovery audit is immutable.' using errcode='23514';end if;
 return new;
end;$$;
create trigger operational_recovery_run_immutable before update or delete
 on marketplace_private.operational_recovery_runs for each row
 execute function marketplace_private.protect_operational_recovery_run();

create function public.marketplace_operational_recovery(
 p_action text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r marketplace_private.operational_recovery_runs;t timestamptz:=clock_timestamp();
 keys text[];errors text[];lim integer;item record;synced integer:=0;captured integer:=0;run_id uuid;token uuid;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action not in('start','sweep','finish','summary') or p_platform !~ '^acct_[A-Za-z0-9]+$'
  or p_value is null or jsonb_typeof(p_value)<>'object' then
  raise exception 'Invalid operational recovery request.' using errcode='23514';end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_value) k;

 if p_action='start' then
  if p_token is not null or keys is not null then raise exception 'Invalid recovery start.' using errcode='23514';end if;
  update marketplace_private.operational_recovery_runs set status='crashed',lease=null,lease_until=null,
   completed_at=t,error_codes=array['lease_expired']::text[],updated_at=t
   where provider_platform=p_platform and provider_mode='test' and status='running' and lease_until<=t;
  run_id:=gen_random_uuid();token:=gen_random_uuid();
  insert into marketplace_private.operational_recovery_runs(
   id,provider,provider_mode,provider_platform,run_key,status,lease,lease_until)
  values(run_id,'stripe','test',p_platform,gen_random_uuid(),'running',token,t+interval '5 minutes')
  on conflict(provider_platform,provider_mode) where status='running' do nothing returning * into r;
  if r.id is null then return jsonb_build_object('acquired',false);end if;
  return jsonb_build_object('acquired',true,'runId',r.id,'token',r.lease,'leaseUntil',r.lease_until);
 end if;

 if p_action='summary' then
  if p_token is not null or keys is not null then raise exception 'Invalid recovery summary.' using errcode='23514';end if;
  return jsonb_build_object(
   'unresolvedCases',(select count(*) from marketplace_private.operational_cases c
    where c.review_status<>'resolved' and(c.provider_platform=p_platform or c.provider_platform is null)),
   'manualReviewCases',(select count(*) from marketplace_private.operational_cases c
    where c.review_status<>'resolved' and c.requires_manual_review
     and(c.provider_platform=p_platform or c.provider_platform is null)),
   'blockedOrders',(select count(distinct c.order_id) from marketplace_private.operational_cases c
    where c.review_status<>'resolved' and c.hold_projection='active' and c.order_id is not null
     and(c.provider_platform=p_platform or c.provider_platform is null)),
   'overduePayments',(select count(*) from marketplace_private.campus_payment_attempts a
    where a.provider='stripe' and a.provider_mode='test' and a.provider_platform=p_platform
     and a.provider_purpose='marketplace_order' and a.status='processing'
     and coalesce(a.provider_reconcile_after,a.provider_bound_at,a.provider_create_started_at)<=t),
   'overdueRefunds',(select count(*) from marketplace_private.order_refund_operations o
    where o.provider_platform=p_platform and o.provider_mode='test' and o.state in('prepared','in_flight','reconciling')
     and o.next_reconcile_at<=t and(o.lease_until is null or o.lease_until<t)),
   'overdueTransfers',(select count(*) from marketplace_private.order_transfer_operations o
    where o.provider_platform=p_platform and o.provider_mode='test' and o.state in('prepared','in_flight','reconciling')
     and o.next_reconcile_at<=t and(o.lease_until is null or o.lease_until<t)),
   'pendingProviderEvents',(select count(*) from marketplace_private.stripe_webhook_inbox i
    where i.platform=p_platform and i.mode='test' and i.purpose<>'account_setup' and i.status<>'done'
     and i.next_attempt_at<=t and(i.lease_until is null or i.lease_until<t)),
   'lastRun',(select jsonb_build_object('id',x.id,'status',x.status,'startedAt',x.started_at,
     'completedAt',x.completed_at,'errorCodes',x.error_codes)
    from marketplace_private.operational_recovery_runs x where x.provider_platform=p_platform
     and x.provider_mode='test' order by x.started_at desc,x.id desc limit 1));
 end if;

 select * into r from marketplace_private.operational_recovery_runs
  where provider_platform=p_platform and provider_mode='test' and status='running' and lease=p_token for update;
 if r.id is null or r.lease_until<=t then raise exception 'Stale operational recovery lease.' using errcode='40001';end if;

 if p_action='sweep' then
  if keys is distinct from array['limit']::text[] or p_value->>'limit' !~ '^[0-9]+$' then
   raise exception 'Invalid recovery sweep.' using errcode='23514';end if;
  lim:=(p_value->>'limit')::integer;
  if lim not between 1 and 50 then raise exception 'Invalid recovery sweep limit.' using errcode='22023';end if;
  captured:=marketplace_private.capture_exhausted_provider_events(p_platform,lim);
  for item in
   select q.kind,q.id from(
    select 'payment_exception'::text kind,a.id,coalesce(a.provider_observed_at,a.finished_at,a.started_at) observed
     from marketplace_private.campus_payment_attempts a where a.provider_platform=p_platform and a.provider_mode='test'
      and(a.provider_reconcile_state='exception' or a.provider_exception_code is not null
       or(a.status='processing' and((a.provider_reference is null and a.provider_create_started_at<=t-interval '20 hours')
        or(a.provider_reference is not null and a.provider_reconcile_attempts>=10))))
    union all select 'refund_exception',o.id,o.updated_at from marketplace_private.order_refund_operations o
     where o.provider_platform=p_platform and o.provider_mode='test'
      and(o.state in('failed','exception') or o.last_error_code is not null)
    union all select 'transfer_exception',o.id,o.updated_at from marketplace_private.order_transfer_operations o
     where o.provider_platform=p_platform and o.provider_mode='test'
      and(o.state in('failed','exception') or o.last_error_code is not null)
    union all select 'payout_exception',o.id,o.provider_observed_at from marketplace_private.connected_payout_observations o
     where o.provider_platform=p_platform and o.provider_mode='test' and o.provider_status in('failed','canceled')
    union all select 'stripe_dispute',o.id,o.provider_observed_at from marketplace_private.stripe_dispute_observations o
     where o.provider_platform=p_platform and o.provider_mode='test'
   )q order by q.observed nulls first,q.kind,q.id limit lim
  loop
   perform marketplace_private.sync_operational_case(item.kind,item.id);synced:=synced+1;
  end loop;
  return jsonb_build_object('runId',r.id,'synced',synced,'captured',captured,'limit',lim);
 end if;

 if keys is distinct from array['errors','status','steps']::text[]
  or p_value->>'status' not in('completed','degraded') or jsonb_typeof(p_value->'steps')<>'object'
  or octet_length((p_value->'steps')::text)>8192 or jsonb_typeof(p_value->'errors')<>'array' then
  raise exception 'Invalid recovery completion.' using errcode='23514';end if;
 select coalesce(array_agg(v),array[]::text[]) into errors from jsonb_array_elements_text(p_value->'errors') x(v);
 if not(errors <@ array[
  'setup_failed','order_payments_failed','order_disputes_failed','order_refunds_failed',
  'order_transfers_failed','connected_payouts_failed','case_sweep_failed']::text[]) then
  raise exception 'Invalid recovery errors.' using errcode='23514';end if;
 update marketplace_private.operational_recovery_runs set status=p_value->>'status',lease=null,lease_until=null,
  step_results=p_value->'steps',error_codes=errors,completed_at=t,updated_at=t where id=r.id returning * into r;
 return jsonb_build_object('runId',r.id,'status',r.status,'completedAt',r.completed_at);
end;$$;

revoke all on function marketplace_private.protect_operational_recovery_run() from public,anon,authenticated,service_role;
revoke all on function marketplace_private.protect_operational_provider_event_exception()
 from public,anon,authenticated,service_role;
revoke all on function marketplace_private.capture_exhausted_provider_events(text,integer)
 from public,anon,authenticated,service_role;
revoke all on function public.marketplace_operational_recovery(text,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_operational_recovery(text,text,uuid,jsonb) to service_role;

commit;

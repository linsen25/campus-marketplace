-- B25-B: private operational case index, minimal evidence references and immutable audit.
-- Human reviewer authority and every financial action remain deliberately unavailable.
begin;

create table marketplace_private.operational_cases (
 id uuid primary key default gen_random_uuid(),
 source_kind text not null check(source_kind in(
  'uu_protection','stripe_dispute','payment_exception','refund_exception','transfer_exception','payout_exception')),
 source_id uuid not null,
 order_id uuid references public.orders(id) on delete restrict,
 payment_attempt_id uuid references marketplace_private.campus_payment_attempts(id) on delete restrict,
 provider text check(provider is null or provider='stripe'),
 provider_mode text check(provider_mode is null or provider_mode='test'),
 provider_platform text check(provider_platform is null or provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 provider_object_ref text check(provider_object_ref is null or provider_object_ref ~ '^(du|pi|re|tr|po)_[A-Za-z0-9]+$'),
 category text not null check(category in(
  'internal_protection','provider_dispute','payment_reconciliation','refund_reconciliation',
  'transfer_reconciliation','payout_reconciliation')),
 risk_level text not null check(risk_level in('medium','high','critical')),
 priority integer not null check(priority between 1 and 100),
 review_status text not null default 'open' check(review_status in(
  'open','under_review','awaiting_evidence','blocked_policy','resolved')),
 response_due_at timestamptz,
 hold_projection text not null check(hold_projection in('active','inactive','unknown','not_applicable')),
 release_projection text not null check(release_projection in('blocked','existing_rules_only','unknown','not_applicable')),
 source_status text not null check(length(source_status) between 1 and 100 and source_status ~ '^[a-z0-9_:]+$'),
 source_observed_at timestamptz not null,
 requires_manual_review boolean not null default true check(requires_manual_review),
 version integer not null default 1 check(version>=1),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(source_kind,source_id),
 check((provider is null)=(provider_mode is null)),
 check((provider is null)=(provider_platform is null)),
 check((source_kind='uu_protection' and provider is null and provider_object_ref is null)
  or(source_kind<>'uu_protection' and provider='stripe' and provider_mode='test')),
 check(updated_at>=created_at)
);
alter table marketplace_private.operational_cases enable row level security;
revoke all on marketplace_private.operational_cases from public,anon,authenticated,service_role;
create index operational_cases_worklist_idx
 on marketplace_private.operational_cases(review_status,priority desc,response_due_at nulls last,created_at,id);
create index operational_cases_order_idx on marketplace_private.operational_cases(order_id,created_at,id)
 where order_id is not null;

create table marketplace_private.operational_case_evidence_refs (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references marketplace_private.operational_cases(id) on delete restrict,
 evidence_kind text not null check(evidence_kind in(
  'order','transaction_history','protection_case','payment_attempt','stripe_dispute',
  'refund_operation','transfer_operation','payout_observation')),
 reference_id uuid not null,
 source_observed_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(case_id,evidence_kind,reference_id)
);
alter table marketplace_private.operational_case_evidence_refs enable row level security;
revoke all on marketplace_private.operational_case_evidence_refs from public,anon,authenticated,service_role;

create table marketplace_private.operational_case_audit (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references marketplace_private.operational_cases(id) on delete restrict,
 case_version integer not null check(case_version>=1),
 actor_kind text not null check(actor_kind in('system_service','human_operator')),
 actor_user_id uuid,
 actor_subject text not null check(actor_subject in('database_trigger','trusted_worker','approved_operator')),
 action text not null check(action in('case_created','source_refreshed','review_transition')),
 action_result text not null check(action_result in('applied','denied','conflict')),
 source_event_key text not null check(length(source_event_key) between 1 and 200),
 created_at timestamptz not null default clock_timestamp(),
 unique(case_id,case_version),unique(source_event_key),
 check((actor_kind='system_service' and actor_user_id is null and actor_subject<>'approved_operator')
  or(actor_kind='human_operator' and actor_user_id is not null and actor_subject='approved_operator'))
);
alter table marketplace_private.operational_case_audit enable row level security;
revoke all on marketplace_private.operational_case_audit from public,anon,authenticated,service_role;

create function marketplace_private.protect_operational_case() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['risk_level','priority','response_due_at','hold_projection','release_projection',
   'source_status','source_observed_at','version','updated_at']) is distinct from
  (to_jsonb(old)-array['risk_level','priority','response_due_at','hold_projection','release_projection',
   'source_status','source_observed_at','version','updated_at'])
  or new.review_status is distinct from old.review_status
  or new.version<>old.version+1 then
  raise exception 'Operational case binding and review authority are immutable.' using errcode='23514';end if;
 return new;
end;$$;
create trigger operational_case_protected before update or delete
 on marketplace_private.operational_cases for each row execute function marketplace_private.protect_operational_case();

create function marketplace_private.protect_operational_case_history() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op in('UPDATE','DELETE') then
  raise exception 'Operational case evidence and audit are append-only.' using errcode='23514';end if;
 return new;
end;$$;
create trigger operational_case_evidence_append_only before update or delete
 on marketplace_private.operational_case_evidence_refs for each row
 execute function marketplace_private.protect_operational_case_history();
create trigger operational_case_audit_append_only before update or delete
 on marketplace_private.operational_case_audit for each row
 execute function marketplace_private.protect_operational_case_history();

create function marketplace_private.sync_operational_case(p_source_kind text,p_source_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare pc marketplace_private.protection_cases;d marketplace_private.stripe_dispute_observations;
 a marketplace_private.campus_payment_attempts;rr marketplace_private.order_refund_operations;
 tr marketplace_private.order_transfer_operations;po marketplace_private.connected_payout_observations;
 c marketplace_private.operational_cases;t timestamptz:=clock_timestamp();created boolean:=false;
 order_key uuid;attempt_key uuid;provider_key text;mode_key text;platform_key text;object_key text;
 category_key text;risk_key text;priority_key integer;deadline_key timestamptz;hold_key text;release_key text;
 status_key text;observed_key timestamptz;changed boolean:=false;had_case boolean:=false;
begin
 if p_source_id is null or p_source_kind not in(
  'uu_protection','stripe_dispute','payment_exception','refund_exception','transfer_exception','payout_exception') then
  raise exception 'Invalid operational case source.' using errcode='23514';end if;
 select exists(select 1 from marketplace_private.operational_cases
  where source_kind=p_source_kind and source_id=p_source_id) into had_case;
 if p_source_kind='uu_protection' then
  select * into pc from marketplace_private.protection_cases where id=p_source_id;
  if pc.id is null then raise exception 'Protection case unavailable.' using errcode='P0002';end if;
  order_key:=pc.order_id;category_key:='internal_protection';risk_key:='high';priority_key:=80;
  status_key:=pc.state;observed_key:=pc.opened_at;hold_key:='active';release_key:='blocked';
 elsif p_source_kind='stripe_dispute' then
  select * into d from marketplace_private.stripe_dispute_observations where id=p_source_id;
  if d.id is null then raise exception 'Stripe Dispute observation unavailable.' using errcode='P0002';end if;
  order_key:=d.order_id;attempt_key:=d.payment_attempt_id;provider_key:=d.provider;mode_key:=d.provider_mode;
  platform_key:=d.provider_platform;object_key:=d.dispute_ref;category_key:='provider_dispute';
  risk_key:=case when d.reconciliation_state='attributed' then 'critical' else 'high' end;
  priority_key:=case when d.response_due_at is not null then 95 else 90 end;deadline_key:=d.response_due_at;
  status_key:=d.provider_status||':'||d.reconciliation_state;observed_key:=d.provider_observed_at;
  hold_key:=case when d.blocks_new_financial_operations then 'active' else 'unknown' end;
  release_key:=case when d.blocks_new_financial_operations then 'blocked' else 'unknown' end;
 elsif p_source_kind='payment_exception' then
  select * into a from marketplace_private.campus_payment_attempts where id=p_source_id;
  if a.id is null then raise exception 'Payment attempt unavailable.' using errcode='P0002';end if;
  if a.provider_reconcile_state is distinct from 'exception' and a.provider_exception_code is null
   and not(a.status='processing' and((a.provider_reference is null
    and a.provider_create_started_at<=t-interval '20 hours')
    or(a.provider_reference is not null and a.provider_reconcile_attempts>=10))) and not had_case then return null;end if;
  order_key:=a.order_id;attempt_key:=a.id;provider_key:=a.provider;mode_key:=a.provider_mode;
  platform_key:=a.provider_platform;object_key:=a.provider_reference;category_key:='payment_reconciliation';
  risk_key:=case when a.provider_reconcile_state='exception' or a.provider_exception_code is not null
   or(a.status='processing' and((a.provider_reference is null
    and a.provider_create_started_at<=t-interval '20 hours')
    or(a.provider_reference is not null and a.provider_reconcile_attempts>=10))) then 'critical' else 'medium' end;
  priority_key:=case when risk_key='critical' then 95 else 60 end;
  status_key:=case when a.provider_reconcile_state is distinct from 'exception' and a.provider_exception_code is null
   and a.status='processing' and a.provider_reference is null
    and a.provider_create_started_at<=t-interval '20 hours' then 'recovery_exhausted:unbound'
   when a.provider_reconcile_state is distinct from 'exception' and a.provider_exception_code is null
    and a.status='processing' and a.provider_reference is not null and a.provider_reconcile_attempts>=10
    then 'recovery_exhausted:bound'
   else coalesce(a.provider_reconcile_state,'unknown')||':'||coalesce(a.provider_exception_code,'none') end;
  observed_key:=coalesce(a.provider_observed_at,a.finished_at,a.started_at);
  hold_key:=case when risk_key='critical' then 'active' else 'unknown' end;
  release_key:=case when risk_key='critical' then 'blocked' else 'existing_rules_only' end;
 elsif p_source_kind='refund_exception' then
  select * into rr from marketplace_private.order_refund_operations where id=p_source_id;
  if rr.id is null then raise exception 'Refund operation unavailable.' using errcode='P0002';end if;
  if rr.state not in('failed','exception') and rr.last_error_code is null and not had_case then return null;end if;
  order_key:=rr.order_id;attempt_key:=rr.payment_attempt_id;provider_key:=rr.provider;mode_key:=rr.provider_mode;
  platform_key:=rr.provider_platform;object_key:=coalesce(rr.refund_ref,rr.payment_intent_ref);
  category_key:='refund_reconciliation';
  risk_key:=case when rr.state in('failed','exception') or rr.last_error_code is not null then 'critical' else 'medium' end;
  priority_key:=case when risk_key='critical' then 95 else 60 end;
  status_key:=rr.state||':'||coalesce(rr.last_error_code,'provider_state');observed_key:=rr.updated_at;
  hold_key:=case when risk_key='critical' then 'active' else 'unknown' end;
  release_key:=case when risk_key='critical' then 'blocked' else 'existing_rules_only' end;
 elsif p_source_kind='transfer_exception' then
  select * into tr from marketplace_private.order_transfer_operations where id=p_source_id;
  if tr.id is null then raise exception 'Transfer operation unavailable.' using errcode='P0002';end if;
  if tr.state not in('failed','exception') and tr.last_error_code is null and not had_case then return null;end if;
  order_key:=tr.order_id;attempt_key:=tr.payment_attempt_id;provider_key:=tr.provider;mode_key:=tr.provider_mode;
  platform_key:=tr.provider_platform;object_key:=coalesce(tr.transfer_ref,tr.payment_intent_ref);
  category_key:='transfer_reconciliation';
  risk_key:=case when tr.state in('failed','exception') or tr.last_error_code is not null then 'critical' else 'medium' end;
  priority_key:=case when risk_key='critical' then 95 else 60 end;
  status_key:=tr.state||':'||coalesce(tr.last_error_code,'provider_state');observed_key:=tr.updated_at;
  hold_key:=case when risk_key='critical' then 'active' else 'unknown' end;
  release_key:=case when risk_key='critical' then 'blocked' else 'not_applicable' end;
 else
  select * into po from marketplace_private.connected_payout_observations where id=p_source_id;
  if po.id is null then raise exception 'Payout observation unavailable.' using errcode='P0002';end if;
  if po.provider_status not in('failed','canceled') and not had_case then return null;end if;
  provider_key:=po.provider;mode_key:=po.provider_mode;platform_key:=po.provider_platform;object_key:=po.payout_ref;
  category_key:='payout_reconciliation';
  risk_key:=case when po.provider_status in('failed','canceled') then 'high' else 'medium' end;
  priority_key:=case when risk_key='high' then 85 else 60 end;
  status_key:=po.provider_status||':'||coalesce(po.failure_code,'provider_state');observed_key:=po.provider_observed_at;
  hold_key:='unknown';release_key:='not_applicable';
 end if;
 if observed_key is null or category_key is null then raise exception 'Incomplete operational case evidence.' using errcode='23514';end if;

 insert into marketplace_private.operational_cases(source_kind,source_id,order_id,payment_attempt_id,provider,provider_mode,
  provider_platform,provider_object_ref,category,risk_level,priority,response_due_at,hold_projection,release_projection,
  source_status,source_observed_at)
 values(p_source_kind,p_source_id,order_key,attempt_key,provider_key,mode_key,platform_key,object_key,category_key,risk_key,
  priority_key,deadline_key,hold_key,release_key,status_key,observed_key)
 on conflict(source_kind,source_id) do nothing returning * into c;
 created:=c.id is not null;
 if not created then
  select * into c from marketplace_private.operational_cases
   where source_kind=p_source_kind and source_id=p_source_id for update;
  if c.order_id is distinct from order_key or c.payment_attempt_id is distinct from attempt_key
   or c.provider is distinct from provider_key or c.provider_mode is distinct from mode_key
   or c.provider_platform is distinct from platform_key or c.provider_object_ref is distinct from object_key
   or c.category is distinct from category_key then
   raise exception 'Operational case source binding conflict.' using errcode='23514';end if;
  changed:=c.risk_level is distinct from risk_key or c.priority is distinct from priority_key
   or c.response_due_at is distinct from deadline_key or c.hold_projection is distinct from hold_key
   or c.release_projection is distinct from release_key or c.source_status is distinct from status_key
   or c.source_observed_at is distinct from observed_key;
  if changed then
   update marketplace_private.operational_cases set risk_level=risk_key,priority=priority_key,response_due_at=deadline_key,
    hold_projection=hold_key,release_projection=release_key,source_status=status_key,source_observed_at=observed_key,
    version=version+1,updated_at=t where id=c.id returning * into c;
  end if;
 end if;

 insert into marketplace_private.operational_case_evidence_refs(case_id,evidence_kind,reference_id,source_observed_at)
 values(c.id,case when p_source_kind='uu_protection' then 'protection_case'
  when p_source_kind='stripe_dispute' then 'stripe_dispute' when p_source_kind='payment_exception' then 'payment_attempt'
  when p_source_kind='refund_exception' then 'refund_operation' when p_source_kind='transfer_exception' then 'transfer_operation'
  else 'payout_observation' end,p_source_id,observed_key) on conflict do nothing;
 if order_key is not null then
  insert into marketplace_private.operational_case_evidence_refs(case_id,evidence_kind,reference_id,source_observed_at)
  values(c.id,'order',order_key,observed_key),(c.id,'transaction_history',order_key,observed_key) on conflict do nothing;
 end if;
 if attempt_key is not null then
  insert into marketplace_private.operational_case_evidence_refs(case_id,evidence_kind,reference_id,source_observed_at)
  values(c.id,'payment_attempt',attempt_key,observed_key) on conflict do nothing;
 end if;
 if created or changed then
  insert into marketplace_private.operational_case_audit(case_id,case_version,actor_kind,actor_subject,action,action_result,source_event_key)
  values(c.id,c.version,'system_service','database_trigger',case when created then 'case_created' else 'source_refreshed' end,
   'applied',c.id::text||':'||c.version::text) on conflict do nothing;
 end if;
 return c.id;
end;$$;

create function marketplace_private.capture_operational_case() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 kind:=case tg_table_name when 'protection_cases' then 'uu_protection'
  when 'stripe_dispute_observations' then 'stripe_dispute' when 'campus_payment_attempts' then 'payment_exception'
  when 'order_refund_operations' then 'refund_exception' when 'order_transfer_operations' then 'transfer_exception'
  when 'connected_payout_observations' then 'payout_exception' end;
 perform marketplace_private.sync_operational_case(kind,new.id);return new;
end;$$;
create trigger protection_case_operational_index after insert or update on marketplace_private.protection_cases
 for each row execute function marketplace_private.capture_operational_case();
create trigger stripe_dispute_operational_index after insert or update on marketplace_private.stripe_dispute_observations
 for each row execute function marketplace_private.capture_operational_case();
create trigger payment_exception_operational_index after insert or update on marketplace_private.campus_payment_attempts
 for each row execute function marketplace_private.capture_operational_case();
create trigger refund_exception_operational_index after insert or update on marketplace_private.order_refund_operations
 for each row execute function marketplace_private.capture_operational_case();
create trigger transfer_exception_operational_index after insert or update on marketplace_private.order_transfer_operations
 for each row execute function marketplace_private.capture_operational_case();
create trigger payout_exception_operational_index after insert or update on marketplace_private.connected_payout_observations
 for each row execute function marketplace_private.capture_operational_case();

create function public.marketplace_operational_cases(
 p_action text,p_case uuid default null,p_source_kind text default null,p_source_id uuid default null,
 p_expected_version integer default null,p_target_status text default null,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c marketplace_private.operational_cases;case_key uuid;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action='sync' then
  if p_case is not null or p_source_kind is null or p_source_id is null or p_expected_version is not null
   or p_target_status is not null or p_actor is not null then raise exception 'Invalid case sync.' using errcode='23514';end if;
  case_key:=marketplace_private.sync_operational_case(p_source_kind,p_source_id);
  if case_key is null then return null;end if;
  select * into c from marketplace_private.operational_cases where id=case_key;
 elsif p_action='read' then
  if p_case is null or p_source_kind is not null or p_source_id is not null or p_expected_version is not null
   or p_target_status is not null or p_actor is not null then raise exception 'Invalid case read.' using errcode='23514';end if;
  select * into c from marketplace_private.operational_cases where id=p_case;
  if c.id is null then return null;end if;
 elsif p_action='review' then
  if p_case is null or p_expected_version is null or p_target_status not in(
   'under_review','awaiting_evidence','blocked_policy','resolved') or p_actor is null then
   raise exception 'Invalid case review request.' using errcode='23514';end if;
  select * into c from marketplace_private.operational_cases where id=p_case;
  if c.id is null then raise exception 'Operational case unavailable.' using errcode='P0002';end if;
  if c.version is distinct from p_expected_version then
   raise exception 'Operational case version conflict.' using errcode='40001';end if;
  raise exception 'Operational reviewer authority is not configured.' using errcode='42501';
 else raise exception 'Invalid operational case action.' using errcode='23514';end if;
 return to_jsonb(c)||jsonb_build_object(
  'evidence',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.evidence_kind,'referenceId',e.reference_id,
   'observedAt',e.source_observed_at) order by e.evidence_kind,e.reference_id),'[]'::jsonb)
   from marketplace_private.operational_case_evidence_refs e where e.case_id=c.id),
  'audit',(select coalesce(jsonb_agg(jsonb_build_object('version',h.case_version,'actorKind',h.actor_kind,
   'actorSubject',h.actor_subject,'action',h.action,'result',h.action_result,'createdAt',h.created_at)
   order by h.case_version),'[]'::jsonb) from marketplace_private.operational_case_audit h where h.case_id=c.id));
end;$$;

do $$declare r record;begin
 for r in select 'uu_protection'::text kind,id from marketplace_private.protection_cases loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
 for r in select 'stripe_dispute'::text kind,id from marketplace_private.stripe_dispute_observations loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
 for r in select 'payment_exception'::text kind,id from marketplace_private.campus_payment_attempts
  where provider_reconcile_state='exception' or provider_exception_code is not null loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
 for r in select 'refund_exception'::text kind,id from marketplace_private.order_refund_operations
  where state in('failed','exception') or last_error_code is not null loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
 for r in select 'transfer_exception'::text kind,id from marketplace_private.order_transfer_operations
  where state in('failed','exception') or last_error_code is not null loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
 for r in select 'payout_exception'::text kind,id from marketplace_private.connected_payout_observations
  where provider_status in('failed','canceled') loop
  perform marketplace_private.sync_operational_case(r.kind,r.id);end loop;
end$$;

revoke all on function marketplace_private.protect_operational_case() from public,anon,authenticated,service_role;
revoke all on function marketplace_private.protect_operational_case_history() from public,anon,authenticated,service_role;
revoke all on function marketplace_private.sync_operational_case(text,uuid) from public,anon,authenticated,service_role;
revoke all on function marketplace_private.capture_operational_case() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_operational_cases(text,uuid,text,uuid,integer,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_operational_cases(text,uuid,text,uuid,integer,text,uuid) to service_role;

commit;

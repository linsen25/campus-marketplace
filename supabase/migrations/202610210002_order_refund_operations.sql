-- B23-A: durable refund operation identity and lease authority.
-- No Stripe Refund is created or resolved by this migration.
begin;

create table marketplace_private.order_refund_operations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.orders(id) on delete restrict,
 payment_attempt_id uuid not null unique references marketplace_private.campus_payment_attempts(id) on delete restrict,
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 payment_intent_ref text not null check(payment_intent_ref ~ '^pi_[A-Za-z0-9]+$'),
 amount_cents bigint not null check(amount_cents between 1 and 99999999),
 currency text not null check(currency='CAD'),
 operation_id uuid not null unique,
 idempotency_key text not null unique,
 refund_ref text,
 state text not null default 'prepared' check(state in('prepared','in_flight','reconciling','succeeded','failed','exception')),
 provider_status text check(provider_status is null or provider_status in('pending','requires_action','succeeded','failed','canceled')),
 request_started_at timestamptz,
 lease uuid,
 lease_until timestamptz,
 next_reconcile_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0 check(attempts>=0),
 last_error_code text check(last_error_code is null or last_error_code in(
  'provider_unavailable','provider_mismatch','unknown_outcome','stale_lease','terminal_conflict')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(idempotency_key=('uu:test:'||provider_platform||':refund:'||operation_id::text)),
 check(refund_ref is null or refund_ref ~ '^re_[A-Za-z0-9]+$'),
 check((lease is null)=(lease_until is null)),
 check(updated_at>=created_at)
);
alter table marketplace_private.order_refund_operations enable row level security;
revoke all on marketplace_private.order_refund_operations from public,anon,authenticated,service_role;

create unique index order_refund_provider_ref_unique
 on marketplace_private.order_refund_operations(provider_platform,provider_mode,refund_ref)
 where refund_ref is not null;
create index order_refund_due_idx
 on marketplace_private.order_refund_operations(provider_platform,provider_mode,next_reconcile_at,created_at)
 where state in('prepared','in_flight','reconciling');

-- Future B23-B/C RPC revisions may update only provider observation and lease
-- fields. The authorization, amount and original payment binding stay frozen.
create function marketplace_private.protect_order_refund_operation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['refund_ref','state','provider_status','request_started_at','lease','lease_until',
   'next_reconcile_at','attempts','last_error_code','updated_at']) is distinct from
  (to_jsonb(old)-array['refund_ref','state','provider_status','request_started_at','lease','lease_until',
   'next_reconcile_at','attempts','last_error_code','updated_at']) then
  raise exception 'Refund operation financial binding is immutable.' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger order_refund_operation_immutable before update or delete
 on marketplace_private.order_refund_operations for each row
 execute function marketplace_private.protect_order_refund_operation();

create function public.marketplace_order_refund_operation(
 p_action text,p_order uuid default null,p_platform text default null,p_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;
 i marketplace_private.order_cancellation_intents;s marketplace_private.order_settlement_authorizations;
 e marketplace_private.v2_order_economics;r marketplace_private.order_refund_operations;
 candidate uuid;listing_key uuid;op uuid;t timestamptz:=clock_timestamp();claim_kind text;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_platform is null or p_action not in('prepare','claim_due','read')
  or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid refund operation.' using errcode='23514';
 end if;

 if p_action='read' then
  if p_order is null then raise exception 'Order required.' using errcode='23514';end if;
  select * into r from marketplace_private.order_refund_operations
   where order_id=p_order and provider_platform=p_platform and provider_mode='test';
  if r.id is null then return null;end if;
  select * into a from marketplace_private.campus_payment_attempts where id=r.payment_attempt_id;
  if p_token is not null and (r.lease is distinct from p_token or r.lease_until<=t) then
   raise exception 'Stale refund lease.' using errcode='40001';
  end if;
  return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',null,
   'provider_customer_ref',a.provider_customer_ref,'provider_instrument_ref',a.provider_instrument_ref,
   'provider_seller_account_ref',a.provider_seller_account_ref,'provider_transfer_group',a.provider_transfer_group,
   'provider_amount_cents',a.provider_amount_cents,'provider_currency',a.provider_currency);
 end if;

 if p_action='claim_due' then
  if p_order is not null or p_token is not null then raise exception 'Unexpected claim input.' using errcode='23514';end if;
  for candidate,listing_key in
   select ro.id,ord.listing_id
    from marketplace_private.order_refund_operations ro join public.orders ord on ord.id=ro.order_id
    where ro.provider_platform=p_platform and ro.provider_mode='test'
     and ro.state in('prepared','in_flight','reconciling') and ro.next_reconcile_at<=t
     and (ro.lease_until is null or ro.lease_until<t)
    order by ro.next_reconcile_at,ro.created_at,ro.id limit 20
  loop
   perform 1 from public.listings where id=listing_key for update skip locked;
   if not found then continue;end if;
   select * into o from public.orders where public.orders.listing_id=listing_key
    and id=(select order_id from marketplace_private.order_refund_operations where id=candidate)
    for update skip locked;
   if o.id is null then continue;end if;
   select * into a from marketplace_private.campus_payment_attempts
    where id=(select payment_attempt_id from marketplace_private.order_refund_operations where id=candidate)
    for update skip locked;
   if a.id is null then continue;end if;
   select * into s from marketplace_private.order_settlement_authorizations where order_id=o.id for update skip locked;
   if s.order_id is null then continue;end if;
   select * into r from marketplace_private.order_refund_operations where id=candidate for update skip locked;
   if r.id is null or r.state not in('prepared','in_flight','reconciling') or r.next_reconcile_at>t
    or r.lease_until>t then continue;end if;
   select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
   select * into e from marketplace_private.v2_order_economics where order_id=o.id;
   if i.state is distinct from 'finalized' or o.order_protocol_version<>2
    or marketplace_private.payment_mode(o.terms_snapshot->'terms') is distinct from 'uu_pay'
    or o.lifecycle_status<>'cancelled' or o.holds_listing or o.payment_status<>'paid'
    or o.payment_paid_at is null or o.cancelled_at is null or o.reservation_ended_at is distinct from o.cancelled_at
    or a.order_id is distinct from o.id or a.status<>'paid' or a.finished_at is distinct from o.payment_paid_at
    or a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform is distinct from p_platform
    or a.provider_purpose<>'marketplace_order' or a.provider_reference is distinct from r.payment_intent_ref
    or a.provider_amount_cents is distinct from e.buyer_total_cents or a.provider_currency<>'CAD'
    or a.provider_status<>'succeeded' or a.provider_observed_at is null or a.provider_evidence_id is null
    or not((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
     or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested'))
    or r.payment_attempt_id is distinct from a.id or r.provider<>'stripe' or r.provider_mode<>'test'
    or r.provider_platform is distinct from a.provider_platform or r.currency is distinct from a.provider_currency
    or s.secured_cents is distinct from e.buyer_total_cents or s.buyer_release_cents is distinct from r.amount_cents
    or s.buyer_release_cents>s.secured_cents or r.amount_cents>a.provider_amount_cents
    then raise exception 'Refund authority changed.' using errcode='23514';end if;
   claim_kind:=case when r.state='prepared' and r.request_started_at is null then 'execute' else 'reconcile' end;
   update marketplace_private.order_refund_operations set
    state=case when claim_kind='execute' then 'in_flight' else 'reconciling' end,
    request_started_at=coalesce(request_started_at,t),lease=gen_random_uuid(),lease_until=t+interval '180 seconds',
    next_reconcile_at=t+interval '5 minutes',attempts=attempts+1,updated_at=t
    where id=r.id returning * into r;
   return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',claim_kind,
    'provider_customer_ref',a.provider_customer_ref,'provider_instrument_ref',a.provider_instrument_ref,
    'provider_seller_account_ref',a.provider_seller_account_ref,'provider_transfer_group',a.provider_transfer_group,
    'provider_amount_cents',a.provider_amount_cents,'provider_currency',a.provider_currency);
  end loop;
  return null;
 end if;

 if p_order is null or p_token is not null then raise exception 'Invalid prepare input.' using errcode='23514';end if;
 select * into o from public.orders where id=p_order;
 if o.id is null then raise exception 'Refund Order unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order for update;
 select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and status='paid' for update;
 select * into s from marketplace_private.order_settlement_authorizations where order_id=o.id for update;
 select * into r from marketplace_private.order_refund_operations where order_id=o.id for update;
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
 select * into e from marketplace_private.v2_order_economics where order_id=o.id;
 if i.state is distinct from 'finalized' then raise exception 'Finalized cancellation required.' using errcode='23514';end if;
 if s.order_id is null then raise exception 'Settlement authorization required.' using errcode='23514';end if;
 if o.order_protocol_version<>2 or marketplace_private.payment_mode(o.terms_snapshot->'terms') is distinct from 'uu_pay'
  or o.lifecycle_status<>'cancelled' or o.holds_listing or o.payment_status<>'paid'
  or o.payment_paid_at is null or o.cancelled_at is null or o.reservation_ended_at is distinct from o.cancelled_at
  then raise exception 'Authorized cancelled UU Pay Order required.' using errcode='23514';end if;
 if a.id is null or a.order_id is distinct from o.id or a.status<>'paid' or a.finished_at is distinct from o.payment_paid_at
  or a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform is distinct from p_platform
  or a.provider_purpose<>'marketplace_order' or a.provider_reference is null
  or a.provider_amount_cents is distinct from e.buyer_total_cents or a.provider_currency<>'CAD'
  or a.provider_status<>'succeeded' or a.provider_observed_at is null or a.provider_evidence_id is null
  or not((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
   or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested'))
  then raise exception 'Trusted paid Stripe attempt required.' using errcode='23514';end if;
 if e.order_id is null or s.secured_cents is distinct from e.buyer_total_cents
  or s.secured_cents::numeric<>s.buyer_release_cents::numeric+s.seller_delivery_compensation_cents
  or s.buyer_release_cents>a.provider_amount_cents then
  raise exception 'Frozen refund authorization mismatch.' using errcode='23514';
 end if;
 if s.buyer_release_cents=0 then
  if r.id is not null then raise exception 'Zero refund cannot have provider operation.' using errcode='23514';end if;
  return jsonb_build_object('required',false,'order_id',o.id,'amount_cents',0,'reason','zero_buyer_release');
 end if;
 if r.id is null then
  op:=gen_random_uuid();
  insert into marketplace_private.order_refund_operations(order_id,payment_attempt_id,provider,provider_mode,
   provider_platform,payment_intent_ref,amount_cents,currency,operation_id,idempotency_key)
  values(o.id,a.id,'stripe','test',a.provider_platform,a.provider_reference,s.buyer_release_cents,a.provider_currency,
   op,'uu:test:'||a.provider_platform||':refund:'||op::text) returning * into r;
 else
  if r.payment_attempt_id is distinct from a.id or r.provider<>'stripe' or r.provider_mode<>'test'
   or r.provider_platform is distinct from a.provider_platform or r.payment_intent_ref is distinct from a.provider_reference
   or r.amount_cents is distinct from s.buyer_release_cents or r.currency is distinct from a.provider_currency then
   raise exception 'Existing refund operation mismatch.' using errcode='23514';end if;
 end if;
 return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',null,
  'provider_customer_ref',a.provider_customer_ref,'provider_instrument_ref',a.provider_instrument_ref,
  'provider_seller_account_ref',a.provider_seller_account_ref,'provider_transfer_group',a.provider_transfer_group,
  'provider_amount_cents',a.provider_amount_cents,'provider_currency',a.provider_currency);
end;$$;

revoke all on function marketplace_private.protect_order_refund_operation() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_refund_operation(text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_refund_operation(text,uuid,text,uuid) to service_role;

commit;

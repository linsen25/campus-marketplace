-- B24-A: durable seller Transfer authority and lease persistence.
-- This migration never calls Stripe and never represents a bank Payout.
begin;

create table marketplace_private.order_transfer_operations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.orders(id) on delete restrict,
 payment_attempt_id uuid not null unique references marketplace_private.campus_payment_attempts(id) on delete restrict,
 seller_id uuid not null references public.profiles(id) on delete restrict,
 transfer_kind text not null check(transfer_kind in('sale_proceeds','delivery_compensation')),
 authority_kind text not null check(authority_kind in('protection_completed','cancellation_settlement')),
 authority_at timestamptz not null,
 provider text not null check(provider='stripe'),
 provider_mode text not null check(provider_mode='test'),
 provider_platform text not null check(provider_platform ~ '^acct_[A-Za-z0-9]+$'),
 payment_intent_ref text not null check(payment_intent_ref ~ '^pi_[A-Za-z0-9]+$'),
 destination_account_ref text not null check(destination_account_ref ~ '^acct_[A-Za-z0-9]+$'),
 amount_cents bigint not null check(amount_cents between 1 and 99999999),
 currency text not null check(currency='CAD'),
 transfer_group text not null check(transfer_group ~ '^uu_order_[0-9a-f-]{36}$'),
 operation_id uuid not null unique,
 idempotency_key text not null unique,
 transfer_ref text,
 state text not null default 'prepared' check(state in('prepared','in_flight','reconciling','succeeded','failed','exception')),
 provider_status text check(provider_status is null or provider_status in('pending','succeeded','failed','reversed','partially_reversed')),
 request_started_at timestamptz,
 lease uuid,
 lease_until timestamptz,
 next_reconcile_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0 check(attempts>=0),
 last_error_code text check(last_error_code is null or last_error_code in(
  'provider_unavailable','provider_mismatch','unknown_outcome','stale_lease','terminal_conflict','recipient_not_ready')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(idempotency_key=('uu:test:'||provider_platform||':transfer:'||operation_id::text)),
 check(transfer_ref is null or transfer_ref ~ '^tr_[A-Za-z0-9]+$'),
 check((lease is null)=(lease_until is null)),
 check(updated_at>=created_at),
 check((transfer_kind='sale_proceeds' and authority_kind='protection_completed')
  or(transfer_kind='delivery_compensation' and authority_kind='cancellation_settlement'))
);
alter table marketplace_private.order_transfer_operations enable row level security;
revoke all on marketplace_private.order_transfer_operations from public,anon,authenticated,service_role;

create unique index order_transfer_provider_ref_unique
 on marketplace_private.order_transfer_operations(provider_platform,provider_mode,transfer_ref)
 where transfer_ref is not null;
create index order_transfer_due_idx
 on marketplace_private.order_transfer_operations(provider_platform,provider_mode,next_reconcile_at,created_at)
 where state in('prepared','in_flight','reconciling');

create function marketplace_private.protect_order_transfer_operation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or
  (to_jsonb(new)-array['transfer_ref','state','provider_status','request_started_at','lease','lease_until',
   'next_reconcile_at','attempts','last_error_code','updated_at']) is distinct from
  (to_jsonb(old)-array['transfer_ref','state','provider_status','request_started_at','lease','lease_until',
   'next_reconcile_at','attempts','last_error_code','updated_at']) then
  raise exception 'Transfer operation financial binding is immutable.' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger order_transfer_operation_immutable before update or delete
 on marketplace_private.order_transfer_operations for each row
 execute function marketplace_private.protect_order_transfer_operation();

create function public.marketplace_order_transfer_operation(
 p_action text,p_order uuid default null,p_platform text default null,p_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.campus_payment_attempts;
 s marketplace_private.order_settlement_authorizations;i marketplace_private.order_cancellation_intents;
 e marketplace_private.v2_order_economics;p marketplace_private.order_protection;
 c marketplace_private.protection_cases;rr marketplace_private.order_refund_operations;
 b marketplace_private.stripe_bindings;r marketplace_private.order_transfer_operations;
 candidate uuid;candidate_order uuid;listing_key uuid;op uuid;t timestamptz:=clock_timestamp();
 amount bigint;kind text;authority text;authority_time timestamptz;claim_kind text;validated jsonb;
begin
 perform marketplace_private.require_stripe_staging();
 if p_action is null or p_platform is null or p_action not in('prepare','claim_due','read')
  or p_platform !~ '^acct_[A-Za-z0-9]+$' then
  raise exception 'Invalid transfer operation.' using errcode='23514';
 end if;

 if p_action='read' then
  if p_order is null then raise exception 'Order required.' using errcode='23514';end if;
  select * into r from marketplace_private.order_transfer_operations
   where order_id=p_order and provider_platform=p_platform and provider_mode='test';
  if r.id is null then return null;end if;
  if p_token is not null and (r.lease is distinct from p_token or r.lease_until<=t) then
   raise exception 'Stale transfer lease.' using errcode='40001';
  end if;
  return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',null);
 end if;

 if p_action='claim_due' then
  if p_order is not null or p_token is not null then raise exception 'Unexpected claim input.' using errcode='23514';end if;
  for candidate,candidate_order,listing_key in
   select tr.id,tr.order_id,ord.listing_id
    from marketplace_private.order_transfer_operations tr join public.orders ord on ord.id=tr.order_id
    where tr.provider_platform=p_platform and tr.provider_mode='test'
     and tr.state in('prepared','in_flight','reconciling') and tr.next_reconcile_at<=t
     and(tr.lease_until is null or tr.lease_until<t)
    order by tr.next_reconcile_at,tr.created_at,tr.id limit 20
  loop
   perform 1 from public.listings where id=listing_key for update skip locked;
   if not found then continue;end if;
   validated:=public.marketplace_order_transfer_operation('prepare',candidate_order,p_platform,null);
   select * into r from marketplace_private.order_transfer_operations where id=candidate for update skip locked;
   if r.id is null or r.order_id is distinct from candidate_order
    or r.state not in('prepared','in_flight','reconciling') or r.next_reconcile_at>t or r.lease_until>t then
    continue;
   end if;
   claim_kind:=case when r.state='prepared' and r.request_started_at is null then 'execute' else 'reconcile' end;
   update marketplace_private.order_transfer_operations set
    state=case when claim_kind='execute' then 'in_flight' else 'reconciling' end,
    request_started_at=coalesce(request_started_at,t),lease=gen_random_uuid(),lease_until=t+interval '180 seconds',
    next_reconcile_at=t+interval '5 minutes',attempts=attempts+1,updated_at=t
    where id=r.id returning * into r;
   return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',claim_kind);
  end loop;
  return null;
 end if;

 if p_order is null or p_token is not null then raise exception 'Invalid prepare input.' using errcode='23514';end if;
 select * into o from public.orders where id=p_order;
 if o.id is null then raise exception 'Transfer Order unavailable.' using errcode='P0002';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order for update;
 select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and status='paid' for update;
 select * into p from marketplace_private.order_protection where order_id=o.id for update;
 select * into s from marketplace_private.order_settlement_authorizations where order_id=o.id for update;
 select * into rr from marketplace_private.order_refund_operations where order_id=o.id for update;
 select * into b from marketplace_private.stripe_bindings bnd
  where bnd.user_id=o.seller_id and bnd.kind='payout_account' and bnd.platform=p_platform and bnd.mode='test' for update;
 select * into r from marketplace_private.order_transfer_operations where order_id=o.id for update;
 select * into i from marketplace_private.order_cancellation_intents where order_id=o.id;
 select * into e from marketplace_private.v2_order_economics where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;

 if o.order_protocol_version<>2 or marketplace_private.payment_mode(o.terms_snapshot->'terms') is distinct from 'uu_pay'
  or o.payment_status<>'paid' or o.payment_paid_at is null or e.order_id is null
  or a.id is null or a.order_id is distinct from o.id or a.status<>'paid' or a.finished_at is distinct from o.payment_paid_at
  or a.provider<>'stripe' or a.provider_mode<>'test' or a.provider_platform is distinct from p_platform
  or a.provider_purpose<>'marketplace_order' or a.provider_reference is null
  or a.provider_amount_cents is distinct from e.buyer_total_cents or a.provider_currency<>'CAD'
  or a.provider_status<>'succeeded' or a.provider_observed_at is null or a.provider_evidence_id is null
  or(a.provider_reconcile_state is distinct from 'applied' and a.provider_reconcile_state is distinct from 'exception')
  or a.provider_seller_account_ref is null or a.provider_transfer_group is distinct from 'uu_order_'||o.id::text
  or b.id is null or b.status<>'ready' or b.owner_ref is distinct from a.provider_seller_account_ref
  then raise exception 'Trusted paid Stripe seller binding required.' using errcode='23514';end if;

 if o.lifecycle_status='completed' then
  if o.holds_listing or o.payout_status<>'eligible' or o.fulfillment_status<>'fulfilled'
   or o.cancelled_at is not null or i.order_id is not null or s.order_id is not null or rr.id is not null
   or p.order_id is null or p.completed_at is null or p.completed_at<p.expires_at or c.id is not null
   or a.provider_reconcile_state<>'applied' or a.provider_exception_code is not null
   or e.seller_platform_fee_cents<>0
   or e.seller_gross_cents::numeric+e.buyer_service_fee_cents<>a.provider_amount_cents then
   raise exception 'Completed Protection transfer authority required.' using errcode='23514';end if;
  amount:=e.seller_gross_cents;kind:='sale_proceeds';authority:='protection_completed';authority_time:=p.completed_at;
 elsif o.lifecycle_status='cancelled' then
  if o.holds_listing or o.payout_status<>'not_eligible' or o.cancelled_at is null
   or i.state is distinct from 'finalized' or i.finalized_at is distinct from o.cancelled_at
   or s.order_id is null or s.disposition<>'delivery_compensation' or s.authorized_at is distinct from o.cancelled_at
   or s.seller_delivery_compensation_cents<=0 or s.seller_sale_payout_cents<>0
   or s.secured_cents::numeric<>s.buyer_release_cents::numeric+s.seller_delivery_compensation_cents
   or s.secured_cents is distinct from a.provider_amount_cents
   or not((a.provider_reconcile_state='applied' and a.provider_exception_code is null)
    or(a.provider_reconcile_state='exception' and a.provider_exception_code='paid_after_cancellation_requested'))
   or(s.buyer_release_cents=0 and rr.id is not null)
   or(s.buyer_release_cents>0 and(rr.id is null or rr.state<>'succeeded'
    or rr.payment_attempt_id is distinct from a.id or rr.amount_cents is distinct from s.buyer_release_cents
    or rr.provider_platform is distinct from p_platform or rr.payment_intent_ref is distinct from a.provider_reference))
   then raise exception 'Finalized delivery compensation authority required.' using errcode='23514';end if;
  amount:=s.seller_delivery_compensation_cents;kind:='delivery_compensation';authority:='cancellation_settlement';authority_time:=s.authorized_at;
 else raise exception 'Seller transfer is not authorized.' using errcode='23514';
 end if;

 if amount<=0 or amount>a.provider_amount_cents then raise exception 'Invalid seller transfer amount.' using errcode='23514';end if;
 if r.id is null then
  op:=gen_random_uuid();
  insert into marketplace_private.order_transfer_operations(order_id,payment_attempt_id,seller_id,transfer_kind,
   authority_kind,authority_at,provider,provider_mode,provider_platform,payment_intent_ref,destination_account_ref,
   amount_cents,currency,transfer_group,operation_id,idempotency_key)
  values(o.id,a.id,o.seller_id,kind,authority,authority_time,'stripe','test',a.provider_platform,a.provider_reference,
   a.provider_seller_account_ref,amount,a.provider_currency,a.provider_transfer_group,op,
   'uu:test:'||a.provider_platform||':transfer:'||op::text) returning * into r;
 else
  if r.payment_attempt_id is distinct from a.id or r.seller_id is distinct from o.seller_id
   or r.transfer_kind is distinct from kind or r.authority_kind is distinct from authority
   or r.authority_at is distinct from authority_time or r.provider<>'stripe' or r.provider_mode<>'test'
   or r.provider_platform is distinct from a.provider_platform or r.payment_intent_ref is distinct from a.provider_reference
   or r.destination_account_ref is distinct from a.provider_seller_account_ref or r.amount_cents is distinct from amount
   or r.currency is distinct from a.provider_currency or r.transfer_group is distinct from a.provider_transfer_group then
   raise exception 'Existing transfer operation mismatch.' using errcode='23514';end if;
 end if;
 return to_jsonb(r)||jsonb_build_object('required',true,'claim_kind',null);
end;$$;

revoke all on function marketplace_private.protect_order_transfer_operation() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_transfer_operation(text,uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_transfer_operation(text,uuid,text,uuid) to service_role;

commit;

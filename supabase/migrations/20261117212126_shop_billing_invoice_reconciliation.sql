-- Phase 4B-2: Stripe Test Mode invoice reconciliation.
-- This records verified provider payment facts only. It never calls any
-- Membership entitlement command or mutates provider-backed Membership terms.
begin;

alter table marketplace_private.shop_billing_invoices
  add column reconciliation_state text not null default 'unverified'
    check (reconciliation_state in ('unverified','verified_paid','payment_failed','action_required','unsupported','rejected','retryable')),
  add column reconciliation_reason text,
  add column billing_reason text,
  add column verified_price_id text,
  add column verified_tier text check (verified_tier is null or verified_tier in ('plus','pro')),
  add column verified_event_id uuid references marketplace_private.shop_billing_events(id) on delete restrict,
  add column verified_at timestamptz,
  add column reconciliation_revision bigint not null default 0 check (reconciliation_revision >= 0),
  add column line_item_count integer not null default 0 check (line_item_count >= 0),
  add column line_item_digest text,
  add column proof_eligible boolean not null default false;

alter table marketplace_private.shop_billing_invoices
  add constraint shop_billing_invoice_reconciliation_check check (
    (reconciliation_state = 'verified_paid') = proof_eligible
  ),
  add constraint shop_billing_invoice_reconciliation_details_check check (
    (proof_eligible = false and verified_at is null and verified_event_id is null)
    or (
      proof_eligible = true
      and verified_at is not null
      and verified_event_id is not null
      and verified_price_id ~ '^price_[A-Za-z0-9]+$'
      and verified_tier is not null
      and service_period_start is not null
      and service_period_end is not null
      and provider_event_version is not null
      and line_item_count > 0
      and line_item_digest ~ '^[0-9a-f]{64}$'
    )
  );

create table marketplace_private.shop_billing_invoice_proofs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null unique references marketplace_private.shop_billing_invoices(id) on delete restrict,
  billing_event_id uuid not null references marketplace_private.shop_billing_events(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_customer_id text not null check (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  provider_subscription_id text not null check (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_invoice_id text not null check (provider_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  tier text not null check (tier in ('plus','pro')),
  currency text not null check (currency = 'CAD'),
  amount_due_cents bigint not null check (amount_due_cents > 0),
  amount_paid_cents bigint not null check (amount_paid_cents >= amount_due_cents),
  billing_reason text not null check (billing_reason in ('subscription_create','subscription_cycle')),
  service_period_start timestamptz not null,
  service_period_end timestamptz not null,
  provider_event_version timestamptz not null,
  line_item_digest text not null check (line_item_digest ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (service_period_end > service_period_start),
  unique (provider, provider_account_id, provider_invoice_id)
);

create table marketplace_private.shop_billing_invoice_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid references marketplace_private.shop_billing_invoices(id) on delete restrict,
  billing_event_id uuid references marketplace_private.shop_billing_events(id) on delete restrict,
  action text not null check (action in ('invoice_verified_paid','invoice_payment_failed','invoice_action_required','invoice_unsupported','invoice_rejected','invoice_stale')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_billing_invoice_reconciliation_audit_event_action_unique
  on marketplace_private.shop_billing_invoice_reconciliation_audit(billing_event_id, action)
  where billing_event_id is not null;

create function marketplace_private.validate_shop_billing_invoice_proof()
returns trigger language plpgsql set search_path='' as $$
declare v_invoice marketplace_private.shop_billing_invoices;
  v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_event marketplace_private.shop_billing_events;
begin
  select * into v_invoice from marketplace_private.shop_billing_invoices where id = new.billing_invoice_id;
  select * into v_customer from marketplace_private.shop_billing_customers where id = new.billing_customer_id;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions where id = new.billing_subscription_id;
  select * into v_event from marketplace_private.shop_billing_events where id = new.billing_event_id;
  if v_invoice.id is null or v_customer.id is null or v_subscription.id is null or v_event.id is null
     or v_invoice.reconciliation_state <> 'verified_paid' or not v_invoice.proof_eligible
     or v_invoice.owner_id is distinct from new.owner_id
     or v_customer.owner_id is distinct from new.owner_id
     or v_subscription.owner_id is distinct from new.owner_id
     or v_invoice.billing_customer_id is distinct from new.billing_customer_id
     or v_invoice.billing_subscription_id is distinct from new.billing_subscription_id
     or v_invoice.verified_event_id is distinct from new.billing_event_id
     or v_customer.provider is distinct from new.provider
     or v_subscription.provider is distinct from new.provider
     or v_invoice.provider is distinct from new.provider
     or v_customer.provider_account_id is distinct from new.provider_account_id
     or v_subscription.provider_account_id is distinct from new.provider_account_id
     or v_invoice.provider_account_id is distinct from new.provider_account_id
     or v_event.provider_account_id is distinct from new.provider_account_id
     or v_customer.provider_customer_id is distinct from new.provider_customer_id
     or v_subscription.provider_subscription_id is distinct from new.provider_subscription_id
     or v_invoice.provider_invoice_id is distinct from new.provider_invoice_id
     or v_invoice.verified_price_id is distinct from new.provider_price_id
     or v_invoice.verified_tier is distinct from new.tier
     or v_invoice.currency is distinct from new.currency
     or v_invoice.amount_due_cents is distinct from new.amount_due_cents
     or v_invoice.amount_paid_cents is distinct from new.amount_paid_cents
     or v_invoice.billing_reason is distinct from new.billing_reason
     or v_invoice.service_period_start is distinct from new.service_period_start
     or v_invoice.service_period_end is distinct from new.service_period_end
     or v_invoice.provider_event_version is distinct from new.provider_event_version
     or v_invoice.line_item_digest is distinct from new.line_item_digest then
    raise exception 'Billing Invoice proof must match verified provider state.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_invoice_proof_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing Invoice proof history is immutable.' using errcode = '42501';
end;$$;

create trigger shop_billing_invoice_proof_relationship
before insert or update on marketplace_private.shop_billing_invoice_proofs
for each row execute function marketplace_private.validate_shop_billing_invoice_proof();
create trigger shop_billing_invoice_proof_immutable
before update or delete on marketplace_private.shop_billing_invoice_proofs
for each row execute function marketplace_private.protect_shop_billing_invoice_proof_history();
create trigger shop_billing_invoice_reconciliation_audit_immutable
before update or delete on marketplace_private.shop_billing_invoice_reconciliation_audit
for each row execute function marketplace_private.protect_shop_billing_invoice_proof_history();

alter table marketplace_private.shop_billing_invoice_proofs enable row level security;
alter table marketplace_private.shop_billing_invoice_reconciliation_audit enable row level security;
revoke all on marketplace_private.shop_billing_invoice_proofs,
  marketplace_private.shop_billing_invoice_reconciliation_audit from public, anon, authenticated, service_role;

create function public.marketplace_shop_billing_reconcile_invoice(
  p_platform text,
  p_event_id text,
  p_lease uuid,
  p_value jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event marketplace_private.shop_billing_events;
  v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_invoice marketplace_private.shop_billing_invoices;
  v_proof marketplace_private.shop_billing_invoice_proofs;
  v_owner uuid; v_action text; v_version timestamptz; v_now timestamptz := clock_timestamp(); v_invoice_found boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_platform !~ '^acct_[A-Za-z0-9]+$' or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_lease is null
     or jsonb_typeof(p_value) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('invoiceId','customerId','subscriptionId','status','currency','amountDueCents','amountPaidCents','attemptCount','billingReason','priceId','tier','servicePeriodStart','servicePeriodEnd','providerVersion','lineItemCount','lineItemDigest','verificationState','reason','paidAt'))
     or (p_value->>'invoiceId') !~ '^in_[A-Za-z0-9]+$'
     or (p_value->>'customerId') !~ '^cus_[A-Za-z0-9]+$'
     or (p_value->>'subscriptionId') !~ '^sub_[A-Za-z0-9]+$'
     or (p_value->>'status') not in ('draft','open','paid','uncollectible','void')
     or (p_value->>'verificationState') not in ('verified_paid','payment_failed','action_required','unsupported','rejected')
     or (p_value->>'currency') !~ '^[A-Z]{3}$'
     or (p_value->>'amountDueCents') !~ '^[0-9]+$'
     or (p_value->>'amountPaidCents') !~ '^[0-9]+$'
     or (p_value->>'attemptCount') !~ '^[0-9]+$'
     or (p_value->>'providerVersion') is null
     or coalesce(length(p_value->>'reason'),0) > 1000 then
    raise exception 'Invalid Billing Invoice reconciliation.' using errcode = '23514';
  end if;
  if (p_value->>'verificationState') = 'verified_paid' and (
    (p_value->>'status') <> 'paid' or (p_value->>'currency') <> 'CAD'
    or (p_value->>'amountDueCents')::bigint <= 0
    or (p_value->>'amountPaidCents')::bigint < (p_value->>'amountDueCents')::bigint
    or (p_value->>'billingReason') not in ('subscription_create','subscription_cycle')
    or (p_value->>'priceId') !~ '^price_[A-Za-z0-9]+$'
    or (p_value->>'tier') not in ('plus','pro')
    or (p_value->>'servicePeriodStart') is null or (p_value->>'servicePeriodEnd') is null
    or (p_value->>'lineItemCount') !~ '^[1-9][0-9]*$'
    or (p_value->>'lineItemDigest') !~ '^[0-9a-f]{64}$'
    or (p_value->>'paidAt') is null
  ) then
    raise exception 'Verified paid Billing Invoice proof is invalid.' using errcode = '23514';
  end if;
  select * into v_event from marketplace_private.shop_billing_events e
    where e.provider = 'stripe' and e.provider_account_id = p_platform and e.provider_event_id = p_event_id for update;
  if not found or v_event.processing_status <> 'processing' or v_event.lease_token is distinct from p_lease
     or v_event.event_type not in ('invoice.paid','invoice.payment_failed','invoice.payment_action_required')
     or v_event.provider_object_id is distinct from p_value->>'invoiceId' then
    raise exception 'Billing event lease is invalid.' using errcode = '40001';
  end if;
  select * into v_customer from marketplace_private.shop_billing_customers c
    where c.provider='stripe' and c.provider_account_id=p_platform and c.provider_customer_id=p_value->>'customerId' for update;
  if not found then raise exception 'Verified Billing customer binding was not found.' using errcode = '23514'; end if;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s
    where s.provider='stripe' and s.provider_account_id=p_platform and s.provider_subscription_id=p_value->>'subscriptionId' for update;
  if not found or v_subscription.owner_id <> v_customer.owner_id or v_subscription.billing_customer_id <> v_customer.id then
    raise exception 'Billing Invoice subscription binding mismatch.' using errcode = '23514'; end if;
  if v_event.provider_customer_id is not null and v_event.provider_customer_id <> p_value->>'customerId'
     or v_event.provider_subscription_id is not null and v_event.provider_subscription_id <> p_value->>'subscriptionId' then
    raise exception 'Billing Invoice event binding mismatch.' using errcode = '23514'; end if;
  v_owner := v_customer.owner_id; v_version := (p_value->>'providerVersion')::timestamptz;
  select * into v_invoice from marketplace_private.shop_billing_invoices i
    where i.provider='stripe' and i.provider_account_id=p_platform and i.provider_invoice_id=p_value->>'invoiceId' for update;
  v_invoice_found := found;
  if v_invoice_found and v_invoice.owner_id <> v_owner then raise exception 'Billing Invoice owner binding mismatch.' using errcode = '23514'; end if;
  if v_invoice_found and v_invoice.provider_event_version is not null and v_invoice.provider_event_version > v_version then
    insert into marketplace_private.shop_billing_invoice_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,billing_event_id,action,details)
      values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_event.id,'invoice_stale',jsonb_build_object('providerVersion',v_version)) on conflict do nothing;
    return jsonb_build_object('applied',false,'state','stale','invoiceId',v_invoice.id);
  end if;
  if v_invoice_found then
    select * into v_proof from marketplace_private.shop_billing_invoice_proofs p
      where p.billing_invoice_id = v_invoice.id for update;
    if found then
      if (p_value->>'verificationState') = 'verified_paid'
         and v_proof.provider_event_version = v_version
         and v_proof.line_item_digest is not distinct from nullif(p_value->>'lineItemDigest','')
         and v_proof.provider_price_id is not distinct from nullif(p_value->>'priceId','')
         and v_proof.tier is not distinct from nullif(p_value->>'tier','') then
        return jsonb_build_object('applied',false,'state','already_verified','invoiceId',v_invoice.id,'proofEligible',true);
      end if;
      raise exception 'Conflicting Billing Invoice proof replay.' using errcode = '23505';
    end if;
  end if;
  if not v_invoice_found then
    insert into marketplace_private.shop_billing_invoices(owner_id,billing_customer_id,billing_subscription_id,provider_account_id,provider_invoice_id,status,currency,amount_due_cents,amount_paid_cents,attempt_count,paid_at,provider_updated_at,service_period_start,service_period_end,provider_event_version,reconciliation_state,reconciliation_reason,billing_reason,verified_price_id,verified_tier,verified_event_id,verified_at,reconciliation_revision,line_item_count,line_item_digest,proof_eligible)
      values(v_owner,v_customer.id,v_subscription.id,p_platform,p_value->>'invoiceId',p_value->>'status',p_value->>'currency',(p_value->>'amountDueCents')::bigint,(p_value->>'amountPaidCents')::bigint,(p_value->>'attemptCount')::integer,nullif(p_value->>'paidAt','')::timestamptz,v_version,nullif(p_value->>'servicePeriodStart','')::timestamptz,nullif(p_value->>'servicePeriodEnd','')::timestamptz,v_version,p_value->>'verificationState',nullif(p_value->>'reason',''),nullif(p_value->>'billingReason',''),nullif(p_value->>'priceId',''),nullif(p_value->>'tier',''),case when p_value->>'verificationState'='verified_paid' then v_event.id else null end,case when p_value->>'verificationState'='verified_paid' then v_now else null end,1,coalesce(nullif(p_value->>'lineItemCount','')::integer,0),nullif(p_value->>'lineItemDigest',''),p_value->>'verificationState'='verified_paid') returning * into v_invoice;
  else
    update marketplace_private.shop_billing_invoices set billing_customer_id=v_customer.id,billing_subscription_id=v_subscription.id,status=p_value->>'status',currency=p_value->>'currency',amount_due_cents=(p_value->>'amountDueCents')::bigint,amount_paid_cents=(p_value->>'amountPaidCents')::bigint,attempt_count=(p_value->>'attemptCount')::integer,paid_at=nullif(p_value->>'paidAt','')::timestamptz,provider_updated_at=v_version,service_period_start=nullif(p_value->>'servicePeriodStart','')::timestamptz,service_period_end=nullif(p_value->>'servicePeriodEnd','')::timestamptz,provider_event_version=v_version,reconciliation_state=p_value->>'verificationState',reconciliation_reason=nullif(p_value->>'reason',''),billing_reason=nullif(p_value->>'billingReason',''),verified_price_id=nullif(p_value->>'priceId',''),verified_tier=nullif(p_value->>'tier',''),verified_event_id=case when p_value->>'verificationState'='verified_paid' then v_event.id else null end,verified_at=case when p_value->>'verificationState'='verified_paid' then v_now else null end,reconciliation_revision=reconciliation_revision+1,line_item_count=coalesce(nullif(p_value->>'lineItemCount','')::integer,0),line_item_digest=nullif(p_value->>'lineItemDigest',''),proof_eligible=p_value->>'verificationState'='verified_paid',updated_at=v_now where id=v_invoice.id returning * into v_invoice;
  end if;
  if v_invoice.proof_eligible then
    select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.billing_invoice_id=v_invoice.id for update;
    if found then
      if v_proof.provider_event_version <> v_invoice.provider_event_version or v_proof.line_item_digest <> v_invoice.line_item_digest then
        raise exception 'Conflicting Billing Invoice proof replay.' using errcode = '23505';
      end if;
    else
      insert into marketplace_private.shop_billing_invoice_proofs(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,billing_event_id,provider_account_id,provider_customer_id,provider_subscription_id,provider_invoice_id,provider_price_id,tier,currency,amount_due_cents,amount_paid_cents,billing_reason,service_period_start,service_period_end,provider_event_version,line_item_digest,verified_at)
        values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_event.id,p_platform,v_customer.provider_customer_id,v_subscription.provider_subscription_id,v_invoice.provider_invoice_id,v_invoice.verified_price_id,v_invoice.verified_tier,v_invoice.currency,v_invoice.amount_due_cents,v_invoice.amount_paid_cents,v_invoice.billing_reason,v_invoice.service_period_start,v_invoice.service_period_end,v_invoice.provider_event_version,v_invoice.line_item_digest,v_invoice.verified_at);
    end if;
    v_action := 'invoice_verified_paid';
  elsif v_invoice.reconciliation_state='payment_failed' then v_action := 'invoice_payment_failed';
  elsif v_invoice.reconciliation_state='action_required' then v_action := 'invoice_action_required';
  elsif v_invoice.reconciliation_state='unsupported' then v_action := 'invoice_unsupported';
  else v_action := 'invoice_rejected'; end if;
  insert into marketplace_private.shop_billing_invoice_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,billing_event_id,action,details)
    values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_event.id,v_action,jsonb_build_object('providerVersion',v_version,'state',v_invoice.reconciliation_state)) on conflict do nothing;
  return jsonb_build_object('applied',true,'state',v_invoice.reconciliation_state,'invoiceId',v_invoice.id,'proofEligible',v_invoice.proof_eligible);
end;$$;

revoke all on function marketplace_private.validate_shop_billing_invoice_proof(),
  marketplace_private.protect_shop_billing_invoice_proof_history(),
  public.marketplace_shop_billing_reconcile_invoice(text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_reconcile_invoice(text,text,uuid,jsonb) to service_role;

commit;

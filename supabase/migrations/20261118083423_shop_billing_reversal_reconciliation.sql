-- Phase 4B-4A: reconcile trusted Stripe reversals only.
--
-- This migration deliberately does not alter Shop Membership, Provider Terms,
-- or entitlement calculations. It records the provider facts needed for a
-- later, separately reviewed entitlement-reversal adapter.
begin;

create table marketplace_private.shop_billing_reversal_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  invoice_proof_id uuid not null references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_reversal_id text not null check (provider_reversal_id ~ '^(re|dp|in|ch)_[A-Za-z0-9]+$'),
  reversal_type text not null check (reversal_type in ('refund','dispute','invoice_reversal','charge_refund')),
  source_status text not null check (length(source_status) between 1 and 255),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null check (currency = 'CAD'),
  classification text not null check (classification in ('verified_full_reversal','manual_review','observed')),
  provider_event_version timestamptz not null,
  revision bigint not null default 0 check (revision >= 0),
  first_billing_event_id uuid not null references marketplace_private.shop_billing_events(id) on delete restrict,
  last_billing_event_id uuid not null references marketplace_private.shop_billing_events(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_reversal_id)
);

create table marketplace_private.shop_billing_reversal_proofs (
  id uuid primary key default gen_random_uuid(),
  reversal_state_id uuid not null unique references marketplace_private.shop_billing_reversal_states(id) on delete restrict,
  invoice_proof_id uuid not null unique references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_reversal_id text not null check (provider_reversal_id ~ '^(re|dp)_[A-Za-z0-9]+$'),
  reversal_type text not null check (reversal_type in ('refund','dispute')),
  source_status text not null check (source_status in ('succeeded','lost','funds_withdrawn')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency = 'CAD'),
  provider_event_version timestamptz not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_reversal_id)
);

create table marketplace_private.shop_billing_reversal_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  reversal_state_id uuid references marketplace_private.shop_billing_reversal_states(id) on delete restrict,
  reversal_proof_id uuid references marketplace_private.shop_billing_reversal_proofs(id) on delete restrict,
  billing_event_id uuid not null references marketplace_private.shop_billing_events(id) on delete restrict,
  action text not null check (action in ('reversal_state_recorded','reversal_state_updated','reversal_state_stale','reversal_manual_review','reversal_proof_created','reversal_proof_already_exists')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);

create unique index shop_billing_reversal_audit_event_action_unique
  on marketplace_private.shop_billing_reversal_reconciliation_audit(billing_event_id, action);
create index shop_billing_reversal_states_invoice_idx
  on marketplace_private.shop_billing_reversal_states(billing_invoice_id, provider_event_version desc);

create function marketplace_private.validate_shop_billing_reversal_state()
returns trigger language plpgsql set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
  v_invoice marketplace_private.shop_billing_invoices;
  v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions;
begin
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = new.billing_invoice_id;
  select * into v_customer from marketplace_private.shop_billing_customers c where c.id = new.billing_customer_id;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = new.billing_subscription_id;
  if v_proof.id is null or v_invoice.id is null or v_customer.id is null or v_subscription.id is null
     or v_proof.owner_id is distinct from new.owner_id
     or v_invoice.owner_id is distinct from new.owner_id
     or v_customer.owner_id is distinct from new.owner_id
     or v_subscription.owner_id is distinct from new.owner_id
     or v_proof.billing_invoice_id is distinct from new.billing_invoice_id
     or v_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_invoice.billing_customer_id is distinct from new.billing_customer_id
     or v_invoice.billing_subscription_id is distinct from new.billing_subscription_id
     or v_subscription.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.provider_account_id is distinct from new.provider_account_id
     or v_invoice.provider_account_id is distinct from new.provider_account_id
     or v_customer.provider_account_id is distinct from new.provider_account_id
     or v_subscription.provider_account_id is distinct from new.provider_account_id then
    raise exception 'Billing reversal state must match one immutable Invoice proof.' using errcode = '23514';
  end if;
  if new.classification = 'verified_full_reversal' and (
    new.reversal_type not in ('refund','dispute')
    or new.amount_cents <> v_proof.amount_paid_cents
    or new.currency <> v_proof.currency
  ) then
    raise exception 'Verified Billing reversal must fully match the paid Invoice proof.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.validate_shop_billing_reversal_proof()
returns trigger language plpgsql set search_path='' as $$
declare v_state marketplace_private.shop_billing_reversal_states;
  v_invoice_proof marketplace_private.shop_billing_invoice_proofs;
begin
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = new.reversal_state_id;
  select * into v_invoice_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  if v_state.id is null or v_invoice_proof.id is null
     or v_state.classification <> 'verified_full_reversal'
     or v_state.invoice_proof_id is distinct from new.invoice_proof_id
     or v_state.owner_id is distinct from new.owner_id
     or v_state.billing_customer_id is distinct from new.billing_customer_id
     or v_state.billing_subscription_id is distinct from new.billing_subscription_id
     or v_state.billing_invoice_id is distinct from new.billing_invoice_id
     or v_state.provider is distinct from new.provider
     or v_state.provider_account_id is distinct from new.provider_account_id
     or v_state.provider_reversal_id is distinct from new.provider_reversal_id
     or v_state.reversal_type is distinct from new.reversal_type
     or v_state.source_status is distinct from new.source_status
     or v_state.amount_cents is distinct from new.amount_cents
     or v_state.currency is distinct from new.currency
     or v_state.provider_event_version is distinct from new.provider_event_version
     or v_invoice_proof.amount_paid_cents is distinct from new.amount_cents
     or v_invoice_proof.currency is distinct from new.currency then
    raise exception 'Billing reversal proof must match one verified full reversal state.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_reversal_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing reversal history is immutable.' using errcode = '42501';
end;$$;

create trigger shop_billing_reversal_state_relationship
before insert or update on marketplace_private.shop_billing_reversal_states
for each row execute function marketplace_private.validate_shop_billing_reversal_state();
create trigger shop_billing_reversal_proof_relationship
before insert or update on marketplace_private.shop_billing_reversal_proofs
for each row execute function marketplace_private.validate_shop_billing_reversal_proof();
create trigger shop_billing_reversal_proof_immutable
before update or delete on marketplace_private.shop_billing_reversal_proofs
for each row execute function marketplace_private.protect_shop_billing_reversal_history();
create trigger shop_billing_reversal_audit_immutable
before update or delete on marketplace_private.shop_billing_reversal_reconciliation_audit
for each row execute function marketplace_private.protect_shop_billing_reversal_history();

alter table marketplace_private.shop_billing_reversal_states enable row level security;
alter table marketplace_private.shop_billing_reversal_proofs enable row level security;
alter table marketplace_private.shop_billing_reversal_reconciliation_audit enable row level security;
revoke all on marketplace_private.shop_billing_reversal_states,
  marketplace_private.shop_billing_reversal_proofs,
  marketplace_private.shop_billing_reversal_reconciliation_audit
  from public, anon, authenticated, service_role;

create function public.marketplace_shop_billing_reconcile_reversal(
  p_platform text,
  p_event_id text,
  p_lease uuid,
  p_value jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event marketplace_private.shop_billing_events;
  v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_invoice marketplace_private.shop_billing_invoices;
  v_invoice_proof marketplace_private.shop_billing_invoice_proofs;
  v_state marketplace_private.shop_billing_reversal_states;
  v_proof marketplace_private.shop_billing_reversal_proofs;
  v_owner uuid; v_version timestamptz; v_now timestamptz := clock_timestamp();
  v_action text; v_verified boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_platform !~ '^acct_[A-Za-z0-9]+$'
     or p_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_lease is null
     or jsonb_typeof(p_value) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('sourceObjectId','reversalId','reversalType','sourceStatus','customerId','subscriptionId','invoiceId','amountCents','currency','classification','providerVersion'))
     or (p_value->>'sourceObjectId') !~ '^(re|dp|in|ch)_[A-Za-z0-9]+$'
     or (p_value->>'reversalId') !~ '^(re|dp|in|ch)_[A-Za-z0-9]+$'
     or (p_value->>'reversalType') not in ('refund','dispute','invoice_reversal','charge_refund')
     or coalesce(length(p_value->>'sourceStatus'),0) not between 1 and 255
     or (p_value->>'customerId') !~ '^cus_[A-Za-z0-9]+$'
     or (p_value->>'subscriptionId') !~ '^sub_[A-Za-z0-9]+$'
     or (p_value->>'invoiceId') !~ '^in_[A-Za-z0-9]+$'
     or (p_value->>'amountCents') !~ '^[0-9]+$'
     or (p_value->>'currency') <> 'CAD'
     or (p_value->>'classification') not in ('verified_full_reversal','manual_review','observed')
     or nullif(p_value->>'providerVersion','') is null then
    raise exception 'Invalid Billing reversal reconciliation.' using errcode = '23514';
  end if;
  select * into v_event from marketplace_private.shop_billing_events e
    where e.provider = 'stripe' and e.provider_account_id = p_platform and e.provider_event_id = p_event_id for update;
  if not found or v_event.processing_status <> 'processing' or v_event.lease_token is distinct from p_lease
     or v_event.event_type not in ('refund.created','refund.updated','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated','invoice.voided','invoice.marked_uncollectible')
     or v_event.provider_object_id is distinct from p_value->>'sourceObjectId' then
    raise exception 'Billing reversal event lease is invalid.' using errcode = '40001';
  end if;
  select * into v_customer from marketplace_private.shop_billing_customers c
    where c.provider = 'stripe' and c.provider_account_id = p_platform and c.provider_customer_id = p_value->>'customerId' for update;
  if not found then raise exception 'Verified Billing customer binding was not found.' using errcode = '23514'; end if;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s
    where s.provider = 'stripe' and s.provider_account_id = p_platform and s.provider_subscription_id = p_value->>'subscriptionId' for update;
  if not found or v_subscription.owner_id <> v_customer.owner_id or v_subscription.billing_customer_id <> v_customer.id then
    raise exception 'Billing reversal subscription binding mismatch.' using errcode = '23514';
  end if;
  select * into v_invoice from marketplace_private.shop_billing_invoices i
    where i.provider = 'stripe' and i.provider_account_id = p_platform and i.provider_invoice_id = p_value->>'invoiceId' for update;
  if not found or v_invoice.owner_id <> v_customer.owner_id
     or v_invoice.billing_customer_id <> v_customer.id or v_invoice.billing_subscription_id <> v_subscription.id then
    raise exception 'Billing reversal Invoice binding mismatch.' using errcode = '23514';
  end if;
  select * into v_invoice_proof from marketplace_private.shop_billing_invoice_proofs p
    where p.billing_invoice_id = v_invoice.id for update;
  if not found then raise exception 'Immutable verified Billing Invoice proof required.' using errcode = '23514'; end if;
  if p_value->>'classification' = 'verified_full_reversal' and (
    p_value->>'reversalType' not in ('refund','dispute')
    or (p_value->>'amountCents')::bigint <> v_invoice_proof.amount_paid_cents
    or v_invoice_proof.currency <> p_value->>'currency'
    or (p_value->>'reversalType' = 'refund' and p_value->>'sourceStatus' <> 'succeeded')
    or (p_value->>'reversalType' = 'dispute' and p_value->>'sourceStatus' not in ('lost','funds_withdrawn'))
  ) then
    raise exception 'Verified Billing reversal proof is invalid.' using errcode = '23514';
  end if;
  v_owner := v_customer.owner_id;
  v_version := (p_value->>'providerVersion')::timestamptz;
  select * into v_state from marketplace_private.shop_billing_reversal_states s
    where s.provider = 'stripe' and s.provider_account_id = p_platform and s.provider_reversal_id = p_value->>'reversalId' for update;
  if found and v_state.provider_event_version > v_version then
    insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,billing_event_id,action,details)
      values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_event.id,'reversal_state_stale',jsonb_build_object('providerVersion',v_version)) on conflict do nothing;
    return jsonb_build_object('applied',false,'state','stale','reversalStateId',v_state.id);
  end if;
  if found then
    update marketplace_private.shop_billing_reversal_states set
      source_status = p_value->>'sourceStatus', amount_cents = (p_value->>'amountCents')::bigint,
      currency = p_value->>'currency', classification = p_value->>'classification',
      provider_event_version = v_version, last_billing_event_id = v_event.id,
      revision = revision + 1, updated_at = v_now
      where id = v_state.id returning * into v_state;
    v_action := 'reversal_state_updated';
  else
    insert into marketplace_private.shop_billing_reversal_states(
      owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,invoice_proof_id,
      provider_account_id,provider_reversal_id,reversal_type,source_status,amount_cents,currency,
      classification,provider_event_version,first_billing_event_id,last_billing_event_id
    ) values (
      v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_invoice_proof.id,
      p_platform,p_value->>'reversalId',p_value->>'reversalType',p_value->>'sourceStatus',
      (p_value->>'amountCents')::bigint,p_value->>'currency',p_value->>'classification',v_version,
      v_event.id,v_event.id
    ) returning * into v_state;
    v_action := 'reversal_state_recorded';
  end if;
  insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,billing_event_id,action,details)
    values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_event.id,v_action,jsonb_build_object('classification',v_state.classification,'providerVersion',v_state.provider_event_version)) on conflict do nothing;
  if v_state.classification = 'verified_full_reversal' then
    select * into v_proof from marketplace_private.shop_billing_reversal_proofs p where p.invoice_proof_id = v_invoice_proof.id for update;
    if found then
      if v_proof.provider_reversal_id <> v_state.provider_reversal_id then
        update marketplace_private.shop_billing_reversal_states set classification = 'manual_review', revision = revision + 1, updated_at = v_now where id = v_state.id returning * into v_state;
        insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,reversal_proof_id,billing_event_id,action,details)
          values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_proof.id,v_event.id,'reversal_manual_review',jsonb_build_object('reason','invoice_already_has_verified_reversal_proof')) on conflict do nothing;
        return jsonb_build_object('applied',true,'state',v_state.classification,'reversalStateId',v_state.id,'proofEligible',false);
      end if;
      insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,reversal_proof_id,billing_event_id,action,details)
        values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_proof.id,v_event.id,'reversal_proof_already_exists',jsonb_build_object('providerVersion',v_proof.provider_event_version)) on conflict do nothing;
      return jsonb_build_object('applied',false,'state','already_verified','reversalStateId',v_state.id,'reversalProofId',v_proof.id,'proofEligible',true);
    end if;
    insert into marketplace_private.shop_billing_reversal_proofs(
      reversal_state_id,invoice_proof_id,owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,
      provider_account_id,provider_reversal_id,reversal_type,source_status,amount_cents,currency,
      provider_event_version,verified_at
    ) values (
      v_state.id,v_invoice_proof.id,v_owner,v_customer.id,v_subscription.id,v_invoice.id,
      p_platform,v_state.provider_reversal_id,v_state.reversal_type,v_state.source_status,v_state.amount_cents,
      v_state.currency,v_state.provider_event_version,v_now
    ) returning * into v_proof;
    insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,reversal_proof_id,billing_event_id,action,details)
      values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_proof.id,v_event.id,'reversal_proof_created',jsonb_build_object('providerVersion',v_proof.provider_event_version)) on conflict do nothing;
    v_verified := true;
  elsif v_state.classification = 'manual_review' then
    insert into marketplace_private.shop_billing_reversal_reconciliation_audit(owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,reversal_state_id,billing_event_id,action,details)
      values(v_owner,v_customer.id,v_subscription.id,v_invoice.id,v_state.id,v_event.id,'reversal_manual_review',jsonb_build_object('providerVersion',v_state.provider_event_version)) on conflict do nothing;
  end if;
  return jsonb_build_object('applied',true,'state',v_state.classification,'reversalStateId',v_state.id,'proofEligible',v_verified,'reversalProofId',case when v_verified then v_proof.id else null end);
end;$$;

revoke all on function marketplace_private.validate_shop_billing_reversal_state(),
  marketplace_private.validate_shop_billing_reversal_proof(),
  marketplace_private.protect_shop_billing_reversal_history(),
  public.marketplace_shop_billing_reconcile_reversal(text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_reconcile_reversal(text,text,uuid,jsonb) to service_role;

commit;

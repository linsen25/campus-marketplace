-- Phase 4B-4B: a verified full-refund reversal proof may revoke only its
-- exact paid Provider Term. This remains service-only and feature-gated in
-- the server adapter; no webhook payload can grant this authority directly.
begin;

create table marketplace_private.shop_billing_reversal_entitlement_applications (
  id uuid primary key default gen_random_uuid(),
  reversal_proof_id uuid not null unique references marketplace_private.shop_billing_reversal_proofs(id) on delete restrict,
  invoice_proof_id uuid not null unique references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null unique references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider_term_id uuid not null unique references marketplace_private.shop_membership_provider_terms(id) on delete restrict,
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_event_version timestamptz not null,
  applied_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create table marketplace_private.shop_billing_reversal_entitlement_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  reversal_proof_id uuid not null references marketplace_private.shop_billing_reversal_proofs(id) on delete restrict,
  invoice_proof_id uuid not null references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider_term_id uuid not null references marketplace_private.shop_membership_provider_terms(id) on delete restrict,
  action text not null check (action in ('reversal_entitlement_applied','reversal_entitlement_already_applied')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_billing_reversal_entitlement_audit_proof_action_unique
  on marketplace_private.shop_billing_reversal_entitlement_audit(reversal_proof_id, action);

create function marketplace_private.validate_shop_billing_reversal_entitlement_application()
returns trigger language plpgsql set search_path='' as $$
declare v_reversal marketplace_private.shop_billing_reversal_proofs;
  v_state marketplace_private.shop_billing_reversal_states;
  v_invoice_proof marketplace_private.shop_billing_invoice_proofs;
  v_term marketplace_private.shop_membership_provider_terms;
begin
  select * into v_reversal from marketplace_private.shop_billing_reversal_proofs p where p.id = new.reversal_proof_id;
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = v_reversal.reversal_state_id;
  select * into v_invoice_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  select * into v_term from marketplace_private.shop_membership_provider_terms t where t.id = new.provider_term_id;
  if v_reversal.id is null or v_state.id is null or v_invoice_proof.id is null or v_term.id is null
     or v_state.classification <> 'verified_full_reversal'
     or v_reversal.reversal_type <> 'refund' or v_reversal.source_status <> 'succeeded'
     or v_reversal.invoice_proof_id is distinct from new.invoice_proof_id
     or v_reversal.owner_id is distinct from new.owner_id
     or v_reversal.billing_customer_id is distinct from new.billing_customer_id
     or v_reversal.billing_subscription_id is distinct from new.billing_subscription_id
     or v_reversal.billing_invoice_id is distinct from new.billing_invoice_id
     or v_reversal.provider_account_id is distinct from new.provider_account_id
     or v_reversal.provider_event_version is distinct from new.provider_event_version
     or v_invoice_proof.owner_id is distinct from new.owner_id
     or v_invoice_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_invoice_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_invoice_proof.billing_invoice_id is distinct from new.billing_invoice_id
     or v_term.owner_id is distinct from new.owner_id
     or v_term.billing_customer_id is distinct from new.billing_customer_id
     or v_term.billing_subscription_id is distinct from new.billing_subscription_id
     or v_term.billing_invoice_id is distinct from new.billing_invoice_id
     or v_term.provider_account_id is distinct from new.provider_account_id
     or v_term.provider_invoice_id is distinct from v_invoice_proof.provider_invoice_id
     or v_reversal.amount_cents is distinct from v_invoice_proof.amount_paid_cents
     or v_reversal.currency is distinct from v_invoice_proof.currency then
    raise exception 'Billing reversal entitlement application must match one verified full-refund proof and exact Provider Term.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_reversal_entitlement_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing reversal entitlement history is immutable.' using errcode = '42501';
end;$$;

create trigger shop_billing_reversal_entitlement_application_relationship
before insert or update on marketplace_private.shop_billing_reversal_entitlement_applications
for each row execute function marketplace_private.validate_shop_billing_reversal_entitlement_application();
create trigger shop_billing_reversal_entitlement_application_immutable
before update or delete on marketplace_private.shop_billing_reversal_entitlement_applications
for each row execute function marketplace_private.protect_shop_billing_reversal_entitlement_history();
create trigger shop_billing_reversal_entitlement_audit_immutable
before update or delete on marketplace_private.shop_billing_reversal_entitlement_audit
for each row execute function marketplace_private.protect_shop_billing_reversal_entitlement_history();

alter table marketplace_private.shop_billing_reversal_entitlement_applications enable row level security;
alter table marketplace_private.shop_billing_reversal_entitlement_audit enable row level security;
revoke all on marketplace_private.shop_billing_reversal_entitlement_applications,
  marketplace_private.shop_billing_reversal_entitlement_audit
  from public, anon, authenticated, service_role;

create function public.marketplace_shop_billing_apply_reversal_proof(p_reversal_proof_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reversal marketplace_private.shop_billing_reversal_proofs;
  v_state marketplace_private.shop_billing_reversal_states;
  v_invoice_proof marketplace_private.shop_billing_invoice_proofs;
  v_invoice marketplace_private.shop_billing_invoices;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_customer marketplace_private.shop_billing_customers;
  v_term marketplace_private.shop_membership_provider_terms;
  v_membership marketplace_private.shop_memberships;
  v_application marketplace_private.shop_billing_reversal_entitlement_applications;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or p_reversal_proof_id is null then
    raise exception 'Trusted Billing reversal entitlement adapter required.' using errcode = '42501';
  end if;
  select * into v_reversal from marketplace_private.shop_billing_reversal_proofs p where p.id = p_reversal_proof_id for update;
  if not found then raise exception 'Immutable verified Billing reversal proof required.' using errcode = '23514'; end if;
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = v_reversal.reversal_state_id for update;
  select * into v_invoice_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = v_reversal.invoice_proof_id for update;
  select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = v_reversal.billing_invoice_id for update;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = v_reversal.billing_subscription_id for update;
  select * into v_customer from marketplace_private.shop_billing_customers c where c.id = v_reversal.billing_customer_id for update;
  select * into v_term from marketplace_private.shop_membership_provider_terms t where t.billing_invoice_id = v_reversal.billing_invoice_id for update;
  if v_state.id is null or v_invoice_proof.id is null or v_invoice.id is null or v_subscription.id is null or v_customer.id is null or v_term.id is null
     or v_state.classification <> 'verified_full_reversal'
     or v_reversal.reversal_type <> 'refund' or v_reversal.source_status <> 'succeeded'
     or v_reversal.owner_id is distinct from v_invoice_proof.owner_id
     or v_reversal.owner_id is distinct from v_invoice.owner_id
     or v_reversal.owner_id is distinct from v_subscription.owner_id
     or v_reversal.owner_id is distinct from v_customer.owner_id
     or v_reversal.owner_id is distinct from v_term.owner_id
     or v_reversal.billing_customer_id is distinct from v_invoice_proof.billing_customer_id
     or v_reversal.billing_customer_id is distinct from v_invoice.billing_customer_id
     or v_reversal.billing_customer_id is distinct from v_subscription.billing_customer_id
     or v_reversal.billing_customer_id is distinct from v_term.billing_customer_id
     or v_reversal.billing_subscription_id is distinct from v_invoice_proof.billing_subscription_id
     or v_reversal.billing_subscription_id is distinct from v_invoice.billing_subscription_id
     or v_reversal.billing_subscription_id is distinct from v_term.billing_subscription_id
     or v_reversal.billing_invoice_id is distinct from v_invoice_proof.billing_invoice_id
     or v_reversal.billing_invoice_id is distinct from v_term.billing_invoice_id
     or v_reversal.provider_account_id is distinct from v_invoice_proof.provider_account_id
     or v_reversal.provider_account_id is distinct from v_invoice.provider_account_id
     or v_reversal.provider_account_id is distinct from v_subscription.provider_account_id
     or v_reversal.provider_account_id is distinct from v_customer.provider_account_id
     or v_reversal.provider_account_id is distinct from v_term.provider_account_id
     or v_reversal.amount_cents is distinct from v_invoice_proof.amount_paid_cents
     or v_reversal.currency is distinct from v_invoice_proof.currency then
    raise exception 'Verified Billing reversal proof binding mismatch.' using errcode = '23514';
  end if;
  select * into v_application from marketplace_private.shop_billing_reversal_entitlement_applications a
    where a.reversal_proof_id = v_reversal.id for update;
  if found then
    insert into marketplace_private.shop_billing_reversal_entitlement_audit(owner_id,reversal_proof_id,invoice_proof_id,billing_invoice_id,provider_term_id,action,details)
      values(v_application.owner_id,v_application.reversal_proof_id,v_application.invoice_proof_id,v_application.billing_invoice_id,v_application.provider_term_id,'reversal_entitlement_already_applied',jsonb_build_object('providerVersion',v_application.provider_event_version)) on conflict do nothing;
    return jsonb_build_object('outcome','already_applied','providerTermId',v_application.provider_term_id,'ownerId',v_application.owner_id);
  end if;
  if v_term.revoked_at is not null then
    raise exception 'Provider Term is already revoked without this reversal application.' using errcode = '23514';
  end if;
  select * into v_membership from marketplace_private.shop_memberships m where m.owner_id = v_reversal.owner_id for update;
  if not found then raise exception 'Provider Membership authority was not found.' using errcode = '23514'; end if;
  update marketplace_private.shop_membership_provider_terms set
    revoked_at = v_now, revoke_reason = 'refund', grace_reason = null,
    grace_ends_at = null, grace_provider_version = null,
    entitlement_revision = entitlement_revision + 1, updated_at = v_now
    where id = v_term.id returning * into v_term;
  insert into marketplace_private.shop_billing_reversal_entitlement_applications(
    reversal_proof_id,invoice_proof_id,owner_id,billing_customer_id,billing_subscription_id,
    billing_invoice_id,provider_term_id,provider_account_id,provider_event_version
  ) values (
    v_reversal.id,v_invoice_proof.id,v_reversal.owner_id,v_customer.id,v_subscription.id,
    v_invoice.id,v_term.id,v_reversal.provider_account_id,v_reversal.provider_event_version
  ) returning * into v_application;
  update marketplace_private.shop_memberships set revision = revision + 1 where owner_id = v_reversal.owner_id;
  insert into marketplace_private.shop_membership_billing_audit_log(owner_id,provider_term_id,billing_customer_id,billing_subscription_id,billing_invoice_id,action,details)
    values(v_reversal.owner_id,v_term.id,v_customer.id,v_subscription.id,v_invoice.id,'provider_term_revoked',jsonb_build_object('providerVersion',v_reversal.provider_event_version,'reversalProofId',v_reversal.id,'policy','provisional_immediate_full_refund'));
  insert into marketplace_private.shop_billing_reversal_entitlement_audit(owner_id,reversal_proof_id,invoice_proof_id,billing_invoice_id,provider_term_id,action,details)
    values(v_reversal.owner_id,v_reversal.id,v_invoice_proof.id,v_invoice.id,v_term.id,'reversal_entitlement_applied',jsonb_build_object('providerVersion',v_reversal.provider_event_version,'policy','provisional_immediate_full_refund'));
  return jsonb_build_object('outcome','applied','providerTermId',v_term.id,'ownerId',v_term.owner_id);
end;$$;

revoke all on function marketplace_private.validate_shop_billing_reversal_entitlement_application(),
  marketplace_private.protect_shop_billing_reversal_entitlement_history(),
  public.marketplace_shop_billing_apply_reversal_proof(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_apply_reversal_proof(uuid) to service_role;

commit;

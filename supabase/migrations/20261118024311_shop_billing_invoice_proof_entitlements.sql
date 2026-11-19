-- Phase 4B-3: only a Phase 4B-2 immutable Invoice proof may create a provider term.
-- This migration is deliberately provider/Test-mode agnostic; feature gating lives in the
-- server adapter. The database boundary remains fail-closed if that adapter is bypassed.
begin;

create table marketplace_private.shop_billing_invoice_entitlement_applications (
  id uuid primary key default gen_random_uuid(),
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

create table marketplace_private.shop_billing_entitlement_application_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  invoice_proof_id uuid references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  billing_invoice_id uuid references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider_term_id uuid references marketplace_private.shop_membership_provider_terms(id) on delete restrict,
  action text not null check (action in ('proof_entitlement_applied','proof_entitlement_already_applied','payment_state_synced')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_billing_entitlement_application_audit_proof_action_unique
  on marketplace_private.shop_billing_entitlement_application_audit(invoice_proof_id, action)
  where invoice_proof_id is not null;

create function marketplace_private.validate_shop_billing_invoice_entitlement_application()
returns trigger language plpgsql set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
  v_term marketplace_private.shop_membership_provider_terms;
begin
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  select * into v_term from marketplace_private.shop_membership_provider_terms t where t.id = new.provider_term_id;
  if v_proof.id is null or v_term.id is null
     or v_proof.owner_id is distinct from new.owner_id
     or v_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_proof.billing_invoice_id is distinct from new.billing_invoice_id
     or v_proof.provider_account_id is distinct from new.provider_account_id
     or v_proof.provider_event_version is distinct from new.provider_event_version
     or v_term.owner_id is distinct from new.owner_id
     or v_term.billing_customer_id is distinct from new.billing_customer_id
     or v_term.billing_subscription_id is distinct from new.billing_subscription_id
     or v_term.billing_invoice_id is distinct from new.billing_invoice_id
     or v_term.provider_account_id is distinct from new.provider_account_id
     or v_term.provider_event_version is distinct from new.provider_event_version then
    raise exception 'Billing entitlement application must match one verified Invoice proof.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_entitlement_application_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing entitlement application history is immutable.' using errcode = '42501';
end;$$;

create trigger shop_billing_invoice_entitlement_application_relationship
before insert or update on marketplace_private.shop_billing_invoice_entitlement_applications
for each row execute function marketplace_private.validate_shop_billing_invoice_entitlement_application();
create trigger shop_billing_invoice_entitlement_application_immutable
before update or delete on marketplace_private.shop_billing_invoice_entitlement_applications
for each row execute function marketplace_private.protect_shop_billing_entitlement_application_history();
create trigger shop_billing_entitlement_application_audit_immutable
before update or delete on marketplace_private.shop_billing_entitlement_application_audit
for each row execute function marketplace_private.protect_shop_billing_entitlement_application_history();

alter table marketplace_private.shop_billing_invoice_entitlement_applications enable row level security;
alter table marketplace_private.shop_billing_entitlement_application_audit enable row level security;
revoke all on marketplace_private.shop_billing_invoice_entitlement_applications,
  marketplace_private.shop_billing_entitlement_application_audit from public, anon, authenticated, service_role;

-- Replace the Phase 4B-1 relationship guard: a mutable Invoice is insufficient.
-- A Provider Term must exactly reflect the immutable reconciled proof instead.
create or replace function marketplace_private.validate_shop_membership_provider_term()
returns trigger language plpgsql set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
begin
  select * into v_proof
  from marketplace_private.shop_billing_invoice_proofs p
  where p.billing_invoice_id = new.billing_invoice_id
  for key share;
  if v_proof.id is null
     or v_proof.owner_id is distinct from new.owner_id
     or v_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_proof.provider is distinct from new.provider
     or v_proof.provider_account_id is distinct from new.provider_account_id
     or v_proof.provider_customer_id is distinct from new.provider_customer_id
     or v_proof.provider_subscription_id is distinct from new.provider_subscription_id
     or v_proof.provider_invoice_id is distinct from new.provider_invoice_id
     or v_proof.provider_price_id is distinct from new.provider_price_id
     or v_proof.tier is distinct from new.tier
     or v_proof.service_period_start is distinct from new.service_period_start
     or v_proof.service_period_end is distinct from new.service_period_end
     or v_proof.provider_event_version is distinct from new.provider_event_version then
    raise exception 'Provider Membership term must match one immutable verified Billing Invoice proof.' using errcode = '23514';
  end if;
  return new;
end;$$;

create or replace function public.marketplace_shop_billing_membership_command(
  p_action text,
  p_billing_invoice_id uuid default null,
  p_billing_subscription_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
  v_invoice marketplace_private.shop_billing_invoices;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_customer marketplace_private.shop_billing_customers;
  v_application marketplace_private.shop_billing_invoice_entitlement_applications;
  v_existing marketplace_private.shop_membership_provider_terms;
  v_term marketplace_private.shop_membership_provider_terms;
  v_membership marketplace_private.shop_memberships;
  v_legacy jsonb; v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role'
     or p_action not in ('apply_paid_invoice', 'record_payment_failure', 'resolve_payment_state') then
    raise exception 'Trusted Billing entitlement adapter required.' using errcode = '42501';
  end if;
  if p_action = 'apply_paid_invoice' then
    if p_billing_invoice_id is null or p_billing_subscription_id is not null then
      raise exception 'Invalid paid Invoice entitlement command.' using errcode = '23514';
    end if;
    select * into v_proof from marketplace_private.shop_billing_invoice_proofs p
      where p.billing_invoice_id = p_billing_invoice_id for update;
    if not found then
      raise exception 'Immutable verified Billing Invoice proof required.' using errcode = '23514';
    end if;
    select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = v_proof.billing_invoice_id for update;
    select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = v_proof.billing_subscription_id for update;
    select * into v_customer from marketplace_private.shop_billing_customers c where c.id = v_proof.billing_customer_id for update;
    if v_invoice.id is null or v_subscription.id is null or v_customer.id is null
       or v_invoice.owner_id is distinct from v_proof.owner_id
       or v_subscription.owner_id is distinct from v_proof.owner_id
       or v_customer.owner_id is distinct from v_proof.owner_id
       or v_invoice.billing_customer_id is distinct from v_proof.billing_customer_id
       or v_invoice.billing_subscription_id is distinct from v_proof.billing_subscription_id
       or v_subscription.billing_customer_id is distinct from v_customer.id
       or v_invoice.provider is distinct from v_proof.provider
       or v_subscription.provider is distinct from v_proof.provider
       or v_customer.provider is distinct from v_proof.provider
       or v_invoice.provider_account_id is distinct from v_proof.provider_account_id
       or v_subscription.provider_account_id is distinct from v_proof.provider_account_id
       or v_customer.provider_account_id is distinct from v_proof.provider_account_id
       or v_customer.provider_customer_id is distinct from v_proof.provider_customer_id
       or v_subscription.provider_subscription_id is distinct from v_proof.provider_subscription_id
       or v_invoice.provider_invoice_id is distinct from v_proof.provider_invoice_id
       or v_invoice.currency is distinct from v_proof.currency
       or v_invoice.amount_due_cents is distinct from v_proof.amount_due_cents
       or v_invoice.amount_paid_cents is distinct from v_proof.amount_paid_cents
       or v_invoice.billing_reason is distinct from v_proof.billing_reason
       or v_invoice.service_period_start is distinct from v_proof.service_period_start
       or v_invoice.service_period_end is distinct from v_proof.service_period_end
       or v_invoice.provider_event_version is distinct from v_proof.provider_event_version then
      raise exception 'Verified Billing Invoice proof binding mismatch.' using errcode = '23514';
    end if;
    select * into v_application from marketplace_private.shop_billing_invoice_entitlement_applications a
      where a.invoice_proof_id = v_proof.id for update;
    if found then
      insert into marketplace_private.shop_billing_entitlement_application_audit(owner_id,invoice_proof_id,billing_invoice_id,provider_term_id,action,details)
        values(v_application.owner_id,v_application.invoice_proof_id,v_application.billing_invoice_id,v_application.provider_term_id,'proof_entitlement_already_applied',jsonb_build_object('providerVersion',v_application.provider_event_version))
        on conflict do nothing;
      return jsonb_build_object('outcome','already_applied','providerTermId',v_application.provider_term_id,'ownerId',v_application.owner_id);
    end if;
    select * into v_existing from marketplace_private.shop_membership_provider_terms t where t.billing_invoice_id = v_invoice.id for update;
    if found then
      raise exception 'Provider term exists without a Proof application record.' using errcode = '23514';
    end if;
    insert into marketplace_private.shop_memberships(owner_id) values(v_proof.owner_id) on conflict do nothing;
    select * into v_membership from marketplace_private.shop_memberships m where m.owner_id = v_proof.owner_id for update;
    v_legacy := marketplace_private.shop_legacy_entitlements(v_proof.owner_id, v_now);
    if v_legacy->>'status' in ('trial','active','grace') then
      raise exception 'Legacy Membership coverage must end before provider coverage begins.' using errcode = '40001';
    end if;
    if exists(
      select 1 from marketplace_private.shop_membership_provider_terms t
      where t.owner_id = v_proof.owner_id and t.revoked_at is null
        and tstzrange(t.service_period_start,t.service_period_end,'[)') && tstzrange(v_proof.service_period_start,v_proof.service_period_end,'[)')
    ) then
      raise exception 'Provider Invoice service period overlaps existing coverage.' using errcode = '23505';
    end if;
    insert into marketplace_private.shop_membership_provider_terms(
      owner_id,provider_account_id,billing_customer_id,billing_subscription_id,billing_invoice_id,
      provider_customer_id,provider_subscription_id,provider_invoice_id,provider_price_id,tier,payment_confirmed_at,
      service_period_start,service_period_end,provider_subscription_status,billing_revision,provider_event_version,
      cancel_at_period_end,canceled_at
    ) values (
      v_proof.owner_id,v_proof.provider_account_id,v_customer.id,v_subscription.id,v_invoice.id,
      v_proof.provider_customer_id,v_proof.provider_subscription_id,v_proof.provider_invoice_id,
      v_proof.provider_price_id,v_proof.tier,v_proof.verified_at,
      v_proof.service_period_start,v_proof.service_period_end,v_subscription.status,v_subscription.revision,
      v_proof.provider_event_version,v_subscription.cancel_at_period_end,v_subscription.canceled_at
    ) returning * into v_term;
    insert into marketplace_private.shop_billing_invoice_entitlement_applications(
      invoice_proof_id,owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,provider_term_id,
      provider_account_id,provider_event_version
    ) values (
      v_proof.id,v_proof.owner_id,v_customer.id,v_subscription.id,v_invoice.id,v_term.id,
      v_proof.provider_account_id,v_proof.provider_event_version
    );
    update marketplace_private.shop_memberships set revision = revision + 1 where owner_id = v_proof.owner_id;
    insert into marketplace_private.shop_membership_billing_audit_log(owner_id,provider_term_id,billing_customer_id,billing_subscription_id,billing_invoice_id,action,details)
      values(v_term.owner_id,v_term.id,v_customer.id,v_subscription.id,v_invoice.id,'paid_term_applied',jsonb_build_object('providerVersion',v_term.provider_event_version,'billingRevision',v_term.billing_revision));
    insert into marketplace_private.shop_billing_entitlement_application_audit(owner_id,invoice_proof_id,billing_invoice_id,provider_term_id,action,details)
      values(v_term.owner_id,v_proof.id,v_invoice.id,v_term.id,'proof_entitlement_applied',jsonb_build_object('providerVersion',v_proof.provider_event_version));
    return jsonb_build_object('outcome','applied','providerTermId',v_term.id,'ownerId',v_term.owner_id);
  end if;

  if p_billing_subscription_id is null or p_billing_invoice_id is not null then
    raise exception 'Invalid provider payment-state command.' using errcode = '23514';
  end if;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = p_billing_subscription_id for update;
  if not found then raise exception 'Verified Billing subscription was not found.' using errcode = '23514'; end if;
  select * into v_term from marketplace_private.shop_membership_provider_terms t
    where t.billing_subscription_id = v_subscription.id and t.revoked_at is null
    order by t.service_period_end desc limit 1 for update;
  if not found then return jsonb_build_object('outcome','no_paid_coverage'); end if;
  if p_action = 'record_payment_failure' then
    if v_subscription.status <> 'past_due' then
      raise exception 'Past-due provider state required for Grace.' using errcode = '23514';
    end if;
    if v_term.grace_provider_version is not null and v_term.grace_provider_version >= coalesce(v_subscription.provider_updated_at,'epoch'::timestamptz) then
      return jsonb_build_object('outcome','already_applied','providerTermId',v_term.id);
    end if;
    update marketplace_private.shop_membership_provider_terms set grace_reason='payment_failed',
      grace_ends_at=service_period_end+interval '432000 seconds',grace_provider_version=coalesce(v_subscription.provider_updated_at,v_now),
      provider_subscription_status=v_subscription.status,updated_at=v_now,entitlement_revision=entitlement_revision+1 where id=v_term.id returning * into v_term;
    update marketplace_private.shop_memberships set revision=revision+1 where owner_id=v_term.owner_id;
    insert into marketplace_private.shop_membership_billing_audit_log(owner_id,provider_term_id,billing_customer_id,billing_subscription_id,action,details)
      values(v_term.owner_id,v_term.id,v_term.billing_customer_id,v_term.billing_subscription_id,'payment_grace_started',jsonb_build_object('providerVersion',v_term.grace_provider_version));
    return jsonb_build_object('outcome','applied','providerTermId',v_term.id,'graceEndsAt',v_term.grace_ends_at);
  end if;
  if v_subscription.status = 'past_due' then
    raise exception 'Past-due provider state cannot resolve Grace.' using errcode = '23514';
  end if;
  if v_term.grace_ends_at is null then return jsonb_build_object('outcome','no_grace'); end if;
  if v_term.grace_provider_version is not null and v_term.grace_provider_version > coalesce(v_subscription.provider_updated_at,'epoch'::timestamptz) then
    return jsonb_build_object('outcome','stale_provider_state','providerTermId',v_term.id);
  end if;
  update marketplace_private.shop_membership_provider_terms set grace_reason=null,grace_ends_at=null,
    grace_provider_version=null,provider_subscription_status=v_subscription.status,updated_at=v_now,entitlement_revision=entitlement_revision+1 where id=v_term.id returning * into v_term;
  update marketplace_private.shop_memberships set revision=revision+1 where owner_id=v_term.owner_id;
  insert into marketplace_private.shop_membership_billing_audit_log(owner_id,provider_term_id,billing_customer_id,billing_subscription_id,action,details)
    values(v_term.owner_id,v_term.id,v_term.billing_customer_id,v_term.billing_subscription_id,'payment_grace_ended',jsonb_build_object('providerVersion',coalesce(v_subscription.provider_updated_at,v_now)));
  return jsonb_build_object('outcome','applied','providerTermId',v_term.id);
end;$$;

create function public.marketplace_shop_billing_apply_invoice_proof(p_invoice_proof_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
begin
  if auth.role() is distinct from 'service_role' or p_invoice_proof_id is null then
    raise exception 'Trusted Billing entitlement adapter required.' using errcode = '42501';
  end if;
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = p_invoice_proof_id for update;
  if not found then raise exception 'Immutable verified Billing Invoice proof required.' using errcode = '23514'; end if;
  return public.marketplace_shop_billing_membership_command('apply_paid_invoice',v_proof.billing_invoice_id,null);
end;$$;

-- The worker receives only the internal Invoice id returned by reconciliation.
-- This wrapper still resolves and locks the immutable proof before it can apply anything.
create function public.marketplace_shop_billing_apply_verified_invoice(p_billing_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof marketplace_private.shop_billing_invoice_proofs;
begin
  if auth.role() is distinct from 'service_role' or p_billing_invoice_id is null then
    raise exception 'Trusted Billing entitlement adapter required.' using errcode = '42501';
  end if;
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p
    where p.billing_invoice_id = p_billing_invoice_id for update;
  if not found then raise exception 'Immutable verified Billing Invoice proof required.' using errcode = '23514'; end if;
  return public.marketplace_shop_billing_apply_invoice_proof(v_proof.id);
end;$$;

revoke all on function marketplace_private.validate_shop_billing_invoice_entitlement_application(),
  marketplace_private.protect_shop_billing_entitlement_application_history(),
  marketplace_private.validate_shop_membership_provider_term(),
  public.marketplace_shop_billing_membership_command(text,uuid,uuid),
  public.marketplace_shop_billing_apply_invoice_proof(uuid),
  public.marketplace_shop_billing_apply_verified_invoice(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_membership_command(text,uuid,uuid),
  public.marketplace_shop_billing_apply_invoice_proof(uuid),
  public.marketplace_shop_billing_apply_verified_invoice(uuid) to service_role;

commit;

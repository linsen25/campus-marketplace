-- Phase 4B-1: provider-backed paid Membership terms.
--
-- Legacy Membership commands retain their Toronto calendar terms.  Stripe-paid
-- coverage is deliberately separate: it is derived from a verified Billing
-- invoice service period, never from browser input, Checkout redirects, or
-- Stripe metadata.  No public/client role can execute the internal commands.
begin;

alter table marketplace_private.shop_billing_invoices
  add column service_period_start timestamptz,
  add column service_period_end timestamptz,
  add column provider_event_version timestamptz;

alter table marketplace_private.shop_billing_invoices
  add constraint shop_billing_invoice_service_period_check check (
    (service_period_start is null and service_period_end is null)
    or (
      service_period_start is not null
      and service_period_end is not null
      and service_period_end > service_period_start
    )
  );

create table marketplace_private.shop_membership_provider_terms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider_customer_id text not null check (provider_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  provider_subscription_id text not null check (provider_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_invoice_id text not null check (provider_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9]+$'),
  tier text not null check (tier in ('plus','pro')),
  payment_confirmed_at timestamptz not null,
  service_period_start timestamptz not null,
  service_period_end timestamptz not null,
  provider_subscription_status text not null check (provider_subscription_status in ('active','past_due','unpaid','paused','canceled')),
  billing_revision bigint not null check (billing_revision >= 0),
  provider_event_version timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  grace_reason text check (grace_reason in ('payment_failed')),
  grace_ends_at timestamptz,
  grace_provider_version timestamptz,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('refund','chargeback','provider_reversal')),
  entitlement_revision bigint not null default 0 check (entitlement_revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_invoice_id),
  unique (billing_invoice_id),
  check (service_period_end > service_period_start),
  check (
    (grace_reason is null and grace_ends_at is null and grace_provider_version is null)
    or (
      grace_reason = 'payment_failed'
      and grace_ends_at > service_period_end
      and grace_ends_at <= service_period_end + interval '432000 seconds'
      and grace_provider_version is not null
    )
  ),
  check ((revoked_at is null) = (revoke_reason is null))
);

alter table marketplace_private.shop_membership_provider_terms
  add constraint shop_membership_provider_terms_no_overlap
  exclude using gist (
    owner_id with =,
    tstzrange(service_period_start, service_period_end, '[)') with &&
  ) where (revoked_at is null);

create index shop_membership_provider_terms_owner_period_idx
  on marketplace_private.shop_membership_provider_terms(owner_id, service_period_end desc);
create index shop_membership_provider_terms_subscription_idx
  on marketplace_private.shop_membership_provider_terms(billing_subscription_id, provider_event_version desc);

create table marketplace_private.shop_membership_billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  provider_term_id uuid references marketplace_private.shop_membership_provider_terms(id) on delete restrict,
  billing_customer_id uuid references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid references marketplace_private.shop_billing_invoices(id) on delete restrict,
  action text not null check (action in ('paid_term_applied','payment_grace_started','payment_grace_ended','provider_term_revoked')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_membership_billing_audit_invoice_action_unique
  on marketplace_private.shop_membership_billing_audit_log(billing_invoice_id, action)
  where billing_invoice_id is not null;
create unique index shop_membership_billing_audit_term_action_version_unique
  on marketplace_private.shop_membership_billing_audit_log(provider_term_id, action, (details->>'providerVersion'))
  where provider_term_id is not null and details ? 'providerVersion';

create function marketplace_private.validate_shop_membership_provider_term()
returns trigger language plpgsql set search_path='' as $$
declare v_customer marketplace_private.shop_billing_customers;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_invoice marketplace_private.shop_billing_invoices;
begin
  select * into v_customer from marketplace_private.shop_billing_customers where id = new.billing_customer_id;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions where id = new.billing_subscription_id;
  select * into v_invoice from marketplace_private.shop_billing_invoices where id = new.billing_invoice_id;
  if v_customer.id is null or v_subscription.id is null or v_invoice.id is null
     or v_customer.owner_id is distinct from new.owner_id
     or v_subscription.owner_id is distinct from new.owner_id
     or v_invoice.owner_id is distinct from new.owner_id
     or v_subscription.billing_customer_id is distinct from v_customer.id
     or v_invoice.billing_customer_id is distinct from v_customer.id
     or v_invoice.billing_subscription_id is distinct from v_subscription.id
     or v_customer.provider is distinct from new.provider
     or v_subscription.provider is distinct from new.provider
     or v_invoice.provider is distinct from new.provider
     or v_customer.provider_account_id is distinct from new.provider_account_id
     or v_subscription.provider_account_id is distinct from new.provider_account_id
     or v_invoice.provider_account_id is distinct from new.provider_account_id
     or v_customer.provider_customer_id is distinct from new.provider_customer_id
     or v_subscription.provider_subscription_id is distinct from new.provider_subscription_id
     or v_invoice.provider_invoice_id is distinct from new.provider_invoice_id
     or v_subscription.provider_price_id is distinct from new.provider_price_id
     or v_subscription.tier is distinct from new.tier
     or v_invoice.status is distinct from 'paid'
     or v_invoice.amount_paid_cents < v_invoice.amount_due_cents
     or v_invoice.service_period_start is distinct from new.service_period_start
     or v_invoice.service_period_end is distinct from new.service_period_end
     or v_invoice.provider_event_version is distinct from new.provider_event_version then
    raise exception 'Provider Membership term must match a verified paid Billing invoice.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_membership_billing_audit()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Membership Billing audit history is immutable.' using errcode = '42501';
end;$$;

create trigger shop_membership_provider_term_relationship
before insert or update on marketplace_private.shop_membership_provider_terms
for each row execute function marketplace_private.validate_shop_membership_provider_term();
create trigger shop_membership_billing_audit_immutable
before update or delete on marketplace_private.shop_membership_billing_audit_log
for each row execute function marketplace_private.protect_shop_membership_billing_audit();

create function marketplace_private.prevent_legacy_term_after_provider_billing()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(
    select 1 from marketplace_private.shop_membership_provider_terms t
    where t.owner_id = new.owner_id
  ) then
    raise exception 'Provider-backed Membership coverage cannot be mixed with legacy Membership terms.' using errcode = '23514';
  end if;
  return new;
end;$$;
create trigger shop_membership_legacy_provider_guard
before insert on marketplace_private.shop_membership_terms
for each row execute function marketplace_private.prevent_legacy_term_after_provider_billing();

alter table marketplace_private.shop_membership_provider_terms enable row level security;
alter table marketplace_private.shop_membership_billing_audit_log enable row level security;
revoke all on marketplace_private.shop_membership_provider_terms,
  marketplace_private.shop_membership_billing_audit_log from public, anon, authenticated, service_role;

-- Preserve the B12 implementation verbatim for owners without a provider-backed
-- term; the wrapper below overlays only verified provider coverage.
alter function marketplace_private.shop_entitlements(uuid, timestamptz)
  rename to shop_legacy_entitlements;

create function marketplace_private.shop_provider_entitlements(p_owner uuid, p_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_term marketplace_private.shop_membership_provider_terms;
  v_state text; v_tier text; v_boundary timestamptz;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception 'Invalid evaluation time.' using errcode = '23514';
  end if;
  select * into v_term
  from marketplace_private.shop_membership_provider_terms t
  where t.owner_id = p_owner and t.revoked_at is null
    and t.service_period_start <= p_at and t.service_period_end > p_at
  order by t.service_period_start desc limit 1;
  if found then
    v_state := 'active'; v_tier := v_term.tier; v_boundary := v_term.service_period_end;
  else
    select * into v_term
    from marketplace_private.shop_membership_provider_terms t
    where t.owner_id = p_owner and t.revoked_at is null
      and t.service_period_end <= p_at and t.grace_reason = 'payment_failed'
      and t.grace_ends_at > p_at
    order by t.service_period_end desc limit 1;
    if found then
      v_state := 'grace'; v_tier := v_term.tier; v_boundary := v_term.grace_ends_at;
    elsif exists(select 1 from marketplace_private.shop_membership_provider_terms t where t.owner_id = p_owner) then
      v_state := 'suspended';
    else
      return null;
    end if;
  end if;
  return jsonb_build_object(
    'status', v_state,
    'effectiveTier', v_tier,
    'currentTermStart', v_term.service_period_start,
    'currentTermEnd', v_term.service_period_end,
    'graceEndsAt', v_term.grace_ends_at,
    'nextBoundaryAt', v_boundary,
    'purchaseMode', 'auto_renew',
    'providerBacked', true,
    'providerTermId', v_term.id,
    'providerSubscriptionStatus', v_term.provider_subscription_status,
    'providerRevision', v_term.entitlement_revision
  );
end;$$;

create function marketplace_private.shop_entitlements(p_owner uuid, p_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_legacy jsonb; v_provider jsonb; v_shop_exists boolean;
begin
  v_legacy := marketplace_private.shop_legacy_entitlements(p_owner, p_at);
  v_provider := marketplace_private.shop_provider_entitlements(p_owner, p_at);
  if v_provider is null then return v_legacy; end if;
  select exists(select 1 from public.shops where owner_id = p_owner) into v_shop_exists;
  return jsonb_build_object(
    'evaluatedAt', p_at,
    'revision', coalesce((v_legacy->>'revision')::bigint, 0),
    'status', case when v_shop_exists then v_provider->>'status' else null end,
    'reason', case when not v_shop_exists then 'no_shop' when v_provider->>'status' = 'suspended' then 'provider_coverage_ended' else null end,
    'effectiveTier', case when v_shop_exists then v_provider->>'effectiveTier' else null end,
    'currentTermStart', v_provider->'currentTermStart',
    'currentTermEnd', v_provider->'currentTermEnd',
    'graceEndsAt', v_provider->'graceEndsAt',
    'nextBoundaryAt', v_provider->'nextBoundaryAt',
    'trialClaimed', v_legacy->'trialClaimed',
    'trialEligible', false,
    'maxActiveProducts', case when not v_shop_exists or v_provider->>'status' = 'suspended' then 0 when v_provider->>'effectiveTier' = 'pro' then 100 else 40 end,
    'canOperateShop', v_shop_exists and v_provider->>'status' <> 'suspended',
    'canUseShopAnalytics', v_shop_exists and v_provider->>'status' <> 'suspended',
    'proPromotionEligible', v_shop_exists and v_provider->>'status' <> 'suspended' and v_provider->>'effectiveTier' = 'pro',
    'accessCycleId', null,
    'scheduledTier', null,
    'scheduledAt', null,
    'purchaseMode', v_provider->'purchaseMode',
    'providerBacked', true,
    'providerTermId', v_provider->'providerTermId',
    'providerSubscriptionStatus', v_provider->'providerSubscriptionStatus',
    'providerRevision', v_provider->'providerRevision'
  );
end;$$;

-- Recreate the public projection deliberately so deployed function plans use
-- the new provider-aware evaluator rather than the renamed legacy function.
create or replace function public.marketplace_shop_membership() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode='42501';
  end if;
  return marketplace_private.shop_entitlements(auth.uid(),clock_timestamp());
end;$$;

create function public.marketplace_shop_billing_membership_command(
  p_action text,
  p_billing_invoice_id uuid default null,
  p_billing_subscription_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_invoice marketplace_private.shop_billing_invoices;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_customer marketplace_private.shop_billing_customers;
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
    select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = p_billing_invoice_id for update;
    if not found or v_invoice.status <> 'paid' or v_invoice.amount_paid_cents < v_invoice.amount_due_cents
       or v_invoice.service_period_start is null or v_invoice.service_period_end is null
       or v_invoice.provider_event_version is null or v_invoice.billing_subscription_id is null then
      raise exception 'Verified paid Invoice service period required.' using errcode = '23514';
    end if;
    select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = v_invoice.billing_subscription_id for update;
    select * into v_customer from marketplace_private.shop_billing_customers c where c.id = v_invoice.billing_customer_id for update;
    if v_subscription.id is null or v_customer.id is null
       or v_subscription.owner_id <> v_invoice.owner_id or v_customer.owner_id <> v_invoice.owner_id
       or v_subscription.billing_customer_id <> v_customer.id
       or v_subscription.provider_account_id <> v_invoice.provider_account_id
       or v_customer.provider_account_id <> v_invoice.provider_account_id
       or v_subscription.provider_price_id is null
       or v_subscription.status not in ('active','past_due','canceled') then
      raise exception 'Trusted Billing binding was not found.' using errcode = '23514';
    end if;
    select * into v_existing from marketplace_private.shop_membership_provider_terms t where t.billing_invoice_id = v_invoice.id for update;
    if found then
      return jsonb_build_object('outcome','already_applied','providerTermId',v_existing.id,'ownerId',v_existing.owner_id);
    end if;
    insert into marketplace_private.shop_memberships(owner_id) values(v_invoice.owner_id) on conflict do nothing;
    select * into v_membership from marketplace_private.shop_memberships m where m.owner_id = v_invoice.owner_id for update;
    v_legacy := marketplace_private.shop_legacy_entitlements(v_invoice.owner_id, v_now);
    if v_legacy->>'status' in ('trial','active','grace') then
      raise exception 'Legacy Membership coverage must end before provider coverage begins.' using errcode = '40001';
    end if;
    if exists(
      select 1 from marketplace_private.shop_membership_provider_terms t
      where t.owner_id = v_invoice.owner_id and t.revoked_at is null
        and tstzrange(t.service_period_start,t.service_period_end,'[)') && tstzrange(v_invoice.service_period_start,v_invoice.service_period_end,'[)')
    ) then
      raise exception 'Provider Invoice service period overlaps existing coverage.' using errcode = '23505';
    end if;
    insert into marketplace_private.shop_membership_provider_terms(
      owner_id,provider_account_id,billing_customer_id,billing_subscription_id,billing_invoice_id,
      provider_customer_id,provider_subscription_id,provider_invoice_id,provider_price_id,tier,payment_confirmed_at,
      service_period_start,service_period_end,provider_subscription_status,billing_revision,provider_event_version,
      cancel_at_period_end,canceled_at
    ) values (
      v_invoice.owner_id,v_invoice.provider_account_id,v_customer.id,v_subscription.id,v_invoice.id,
      v_customer.provider_customer_id,v_subscription.provider_subscription_id,v_invoice.provider_invoice_id,
      v_subscription.provider_price_id,v_subscription.tier,coalesce(v_invoice.paid_at,v_invoice.updated_at),
      v_invoice.service_period_start,v_invoice.service_period_end,v_subscription.status,v_subscription.revision,
      v_invoice.provider_event_version,v_subscription.cancel_at_period_end,v_subscription.canceled_at
    ) returning * into v_term;
    update marketplace_private.shop_memberships set revision = revision + 1 where owner_id = v_invoice.owner_id;
    insert into marketplace_private.shop_membership_billing_audit_log(owner_id,provider_term_id,billing_customer_id,billing_subscription_id,billing_invoice_id,action,details)
      values(v_term.owner_id,v_term.id,v_customer.id,v_subscription.id,v_invoice.id,'paid_term_applied',jsonb_build_object('providerVersion',v_term.provider_event_version,'billingRevision',v_term.billing_revision));
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

revoke all on function marketplace_private.shop_provider_entitlements(uuid,timestamptz),
  marketplace_private.shop_legacy_entitlements(uuid,timestamptz),
  marketplace_private.shop_entitlements(uuid,timestamptz),
  marketplace_private.validate_shop_membership_provider_term(),
  marketplace_private.protect_shop_membership_billing_audit(),
  marketplace_private.prevent_legacy_term_after_provider_billing(),
  public.marketplace_shop_billing_membership_command(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_membership_command(text,uuid,uuid) to service_role;

commit;

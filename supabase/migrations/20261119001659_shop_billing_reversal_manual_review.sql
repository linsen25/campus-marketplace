-- Phase 4B-4C: complex provider reversals are recorded for trusted, service-
-- only manual review. This migration never changes Provider Terms, Memberships,
-- or entitlement calculations.
begin;

create table marketplace_private.shop_billing_reversal_reviews (
  id uuid primary key default gen_random_uuid(),
  reversal_state_id uuid not null unique references marketplace_private.shop_billing_reversal_states(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  invoice_proof_id uuid not null references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_reversal_id text not null check (provider_reversal_id ~ '^(re|dp|in|ch)_[A-Za-z0-9]+$'),
  reversal_type text not null check (reversal_type in ('refund','dispute','invoice_reversal','charge_refund')),
  review_reason text not null check (review_reason in ('partial_refund','complex_refund','ambiguous_charge_refund','invoice_reversal','dispute_pending','dispute_loss','dispute_restored','dispute_observed','conflicting_reversal_evidence')),
  review_status text not null default 'pending_review' check (review_status in ('pending_review','under_review','resolved_no_effect','escalated')),
  provider_event_version timestamptz not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);

create index shop_billing_reversal_reviews_owner_status_idx
  on marketplace_private.shop_billing_reversal_reviews(owner_id, review_status, updated_at desc);
create index shop_billing_reversal_reviews_invoice_idx
  on marketplace_private.shop_billing_reversal_reviews(billing_invoice_id, provider_event_version desc);

create table marketplace_private.shop_billing_reversal_review_audit (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references marketplace_private.shop_billing_reversal_reviews(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  reversal_state_id uuid not null references marketplace_private.shop_billing_reversal_states(id) on delete restrict,
  action text not null check (action in ('review_created','review_evidence_updated','review_status_changed','review_already_recorded')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_billing_reversal_review_audit_state_action_version_unique
  on marketplace_private.shop_billing_reversal_review_audit(reversal_state_id, action, (details->>'providerVersion'))
  where details ? 'providerVersion';

create function marketplace_private.validate_shop_billing_reversal_review()
returns trigger language plpgsql set search_path='' as $$
declare
  v_state marketplace_private.shop_billing_reversal_states;
  v_proof marketplace_private.shop_billing_invoice_proofs;
  v_invoice marketplace_private.shop_billing_invoices;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_customer marketplace_private.shop_billing_customers;
begin
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = new.reversal_state_id;
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = new.billing_invoice_id;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = new.billing_subscription_id;
  select * into v_customer from marketplace_private.shop_billing_customers c where c.id = new.billing_customer_id;
  if v_state.id is null or v_proof.id is null or v_invoice.id is null or v_subscription.id is null or v_customer.id is null
     or (v_state.classification = 'verified_full_reversal' and v_state.reversal_type = 'refund')
     or v_state.owner_id is distinct from new.owner_id
     or v_state.billing_customer_id is distinct from new.billing_customer_id
     or v_state.billing_subscription_id is distinct from new.billing_subscription_id
     or v_state.billing_invoice_id is distinct from new.billing_invoice_id
     or v_state.invoice_proof_id is distinct from new.invoice_proof_id
     or v_state.provider_account_id is distinct from new.provider_account_id
     or v_state.provider_reversal_id is distinct from new.provider_reversal_id
     or v_state.reversal_type is distinct from new.reversal_type
     or v_state.provider_event_version is distinct from new.provider_event_version
     or v_proof.owner_id is distinct from new.owner_id
     or v_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_proof.billing_invoice_id is distinct from new.billing_invoice_id
     or v_invoice.owner_id is distinct from new.owner_id
     or v_invoice.billing_customer_id is distinct from new.billing_customer_id
     or v_invoice.billing_subscription_id is distinct from new.billing_subscription_id
     or v_customer.owner_id is distinct from new.owner_id
     or v_subscription.owner_id is distinct from new.owner_id
     or v_subscription.billing_customer_id is distinct from new.billing_customer_id
     or v_customer.provider_account_id is distinct from new.provider_account_id
     or v_subscription.provider_account_id is distinct from new.provider_account_id
     or v_invoice.provider_account_id is distinct from new.provider_account_id
     or v_proof.provider_account_id is distinct from new.provider_account_id then
    raise exception 'Billing reversal review must match one trusted complex reversal state.' using errcode = '23514';
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_reversal_review_audit()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing reversal review audit is immutable.' using errcode = '42501';
end;$$;

create trigger shop_billing_reversal_review_relationship
before insert or update on marketplace_private.shop_billing_reversal_reviews
for each row execute function marketplace_private.validate_shop_billing_reversal_review();
create trigger shop_billing_reversal_review_audit_immutable
before update or delete on marketplace_private.shop_billing_reversal_review_audit
for each row execute function marketplace_private.protect_shop_billing_reversal_review_audit();

alter table marketplace_private.shop_billing_reversal_reviews enable row level security;
alter table marketplace_private.shop_billing_reversal_review_audit enable row level security;
revoke all on marketplace_private.shop_billing_reversal_reviews,
  marketplace_private.shop_billing_reversal_review_audit
  from public, anon, authenticated, service_role;

create function marketplace_private.shop_billing_reversal_review_reason(
  p_state marketplace_private.shop_billing_reversal_states,
  p_invoice_proof marketplace_private.shop_billing_invoice_proofs
) returns text language plpgsql stable set search_path='' as $$
begin
  if exists(
    select 1 from marketplace_private.shop_billing_reversal_states s
    where s.billing_invoice_id = p_state.billing_invoice_id and s.id <> p_state.id
      and (s.reversal_type <> p_state.reversal_type or s.classification = 'verified_full_reversal')
  ) then return 'conflicting_reversal_evidence'; end if;
  if p_state.reversal_type = 'refund' then
    if p_state.amount_cents < p_invoice_proof.amount_paid_cents then return 'partial_refund'; end if;
    return 'complex_refund';
  end if;
  if p_state.reversal_type = 'dispute' then
    if p_state.source_status in ('lost','funds_withdrawn') then return 'dispute_loss'; end if;
    if p_state.source_status in ('won','funds_reinstated') then return 'dispute_restored'; end if;
    if p_state.source_status in ('needs_response','warning_needs_response') then return 'dispute_pending'; end if;
    return 'dispute_observed';
  end if;
  if p_state.reversal_type = 'invoice_reversal' then return 'invoice_reversal'; end if;
  return 'ambiguous_charge_refund';
end;$$;

create function public.marketplace_shop_billing_register_reversal_review(p_reversal_state_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_state marketplace_private.shop_billing_reversal_states;
  v_proof marketplace_private.shop_billing_invoice_proofs;
  v_invoice marketplace_private.shop_billing_invoices;
  v_subscription marketplace_private.shop_billing_subscriptions;
  v_customer marketplace_private.shop_billing_customers;
  v_review marketplace_private.shop_billing_reversal_reviews;
  v_reason text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or p_reversal_state_id is null then
    raise exception 'Trusted Billing reversal review adapter required.' using errcode = '42501';
  end if;
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = p_reversal_state_id for update;
  if not found then raise exception 'Trusted Billing reversal state required.' using errcode = '23514'; end if;
  if v_state.classification = 'verified_full_reversal' and v_state.reversal_type = 'refund' then
    return jsonb_build_object('outcome','not_required','reversalStateId',v_state.id);
  end if;
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = v_state.invoice_proof_id for update;
  select * into v_invoice from marketplace_private.shop_billing_invoices i where i.id = v_state.billing_invoice_id for update;
  select * into v_subscription from marketplace_private.shop_billing_subscriptions s where s.id = v_state.billing_subscription_id for update;
  select * into v_customer from marketplace_private.shop_billing_customers c where c.id = v_state.billing_customer_id for update;
  if v_proof.id is null or v_invoice.id is null or v_subscription.id is null or v_customer.id is null
     or v_state.owner_id is distinct from v_proof.owner_id or v_state.owner_id is distinct from v_invoice.owner_id
     or v_state.owner_id is distinct from v_subscription.owner_id or v_state.owner_id is distinct from v_customer.owner_id
     or v_state.billing_customer_id is distinct from v_proof.billing_customer_id or v_state.billing_customer_id is distinct from v_invoice.billing_customer_id
     or v_state.billing_customer_id is distinct from v_subscription.billing_customer_id
     or v_state.billing_subscription_id is distinct from v_proof.billing_subscription_id or v_state.billing_subscription_id is distinct from v_invoice.billing_subscription_id
     or v_state.billing_invoice_id is distinct from v_proof.billing_invoice_id
     or v_state.provider_account_id is distinct from v_proof.provider_account_id or v_state.provider_account_id is distinct from v_invoice.provider_account_id
     or v_state.provider_account_id is distinct from v_subscription.provider_account_id or v_state.provider_account_id is distinct from v_customer.provider_account_id
     or v_state.currency is distinct from v_proof.currency then
    raise exception 'Trusted Billing reversal review binding mismatch.' using errcode = '23514';
  end if;
  v_reason := marketplace_private.shop_billing_reversal_review_reason(v_state,v_proof);
  select * into v_review from marketplace_private.shop_billing_reversal_reviews r where r.reversal_state_id = v_state.id for update;
  if found and v_review.provider_event_version >= v_state.provider_event_version then
    insert into marketplace_private.shop_billing_reversal_review_audit(review_id,owner_id,reversal_state_id,action,details)
      values(v_review.id,v_review.owner_id,v_state.id,'review_already_recorded',jsonb_build_object('providerVersion',v_state.provider_event_version)) on conflict do nothing;
    return jsonb_build_object('outcome','already_recorded','reviewId',v_review.id,'reviewStatus',v_review.review_status);
  end if;
  if found then
    update marketplace_private.shop_billing_reversal_reviews set review_reason=v_reason,provider_event_version=v_state.provider_event_version,revision=revision+1,updated_at=v_now where id=v_review.id returning * into v_review;
    insert into marketplace_private.shop_billing_reversal_review_audit(review_id,owner_id,reversal_state_id,action,details)
      values(v_review.id,v_review.owner_id,v_state.id,'review_evidence_updated',jsonb_build_object('providerVersion',v_state.provider_event_version,'reason',v_reason));
    return jsonb_build_object('outcome','evidence_updated','reviewId',v_review.id,'reviewStatus',v_review.review_status);
  end if;
  insert into marketplace_private.shop_billing_reversal_reviews(reversal_state_id,owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,invoice_proof_id,provider_account_id,provider_reversal_id,reversal_type,review_reason,provider_event_version)
    values(v_state.id,v_state.owner_id,v_state.billing_customer_id,v_state.billing_subscription_id,v_state.billing_invoice_id,v_state.invoice_proof_id,v_state.provider_account_id,v_state.provider_reversal_id,v_state.reversal_type,v_reason,v_state.provider_event_version) returning * into v_review;
  insert into marketplace_private.shop_billing_reversal_review_audit(review_id,owner_id,reversal_state_id,action,details)
    values(v_review.id,v_review.owner_id,v_state.id,'review_created',jsonb_build_object('providerVersion',v_state.provider_event_version,'reason',v_reason));
  return jsonb_build_object('outcome','created','reviewId',v_review.id,'reviewStatus',v_review.review_status);
end;$$;

create function public.marketplace_shop_billing_reversal_review_command(
  p_review_id uuid, p_action text, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_review marketplace_private.shop_billing_reversal_reviews;
  v_status text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or p_review_id is null or p_expected_revision is null
     or p_action not in ('begin_review','resolve_no_effect','escalate') then
    raise exception 'Trusted Billing reversal review adapter required.' using errcode = '42501';
  end if;
  select * into v_review from marketplace_private.shop_billing_reversal_reviews r where r.id = p_review_id for update;
  if not found then raise exception 'Billing reversal review was not found.' using errcode = '23514'; end if;
  if v_review.revision <> p_expected_revision then raise exception 'Billing reversal review revision conflict.' using errcode = '40001'; end if;
  v_status := case p_action when 'begin_review' then 'under_review' when 'resolve_no_effect' then 'resolved_no_effect' else 'escalated' end;
  if v_review.review_status = v_status then return jsonb_build_object('outcome','already_applied','reviewId',v_review.id,'reviewStatus',v_review.review_status,'revision',v_review.revision); end if;
  if v_review.review_status = 'resolved_no_effect' then raise exception 'Resolved Billing reversal review cannot be reopened automatically.' using errcode = '23514'; end if;
  update marketplace_private.shop_billing_reversal_reviews set review_status=v_status,resolved_at=case when v_status='resolved_no_effect' then v_now else null end,revision=revision+1,updated_at=v_now where id=v_review.id returning * into v_review;
  insert into marketplace_private.shop_billing_reversal_review_audit(review_id,owner_id,reversal_state_id,action,details)
    values(v_review.id,v_review.owner_id,v_review.reversal_state_id,'review_status_changed',jsonb_build_object('providerVersion',v_review.provider_event_version,'status',v_review.review_status,'action',p_action,'revision',v_review.revision));
  return jsonb_build_object('outcome','applied','reviewId',v_review.id,'reviewStatus',v_review.review_status,'revision',v_review.revision);
end;$$;

revoke all on function marketplace_private.validate_shop_billing_reversal_review(),
  marketplace_private.protect_shop_billing_reversal_review_audit(),
  marketplace_private.shop_billing_reversal_review_reason(marketplace_private.shop_billing_reversal_states,marketplace_private.shop_billing_invoice_proofs),
  public.marketplace_shop_billing_register_reversal_review(uuid),
  public.marketplace_shop_billing_reversal_review_command(uuid,text,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_register_reversal_review(uuid),
  public.marketplace_shop_billing_reversal_review_command(uuid,text,bigint)
  to service_role;

commit;

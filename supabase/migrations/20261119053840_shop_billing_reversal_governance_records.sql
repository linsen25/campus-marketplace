-- Phase 4B-4D-1: private, evidence-bound governance records only.
-- This migration records proposals and second-person approvals.  It never
-- changes Provider Terms, Memberships, trials, grace, or entitlements.
begin;

create table marketplace_private.shop_billing_review_operators (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null unique references auth.users(id) on delete restrict,
  role text not null check (role in ('reviewer','approver','billing_admin')),
  authorization_source text not null check (length(authorization_source) between 3 and 120),
  granted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) between 3 and 200),
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at is null or expires_at > granted_at),
  check ((revoked_at is null) = (revoked_reason is null))
);

create table marketplace_private.shop_billing_reversal_review_proposals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references marketplace_private.shop_billing_reversal_reviews(id) on delete restrict,
  reversal_state_id uuid not null references marketplace_private.shop_billing_reversal_states(id) on delete restrict,
  invoice_proof_id uuid not null references marketplace_private.shop_billing_invoice_proofs(id) on delete restrict,
  provider_term_id uuid references marketplace_private.shop_membership_provider_terms(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid not null references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid not null references marketplace_private.shop_billing_invoices(id) on delete restrict,
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
  proposal_kind text not null check (proposal_kind in ('no_effect','escalate','propose_term_revocation','propose_term_restoration')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  note text not null default '' check (length(note) <= 1000),
  proposer_operator_id uuid not null references marketplace_private.shop_billing_review_operators(id) on delete restrict,
  request_id uuid not null unique,
  evidence_revision bigint not null check (evidence_revision >= 0),
  provider_event_version timestamptz not null,
  proposal_status text not null default 'pending_approval' check (proposal_status in ('pending_approval','approved_unexecuted','rejected','expired','cancelled')),
  revision bigint not null default 0 check (revision >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check ((proposal_kind in ('propose_term_revocation','propose_term_restoration')) = (provider_term_id is not null))
);
create unique index shop_billing_reversal_review_proposal_pending_unique
  on marketplace_private.shop_billing_reversal_review_proposals(review_id, proposal_kind)
  where proposal_status = 'pending_approval';

create table marketplace_private.shop_billing_reversal_review_approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references marketplace_private.shop_billing_reversal_review_proposals(id) on delete restrict,
  approver_operator_id uuid not null references marketplace_private.shop_billing_review_operators(id) on delete restrict,
  request_id uuid not null unique,
  decision text not null check (decision in ('approved','rejected')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  note text not null default '' check (length(note) <= 1000),
  evidence_revision bigint not null check (evidence_revision >= 0),
  provider_event_version timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table marketplace_private.shop_billing_reversal_governance_audit (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references marketplace_private.shop_billing_reversal_reviews(id) on delete restrict,
  proposal_id uuid references marketplace_private.shop_billing_reversal_review_proposals(id) on delete restrict,
  approval_id uuid references marketplace_private.shop_billing_reversal_review_approvals(id) on delete restrict,
  actor_operator_id uuid references marketplace_private.shop_billing_review_operators(id) on delete restrict,
  action text not null check (action in ('proposal_created','proposal_already_recorded','proposal_expired','proposal_stale','proposal_approved','proposal_rejected','approval_already_recorded')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index shop_billing_reversal_governance_audit_proposal_action_request_unique
  on marketplace_private.shop_billing_reversal_governance_audit(proposal_id, action, (details->>'requestId'))
  where proposal_id is not null and details ? 'requestId';

create function marketplace_private.protect_shop_billing_reversal_governance_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing reversal governance history is immutable.' using errcode = '42501';
end;$$;

create function marketplace_private.active_shop_billing_review_operator(
  p_operator_id uuid, p_required_roles text[]
) returns marketplace_private.shop_billing_review_operators
language plpgsql stable security definer set search_path='' as $$
declare v_operator marketplace_private.shop_billing_review_operators;
begin
  select * into v_operator from marketplace_private.shop_billing_review_operators o
    where o.id = p_operator_id;
  if v_operator.id is null or v_operator.revoked_at is not null
     or (v_operator.expires_at is not null and v_operator.expires_at <= clock_timestamp())
     or not (v_operator.role = any(p_required_roles)) then
    raise exception 'Trusted active Billing review operator required.' using errcode = '42501';
  end if;
  return v_operator;
end;$$;

create function marketplace_private.validate_shop_billing_reversal_review_proposal()
returns trigger language plpgsql set search_path='' as $$
declare v_review marketplace_private.shop_billing_reversal_reviews;
  v_state marketplace_private.shop_billing_reversal_states;
  v_proof marketplace_private.shop_billing_invoice_proofs;
  v_term marketplace_private.shop_membership_provider_terms;
begin
  select * into v_review from marketplace_private.shop_billing_reversal_reviews r where r.id = new.review_id;
  select * into v_state from marketplace_private.shop_billing_reversal_states s where s.id = new.reversal_state_id;
  select * into v_proof from marketplace_private.shop_billing_invoice_proofs p where p.id = new.invoice_proof_id;
  if v_review.id is null or v_state.id is null or v_proof.id is null
     or v_review.reversal_state_id is distinct from new.reversal_state_id
     or v_review.invoice_proof_id is distinct from new.invoice_proof_id
     or v_review.owner_id is distinct from new.owner_id
     or v_review.billing_customer_id is distinct from new.billing_customer_id
     or v_review.billing_subscription_id is distinct from new.billing_subscription_id
     or v_review.billing_invoice_id is distinct from new.billing_invoice_id
     or v_review.provider_account_id is distinct from new.provider_account_id
     or v_state.owner_id is distinct from new.owner_id
     or v_state.billing_customer_id is distinct from new.billing_customer_id
     or v_state.billing_subscription_id is distinct from new.billing_subscription_id
     or v_state.billing_invoice_id is distinct from new.billing_invoice_id
     or v_state.invoice_proof_id is distinct from new.invoice_proof_id
     or v_state.provider_account_id is distinct from new.provider_account_id
     or v_proof.owner_id is distinct from new.owner_id
     or v_proof.billing_customer_id is distinct from new.billing_customer_id
     or v_proof.billing_subscription_id is distinct from new.billing_subscription_id
     or v_proof.billing_invoice_id is distinct from new.billing_invoice_id
     or v_proof.provider_account_id is distinct from new.provider_account_id then
    raise exception 'Billing governance proposal binding mismatch.' using errcode = '23514';
  end if;
  if new.provider_term_id is not null then
    select * into v_term from marketplace_private.shop_membership_provider_terms t where t.id = new.provider_term_id;
    if v_term.id is null or v_term.owner_id is distinct from new.owner_id
       or v_term.billing_customer_id is distinct from new.billing_customer_id
       or v_term.billing_subscription_id is distinct from new.billing_subscription_id
       or v_term.billing_invoice_id is distinct from new.billing_invoice_id
       or v_term.provider_account_id is distinct from new.provider_account_id then
      raise exception 'Billing governance proposal Provider Term mismatch.' using errcode = '23514';
    end if;
  end if;
  return new;
end;$$;

create trigger shop_billing_reversal_review_proposal_relationship
before insert or update on marketplace_private.shop_billing_reversal_review_proposals
for each row execute function marketplace_private.validate_shop_billing_reversal_review_proposal();
create trigger shop_billing_reversal_review_approval_immutable
before update or delete on marketplace_private.shop_billing_reversal_review_approvals
for each row execute function marketplace_private.protect_shop_billing_reversal_governance_history();
create trigger shop_billing_reversal_governance_audit_immutable
before update or delete on marketplace_private.shop_billing_reversal_governance_audit
for each row execute function marketplace_private.protect_shop_billing_reversal_governance_history();

alter table marketplace_private.shop_billing_review_operators enable row level security;
alter table marketplace_private.shop_billing_reversal_review_proposals enable row level security;
alter table marketplace_private.shop_billing_reversal_review_approvals enable row level security;
alter table marketplace_private.shop_billing_reversal_governance_audit enable row level security;
revoke all on marketplace_private.shop_billing_review_operators,
  marketplace_private.shop_billing_reversal_review_proposals,
  marketplace_private.shop_billing_reversal_review_approvals,
  marketplace_private.shop_billing_reversal_governance_audit
  from public, anon, authenticated, service_role;

create function public.marketplace_shop_billing_create_reversal_review_proposal(p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review marketplace_private.shop_billing_reversal_reviews;
  v_operator marketplace_private.shop_billing_review_operators;
  v_proposal marketplace_private.shop_billing_reversal_review_proposals;
  v_now timestamptz := clock_timestamp();
  v_kind text; v_term uuid; v_expires timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_value is null
     or jsonb_typeof(p_value) <> 'object' then
    raise exception 'Trusted Billing governance adapter required.' using errcode = '42501';
  end if;
  if not (p_value ?& array['reviewId','operatorId','requestId','proposalKind','reasonCode','expiresAt','expectedReviewRevision'])
     or (p_value - array['reviewId','operatorId','requestId','proposalKind','reasonCode','note','providerTermId','expiresAt','expectedReviewRevision']) <> '{}'::jsonb then
    raise exception 'Invalid Billing governance proposal input.' using errcode = '23514';
  end if;
  v_kind := p_value->>'proposalKind';
  v_term := nullif(p_value->>'providerTermId','')::uuid;
  v_expires := (p_value->>'expiresAt')::timestamptz;
  v_operator := marketplace_private.active_shop_billing_review_operator((p_value->>'operatorId')::uuid,array['reviewer','billing_admin']);
  select * into v_review from marketplace_private.shop_billing_reversal_reviews r where r.id=(p_value->>'reviewId')::uuid for update;
  if v_review.id is null or v_review.revision <> (p_value->>'expectedReviewRevision')::bigint then
    raise exception 'Billing reversal review revision conflict.' using errcode = '40001';
  end if;
  if v_review.review_status not in ('under_review','escalated') then
    raise exception 'Billing reversal review must be actively reviewed before governance proposal.' using errcode = '23514';
  end if;
  select * into v_proposal from marketplace_private.shop_billing_reversal_review_proposals p where p.request_id=(p_value->>'requestId')::uuid for update;
  if found then
    if v_proposal.review_id is distinct from v_review.id or v_proposal.proposer_operator_id is distinct from v_operator.id then
      raise exception 'Billing governance request id conflict.' using errcode = '23505';
    end if;
    insert into marketplace_private.shop_billing_reversal_governance_audit(review_id,proposal_id,actor_operator_id,action,details)
      values(v_review.id,v_proposal.id,v_operator.id,'proposal_already_recorded',jsonb_build_object('requestId',p_value->>'requestId')) on conflict do nothing;
    return jsonb_build_object('outcome','already_recorded','proposalId',v_proposal.id,'proposalStatus',v_proposal.proposal_status,'revision',v_proposal.revision);
  end if;
  if v_expires <= v_now or v_expires > v_now + interval '30 days' then
    raise exception 'Billing governance proposal expiry is invalid.' using errcode = '23514';
  end if;
  insert into marketplace_private.shop_billing_reversal_review_proposals(
    review_id,reversal_state_id,invoice_proof_id,provider_term_id,owner_id,billing_customer_id,billing_subscription_id,billing_invoice_id,
    provider_account_id,proposal_kind,reason_code,note,proposer_operator_id,request_id,evidence_revision,provider_event_version,expires_at
  ) values(
    v_review.id,v_review.reversal_state_id,v_review.invoice_proof_id,v_term,v_review.owner_id,v_review.billing_customer_id,v_review.billing_subscription_id,v_review.billing_invoice_id,
    v_review.provider_account_id,v_kind,p_value->>'reasonCode',coalesce(p_value->>'note',''),v_operator.id,(p_value->>'requestId')::uuid,v_review.revision,v_review.provider_event_version,v_expires
  ) returning * into v_proposal;
  insert into marketplace_private.shop_billing_reversal_governance_audit(review_id,proposal_id,actor_operator_id,action,details)
    values(v_review.id,v_proposal.id,v_operator.id,'proposal_created',jsonb_build_object('requestId',p_value->>'requestId','evidenceRevision',v_review.revision));
  return jsonb_build_object('outcome','created','proposalId',v_proposal.id,'proposalStatus',v_proposal.proposal_status,'revision',v_proposal.revision);
end;$$;

create function public.marketplace_shop_billing_approve_reversal_review_proposal(p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proposal marketplace_private.shop_billing_reversal_review_proposals;
  v_review marketplace_private.shop_billing_reversal_reviews;
  v_operator marketplace_private.shop_billing_review_operators;
  v_approval marketplace_private.shop_billing_reversal_review_approvals;
  v_decision text; v_status text; v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'Trusted Billing governance adapter required.' using errcode = '42501';
  end if;
  if not (p_value ?& array['proposalId','operatorId','requestId','decision','reasonCode','expectedProposalRevision'])
     or (p_value - array['proposalId','operatorId','requestId','decision','reasonCode','note','expectedProposalRevision']) <> '{}'::jsonb then
    raise exception 'Invalid Billing governance approval input.' using errcode = '23514';
  end if;
  v_operator := marketplace_private.active_shop_billing_review_operator((p_value->>'operatorId')::uuid,array['approver','billing_admin']);
  v_decision := p_value->>'decision';
  if v_decision not in ('approved','rejected') then raise exception 'Invalid Billing governance decision.' using errcode = '23514'; end if;
  select * into v_proposal from marketplace_private.shop_billing_reversal_review_proposals p where p.id=(p_value->>'proposalId')::uuid for update;
  if v_proposal.id is null then
    raise exception 'Billing governance proposal revision conflict.' using errcode = '40001';
  end if;
  select * into v_approval from marketplace_private.shop_billing_reversal_review_approvals a
    where a.request_id=(p_value->>'requestId')::uuid;
  if found then
    if v_approval.proposal_id is distinct from v_proposal.id
       or v_approval.approver_operator_id is distinct from v_operator.id then
      raise exception 'Billing governance approval request id conflict.' using errcode = '23505';
    end if;
    return jsonb_build_object('outcome','already_recorded','proposalId',v_proposal.id,'proposalStatus',v_proposal.proposal_status);
  end if;
  if v_proposal.revision <> (p_value->>'expectedProposalRevision')::bigint then
    raise exception 'Billing governance proposal revision conflict.' using errcode = '40001';
  end if;
  if v_proposal.proposer_operator_id = v_operator.id then raise exception 'Billing governance requires a second operator.' using errcode = '23514'; end if;
  select * into v_review from marketplace_private.shop_billing_reversal_reviews r where r.id=v_proposal.review_id for update;
  if v_review.id is null or v_review.revision <> v_proposal.evidence_revision or v_review.provider_event_version <> v_proposal.provider_event_version then
    update marketplace_private.shop_billing_reversal_review_proposals set proposal_status='expired',revision=revision+1,updated_at=v_now where id=v_proposal.id;
    insert into marketplace_private.shop_billing_reversal_governance_audit(review_id,proposal_id,actor_operator_id,action,details)
      values(v_proposal.review_id,v_proposal.id,v_operator.id,'proposal_stale',jsonb_build_object('requestId',p_value->>'requestId'));
    raise exception 'Billing governance proposal evidence is stale.' using errcode = '40001';
  end if;
  if v_proposal.proposal_status <> 'pending_approval' then
    raise exception 'Billing governance proposal is no longer pending.' using errcode = '23514';
  end if;
  if v_proposal.expires_at <= v_now then
    update marketplace_private.shop_billing_reversal_review_proposals set proposal_status='expired',revision=revision+1,updated_at=v_now where id=v_proposal.id;
    insert into marketplace_private.shop_billing_reversal_governance_audit(review_id,proposal_id,actor_operator_id,action,details)
      values(v_proposal.review_id,v_proposal.id,v_operator.id,'proposal_expired',jsonb_build_object('requestId',p_value->>'requestId'));
    raise exception 'Billing governance proposal has expired.' using errcode = '23514';
  end if;
  v_status := case when v_decision='approved' then 'approved_unexecuted' else 'rejected' end;
  insert into marketplace_private.shop_billing_reversal_review_approvals(proposal_id,approver_operator_id,request_id,decision,reason_code,note,evidence_revision,provider_event_version)
    values(v_proposal.id,v_operator.id,(p_value->>'requestId')::uuid,v_decision,p_value->>'reasonCode',coalesce(p_value->>'note',''),v_proposal.evidence_revision,v_proposal.provider_event_version)
    returning * into v_approval;
  update marketplace_private.shop_billing_reversal_review_proposals set proposal_status=v_status,revision=revision+1,updated_at=v_now where id=v_proposal.id returning * into v_proposal;
  insert into marketplace_private.shop_billing_reversal_governance_audit(review_id,proposal_id,approval_id,actor_operator_id,action,details)
    values(v_review.id,v_proposal.id,v_approval.id,v_operator.id,case when v_decision='approved' then 'proposal_approved' else 'proposal_rejected' end,jsonb_build_object('requestId',p_value->>'requestId','evidenceRevision',v_proposal.evidence_revision));
  return jsonb_build_object('outcome','applied','proposalId',v_proposal.id,'proposalStatus',v_proposal.proposal_status,'revision',v_proposal.revision);
end;$$;

revoke all on function marketplace_private.protect_shop_billing_reversal_governance_history(),
  marketplace_private.active_shop_billing_review_operator(uuid,text[]),
  marketplace_private.validate_shop_billing_reversal_review_proposal(),
  public.marketplace_shop_billing_create_reversal_review_proposal(jsonb),
  public.marketplace_shop_billing_approve_reversal_review_proposal(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_create_reversal_review_proposal(jsonb),
  public.marketplace_shop_billing_approve_reversal_review_proposal(jsonb)
  to service_role;

commit;

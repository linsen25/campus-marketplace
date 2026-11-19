-- Phase 3 checkout preparation. This command records intent only; it never
-- grants entitlement and is intentionally executable by service_role alone.
begin;

create table marketplace_private.shop_billing_checkout_commands (
  owner_id uuid not null references auth.users(id) on delete restrict,
  action_id uuid not null,
  provider text not null default 'stripe' check (provider='stripe'),
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),
  tier text not null check (tier in ('plus','pro')),
  membership_revision bigint not null check (membership_revision >= 0),
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'prepared' check (state in ('prepared','checkout_created','failed')),
  billing_customer_id uuid references marketplace_private.shop_billing_customers(id) on delete restrict,
  provider_checkout_session_id text check (provider_checkout_session_id is null or length(provider_checkout_session_id) between 3 and 255),
  provider_subscription_id text check (provider_subscription_id is null or length(provider_subscription_id) between 3 and 255),
  failure_summary text check (failure_summary is null or length(failure_summary) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, action_id),
  unique (provider, provider_account_id, provider_checkout_session_id),
  check ((state='checkout_created') = (provider_checkout_session_id is not null)),
  check ((state='failed') = (failure_summary is not null))
);

create unique index shop_billing_one_open_checkout_per_owner
  on marketplace_private.shop_billing_checkout_commands(owner_id, provider, provider_account_id)
  where state in ('prepared','checkout_created');

alter table marketplace_private.shop_billing_checkout_commands enable row level security;
revoke all on marketplace_private.shop_billing_checkout_commands from public, anon, authenticated, service_role;

create function public.marketplace_shop_billing_checkout_command(
  p_action text,
  p_owner uuid,
  p_action_id uuid,
  p_platform text,
  p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_command marketplace_private.shop_billing_checkout_commands;
  v_customer marketplace_private.shop_billing_customers;
  v_revision bigint:=0;
  v_tier text;
  v_digest text;
  v_customer_ref text;
  v_session_ref text;
begin
  if p_action not in ('prepare','bind_customer','record_checkout')
     or p_owner is null or p_action_id is null
     or p_platform !~ '^acct_[A-Za-z0-9]+$'
     or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Invalid billing checkout command.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shop_billing_checkout:'||p_owner::text||':'||p_platform,0));
  perform 1 from public.shops s where s.owner_id=p_owner for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501'; end if;

  if p_action='prepare' then
    v_tier:=p_value->>'tier';
    if v_tier not in ('plus','pro')
       or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('tier','membershipRevision'))
       or (p_value->>'membershipRevision') !~ '^[0-9]+$' then
      raise exception 'Invalid billing checkout input.' using errcode='23514';
    end if;
    select m.revision into v_revision from marketplace_private.shop_memberships m where m.owner_id=p_owner for key share;
    if coalesce(v_revision,0)<>(p_value->>'membershipRevision')::bigint then
      raise exception 'Stale membership revision.' using errcode='40001';
    end if;
    v_digest:=encode(extensions.digest(p_value::text,'sha256'),'hex');
    select * into v_command from marketplace_private.shop_billing_checkout_commands c
      where c.owner_id=p_owner and c.action_id=p_action_id for update;
    if found then
      if v_command.provider_account_id<>p_platform or v_command.input_digest<>v_digest then
        raise exception 'Conflicting billing checkout retry.' using errcode='23505';
      end if;
      select c.provider_customer_id into v_customer_ref from marketplace_private.shop_billing_customers c where c.id=v_command.billing_customer_id;
      return jsonb_build_object('state',v_command.state,'providerCustomerId',v_customer_ref,'checkoutSessionId',v_command.provider_checkout_session_id);
    end if;
    if exists(select 1 from marketplace_private.shop_billing_subscriptions s
      where s.owner_id=p_owner and s.provider='stripe' and s.provider_account_id=p_platform
        and s.status not in ('canceled','incomplete_expired')) then
      raise exception 'Existing Billing subscription requires reconciliation.' using errcode='23505';
    end if;
    if exists(select 1 from marketplace_private.shop_billing_checkout_commands c
      where c.owner_id=p_owner and c.provider='stripe' and c.provider_account_id=p_platform
        and c.state in ('prepared','checkout_created')) then
      raise exception 'Billing checkout is already being prepared.' using errcode='23505';
    end if;
    insert into marketplace_private.shop_billing_checkout_commands(owner_id,action_id,provider_account_id,tier,membership_revision,input_digest)
      values(p_owner,p_action_id,p_platform,v_tier,coalesce(v_revision,0),v_digest)
      returning * into v_command;
  elsif p_action='bind_customer' then
    v_customer_ref:=p_value->>'customerId';
    if v_customer_ref !~ '^cus_[A-Za-z0-9]+$' or exists(select 1 from jsonb_object_keys(p_value) k where k<>'customerId') then
      raise exception 'Invalid Stripe customer binding.' using errcode='23514';
    end if;
    select * into v_command from marketplace_private.shop_billing_checkout_commands c
      where c.owner_id=p_owner and c.action_id=p_action_id and c.provider_account_id=p_platform for update;
    if not found or v_command.state<>'prepared' then raise exception 'Billing checkout cannot bind a customer.' using errcode='23514'; end if;
    select * into v_customer from marketplace_private.shop_billing_customers c
      where c.owner_id=p_owner and c.provider='stripe' and c.provider_account_id=p_platform for update;
    if found and v_customer.provider_customer_id<>v_customer_ref then
      raise exception 'Conflicting Stripe customer binding.' using errcode='23505';
    elsif not found then
      insert into marketplace_private.shop_billing_customers(owner_id,provider_account_id,provider_customer_id)
        values(p_owner,p_platform,v_customer_ref) returning * into v_customer;
    end if;
    update marketplace_private.shop_billing_checkout_commands set billing_customer_id=v_customer.id,updated_at=clock_timestamp()
      where owner_id=p_owner and action_id=p_action_id returning * into v_command;
  else
    v_session_ref:=p_value->>'sessionId';
    if v_session_ref !~ '^cs_(test_)?[A-Za-z0-9]+$' or exists(select 1 from jsonb_object_keys(p_value) k where k<>'sessionId') then
      raise exception 'Invalid Stripe checkout session.' using errcode='23514';
    end if;
    select * into v_command from marketplace_private.shop_billing_checkout_commands c
      where c.owner_id=p_owner and c.action_id=p_action_id and c.provider_account_id=p_platform for update;
    if not found or v_command.state not in ('prepared','checkout_created') or v_command.billing_customer_id is null then
      raise exception 'Billing checkout cannot record a session.' using errcode='23514';
    end if;
    if v_command.provider_checkout_session_id is not null and v_command.provider_checkout_session_id<>v_session_ref then
      raise exception 'Conflicting Stripe checkout session.' using errcode='23505';
    end if;
    update marketplace_private.shop_billing_checkout_commands set state='checkout_created',provider_checkout_session_id=v_session_ref,updated_at=clock_timestamp()
      where owner_id=p_owner and action_id=p_action_id returning * into v_command;
  end if;
  select c.provider_customer_id into v_customer_ref from marketplace_private.shop_billing_customers c where c.id=v_command.billing_customer_id;
  return jsonb_build_object('state',v_command.state,'providerCustomerId',v_customer_ref,'checkoutSessionId',v_command.provider_checkout_session_id);
end;$$;

revoke all on function public.marketplace_shop_billing_checkout_command(text,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_billing_checkout_command(text,uuid,uuid,text,jsonb) to service_role;

commit;

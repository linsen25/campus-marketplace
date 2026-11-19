-- Phase 2 billing foundation only. These provider records never grant Shop
-- entitlements directly; marketplace_private.shop_memberships remains the
-- sole membership authority until a later, separately reviewed synchronizer.
begin;

create table marketplace_private.shop_billing_customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),
  provider_customer_id text not null check (length(provider_customer_id) between 3 and 255),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, provider, provider_account_id),
  unique (provider, provider_account_id, provider_customer_id)
);

create table marketplace_private.shop_billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),
  provider_subscription_id text not null check (length(provider_subscription_id) between 3 and 255),
  provider_price_id text check (provider_price_id is null or length(provider_price_id) between 3 and 255),
  tier text not null check (tier in ('plus','pro')),
  status text not null check (status in ('incomplete','incomplete_expired','trialing','active','past_due','unpaid','paused','canceled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  provider_updated_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_subscription_id),
  check (
    (current_period_start is null and current_period_end is null)
    or (current_period_start is not null and current_period_end is not null and current_period_end > current_period_start)
  )
);

create table marketplace_private.shop_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid not null references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),
  provider_invoice_id text not null check (length(provider_invoice_id) between 3 and 255),
  status text not null check (status in ('draft','open','paid','uncollectible','void')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0 and amount_paid_cents <= amount_due_cents),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  due_at timestamptz,
  paid_at timestamptz,
  provider_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_invoice_id)
);

create table marketplace_private.shop_billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_account_id text not null check (length(provider_account_id) between 3 and 255),
  provider_event_id text not null check (length(provider_event_id) between 3 and 255),
  event_type text not null check (length(event_type) between 3 and 255),
  processing_status text not null default 'received' check (processing_status in ('received','processing','processed','retryable','failed')),
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_summary text check (error_summary is null or length(error_summary) <= 1000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider_created_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_account_id, provider_event_id),
  check ((processing_status in ('retryable','failed')) or error_summary is null),
  check ((processing_status='processed') = (processed_at is not null))
);

create table marketplace_private.shop_billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  billing_customer_id uuid references marketplace_private.shop_billing_customers(id) on delete restrict,
  billing_subscription_id uuid references marketplace_private.shop_billing_subscriptions(id) on delete restrict,
  billing_invoice_id uuid references marketplace_private.shop_billing_invoices(id) on delete restrict,
  billing_event_id uuid references marketplace_private.shop_billing_events(id) on delete restrict,
  action text not null check (action in ('customer_bound','subscription_synced','invoice_synced','event_received','event_processed','event_retry_scheduled','event_failed')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  recorded_at timestamptz not null default clock_timestamp()
);

create index shop_billing_subscriptions_owner_idx on marketplace_private.shop_billing_subscriptions(owner_id, status);
create index shop_billing_invoices_owner_idx on marketplace_private.shop_billing_invoices(owner_id, status);
create index shop_billing_events_retry_idx on marketplace_private.shop_billing_events(processing_status, next_retry_at) where processing_status='retryable';
create index shop_billing_audit_owner_idx on marketplace_private.shop_billing_audit_log(owner_id, recorded_at desc);

create function marketplace_private.validate_shop_billing_relationships()
returns trigger language plpgsql set search_path='' as $$
  declare customer_owner uuid; subscription_owner uuid; subscription_customer uuid; invoice_owner uuid;
begin
  if tg_table_name='shop_billing_subscriptions' then
    select c.owner_id into customer_owner from marketplace_private.shop_billing_customers c where c.id=new.billing_customer_id;
    if customer_owner is null or customer_owner is distinct from new.owner_id then
      raise exception 'Billing subscription owner must match its customer.' using errcode='23514';
    end if;
  elsif tg_table_name='shop_billing_invoices' then
    select c.owner_id into customer_owner from marketplace_private.shop_billing_customers c where c.id=new.billing_customer_id;
    if customer_owner is null or customer_owner is distinct from new.owner_id then
      raise exception 'Billing invoice owner must match its customer.' using errcode='23514';
    end if;
    if new.billing_subscription_id is not null then
      select s.owner_id,s.billing_customer_id into subscription_owner,subscription_customer from marketplace_private.shop_billing_subscriptions s where s.id=new.billing_subscription_id;
      if subscription_owner is null or subscription_owner is distinct from new.owner_id or subscription_customer is distinct from new.billing_customer_id then
        raise exception 'Billing invoice subscription must match its customer and owner.' using errcode='23514';
      end if;
    end if;
  elsif tg_table_name='shop_billing_audit_log' then
    if new.billing_customer_id is not null then
      select c.owner_id into customer_owner from marketplace_private.shop_billing_customers c where c.id=new.billing_customer_id;
      if customer_owner is null or customer_owner is distinct from new.owner_id then raise exception 'Billing audit customer owner mismatch.' using errcode='23514'; end if;
    end if;
    if new.billing_subscription_id is not null then
      select s.owner_id into subscription_owner from marketplace_private.shop_billing_subscriptions s where s.id=new.billing_subscription_id;
      if subscription_owner is null or subscription_owner is distinct from new.owner_id then raise exception 'Billing audit subscription owner mismatch.' using errcode='23514'; end if;
    end if;
    if new.billing_invoice_id is not null then
      select i.owner_id into invoice_owner from marketplace_private.shop_billing_invoices i where i.id=new.billing_invoice_id;
      if invoice_owner is null or invoice_owner is distinct from new.owner_id then raise exception 'Billing audit invoice owner mismatch.' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end;$$;

create function marketplace_private.protect_shop_billing_audit_log()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Billing audit history is immutable.' using errcode='42501';
end;$$;

create trigger shop_billing_subscription_relationship before insert or update on marketplace_private.shop_billing_subscriptions
for each row execute function marketplace_private.validate_shop_billing_relationships();
create trigger shop_billing_invoice_relationship before insert or update on marketplace_private.shop_billing_invoices
for each row execute function marketplace_private.validate_shop_billing_relationships();
create trigger shop_billing_audit_relationship before insert on marketplace_private.shop_billing_audit_log
for each row execute function marketplace_private.validate_shop_billing_relationships();
create trigger shop_billing_audit_immutable before update or delete on marketplace_private.shop_billing_audit_log
for each row execute function marketplace_private.protect_shop_billing_audit_log();

alter table marketplace_private.shop_billing_customers enable row level security;
alter table marketplace_private.shop_billing_subscriptions enable row level security;
alter table marketplace_private.shop_billing_invoices enable row level security;
alter table marketplace_private.shop_billing_events enable row level security;
alter table marketplace_private.shop_billing_audit_log enable row level security;
revoke all on marketplace_private.shop_billing_customers,
  marketplace_private.shop_billing_subscriptions,
  marketplace_private.shop_billing_invoices,
  marketplace_private.shop_billing_events,
  marketplace_private.shop_billing_audit_log from public, anon, authenticated, service_role;

commit;

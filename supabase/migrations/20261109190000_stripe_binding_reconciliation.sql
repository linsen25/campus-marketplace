-- Stripe Test binding reconciliation. NOT DEPLOYED by this change.
-- Historical rows are retained and audited; only provider-verified canonical
-- bindings remain eligible for setup, capability, payment and payout lookup.
begin;

alter table marketplace_private.stripe_bindings
  add column superseded_at timestamptz,
  add column superseded_by uuid references marketplace_private.stripe_bindings(id),
  add column superseded_reason text,
  add constraint stripe_bindings_superseded_check check (
    (superseded_at is null and superseded_by is null and superseded_reason is null)
    or
    (superseded_at is not null and superseded_by is not null
      and superseded_by is distinct from id
      and superseded_reason in ('provider_metadata_canonical'))
  );

create index stripe_bindings_active_lookup_idx
  on marketplace_private.stripe_bindings(user_id,kind,platform,mode)
  where superseded_at is null;

create table marketplace_private.stripe_binding_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check(kind in ('payment_method','payout_account')),
  owner_ref text not null check(owner_ref ~ '^(cus|acct)_[A-Za-z0-9]+$'),
  canonical_binding_id uuid not null references marketplace_private.stripe_bindings(id) on delete restrict,
  superseded_binding_id uuid not null unique references marketplace_private.stripe_bindings(id) on delete restrict,
  canonical_platform text not null check(canonical_platform ~ '^acct_[A-Za-z0-9]+$'),
  superseded_platform text not null check(superseded_platform ~ '^acct_[A-Za-z0-9]+$'),
  reason text not null check(reason='provider_metadata_canonical'),
  reconciled_at timestamptz not null default clock_timestamp(),
  check(canonical_binding_id is distinct from superseded_binding_id),
  check(canonical_platform is distinct from superseded_platform)
);
alter table marketplace_private.stripe_binding_reconciliation_audit enable row level security;
revoke all on marketplace_private.stripe_binding_reconciliation_audit
  from public,anon,authenticated,service_role;

-- The caller may invoke this only after retrieving the provider object and
-- validating its immutable uu_binding metadata. The metadata binding id is
-- therefore explicit and must exactly identify the configured-platform row.
create function public.marketplace_reconcile_stripe_binding(
  p_user uuid,
  p_kind text,
  p_platform text,
  p_owner_ref text,
  p_metadata_binding uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  canonical marketplace_private.stripe_bindings;
  stale marketplace_private.stripe_bindings;
  reconciled integer:=0;
begin
  perform marketplace_private.require_stripe_staging();
  if p_kind not in ('payment_method','payout_account')
     or p_platform !~ '^acct_[A-Za-z0-9]+$'
     or not (p_owner_ref ~ (case when p_kind='payment_method'
          then '^cus_[A-Za-z0-9]+$' else '^acct_[A-Za-z0-9]+$' end))
     or p_metadata_binding is null then
    raise exception 'Invalid Stripe binding reconciliation input.' using errcode='23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user::text||':'||p_kind||':'||p_owner_ref,0)
  );
  select * into canonical
    from marketplace_private.stripe_bindings
   where id=p_metadata_binding
   for update;
  if canonical.id is null
     or canonical.user_id is distinct from p_user
     or canonical.kind is distinct from p_kind
     or canonical.platform is distinct from p_platform
     or canonical.mode is distinct from 'test'
     or canonical.owner_ref is distinct from p_owner_ref
     or canonical.superseded_at is not null then
    raise exception 'Provider metadata does not identify the canonical binding.' using errcode='42501';
  end if;
  if exists(
    select 1 from marketplace_private.stripe_bindings b
     where b.owner_ref=p_owner_ref and b.mode='test'
       and b.superseded_at is null and b.id<>canonical.id
       and (b.user_id is distinct from p_user or b.kind is distinct from p_kind)
  ) then
    raise exception 'Connected account ownership conflict.' using errcode='23505';
  end if;
  for stale in
    select * from marketplace_private.stripe_bindings b
     where b.user_id=p_user and b.kind=p_kind and b.mode='test'
       and b.owner_ref=p_owner_ref and b.id<>canonical.id
       and b.platform<>p_platform and b.superseded_at is null
     order by b.created_at,b.id
     for update
  loop
    update marketplace_private.stripe_bindings
       set superseded_at=clock_timestamp(),
           superseded_by=canonical.id,
           superseded_reason='provider_metadata_canonical',
           lease=null,
           lease_until=null
     where id=stale.id and superseded_at is null;
    if found then
      insert into marketplace_private.stripe_binding_reconciliation_audit(
        user_id,kind,owner_ref,canonical_binding_id,superseded_binding_id,
        canonical_platform,superseded_platform,reason
      ) values(
        p_user,p_kind,p_owner_ref,canonical.id,stale.id,
        p_platform,stale.platform,'provider_metadata_canonical'
      ) on conflict(superseded_binding_id) do nothing;
      reconciled:=reconciled+1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'canonicalBindingId',canonical.id,
    'supersededCount',reconciled
  );
end;$$;
revoke all on function public.marketplace_reconcile_stripe_binding(uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_reconcile_stripe_binding(uuid,text,text,text,uuid)
  to service_role;

-- Fail closed if any reviewed function differs from its deployed baseline.
-- CREATE OR REPLACE via pg_get_functiondef preserves the existing body and
-- changes only the enumerated active-binding predicates.
do $migration$
declare
  item record;
  definition text;
  occurrences integer;
  before_owner oid; after_owner oid;
  before_security_definer boolean; after_security_definer boolean;
  before_config text[]; after_config text[];
  before_acl aclitem[]; after_acl aclitem[];
begin
  for item in
    select * from (values
      ('public.marketplace_stripe_binding(text,uuid,text,text,uuid,jsonb)',
       $$where user_id=p_user and kind=p_kind and platform=p_platform and mode='test' for update$$,
       $$where user_id=p_user and kind=p_kind and platform=p_platform and mode='test' and superseded_at is null for update$$),
      ('public.marketplace_stripe_capabilities(uuid,text)',
       $$where user_id=p_user and kind='payment_method' and platform=p_platform and mode='test' and status<>'unset'$$,
       $$where user_id=p_user and kind='payment_method' and platform=p_platform and mode='test' and superseded_at is null and status<>'unset'$$),
      ('public.marketplace_stripe_capabilities(uuid,text)',
       $$where user_id=p_user and kind='payout_account' and platform=p_platform and mode='test' and status<>'unset'$$,
       $$where user_id=p_user and kind='payout_account' and platform=p_platform and mode='test' and superseded_at is null and status<>'unset'$$),
      ('public.marketplace_stripe_events(text,text,jsonb)',
       $$where platform=p_platform and mode='test' and (owner_ref=e.owner_ref or instrument_ref=e.owner_ref)$$,
       $$where platform=p_platform and mode='test' and superseded_at is null and (owner_ref=e.owner_ref or instrument_ref=e.owner_ref)$$),
      ('public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb)',
       $$where user_id=p_buyer and kind='payment_method' and platform=p_platform and mode='test' and status='set'$$,
       $$where user_id=p_buyer and kind='payment_method' and platform=p_platform and mode='test' and superseded_at is null and status='set'$$),
      ('public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb)',
       $$where user_id=o.seller_id and kind='payout_account' and platform=p_platform and mode='test' and status='ready'$$,
       $$where user_id=o.seller_id and kind='payout_account' and platform=p_platform and mode='test' and superseded_at is null and status='ready'$$),
      ('public.marketplace_order_transfer_operation(text,uuid,text,uuid)',
       $$where bnd.user_id=o.seller_id and bnd.kind='payout_account' and bnd.platform=p_platform and bnd.mode='test' for update$$,
       $$where bnd.user_id=o.seller_id and bnd.kind='payout_account' and bnd.platform=p_platform and bnd.mode='test' and bnd.superseded_at is null for update$$),
      ('marketplace_private.project_connected_payout_notification()',
       $$where b.kind='payout_account' and b.platform=new.provider_platform and b.mode=new.provider_mode
   and b.owner_ref=new.connected_account_ref$$,
       $$where b.kind='payout_account' and b.platform=new.provider_platform and b.mode=new.provider_mode
   and b.superseded_at is null and b.owner_ref=new.connected_account_ref$$)
    ) reviewed(signature,old_fragment,new_fragment)
  loop
    definition:=pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid);
    select p.proowner,p.prosecdef,p.proconfig,p.proacl
      into before_owner,before_security_definer,before_config,before_acl
      from pg_catalog.pg_proc p where p.oid=item.signature::regprocedure::oid;
    if not found then
      raise exception 'Stripe binding consumer % is absent.',item.signature using errcode='P0001';
    end if;
    occurrences:=(length(definition)-length(replace(definition,item.old_fragment,'')))
      / length(item.old_fragment);
    if occurrences<>1 or position(item.new_fragment in definition)>0 then
      raise exception 'Stripe binding consumer % baseline drifted.',item.signature using errcode='P0001';
    end if;
    execute replace(definition,item.old_fragment,item.new_fragment);
    select p.proowner,p.prosecdef,p.proconfig,p.proacl
      into after_owner,after_security_definer,after_config,after_acl
      from pg_catalog.pg_proc p where p.oid=item.signature::regprocedure::oid;
    if after_owner is distinct from before_owner
       or after_security_definer is distinct from before_security_definer
       or after_config is distinct from before_config
       or after_acl is distinct from before_acl then
      raise exception 'Stripe binding consumer % metadata changed.',item.signature using errcode='P0001';
    end if;
  end loop;
end;
$migration$;

commit;

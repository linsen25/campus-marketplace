-- B12 domain only: no billing adapter, public paid grant, UI or Shop feature gate.
begin;
create extension if not exists btree_gist with schema extensions;

create table marketplace_private.shop_memberships (
  owner_id uuid primary key references auth.users(id),
  trial_claimed_at timestamptz,
  cycle_id uuid,
  anchor_local timestamp,
  revision bigint not null default 0 check (revision >= 0),
  scheduled_tier text check (scheduled_tier in ('plus','pro')),
  scheduled_at timestamptz,
  renewal_consent_ref text,
  pending_renewal_ref text,
  check ((scheduled_tier is null) = (scheduled_at is null)),
  check ((cycle_id is null) = (anchor_local is null))
);
create table marketplace_private.shop_membership_commands (
  owner_id uuid not null references marketplace_private.shop_memberships(owner_id),
  action text not null check (action in ('trial','purchase','upgrade','schedule','mode','pending','resolve')),
  action_id uuid not null,
  input_digest text not null check (length(input_digest)=64),
  proof_key text unique,
  input jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null,
  primary key(owner_id,action,action_id)
);
create table marketplace_private.shop_membership_terms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references marketplace_private.shop_memberships(owner_id),
  cycle_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  source text not null check (source in ('trial','paid')),
  tier text not null check (tier in ('plus','pro')),
  purchase_mode text check (purchase_mode in ('one_month','auto_renew')),
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz not null check (isfinite(ends_at) and ends_at > starts_at),
  price_version text not null default 'b10_v1' check (price_version='b10_v1'),
  base_price_cents integer not null check (base_price_cents >= 0),
  command_action text not null,
  command_id uuid not null,
  foreign key(owner_id,command_action,command_id)
    references marketplace_private.shop_membership_commands(owner_id,action,action_id)
    deferrable initially deferred,
  unique(owner_id,cycle_id,ordinal),
  check ((source='trial' and tier='pro' and purchase_mode is null and base_price_cents=0)
    or (source='paid' and purchase_mode is not null)),
  exclude using gist (owner_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
);
create unique index shop_membership_one_trial on marketplace_private.shop_membership_terms(owner_id) where source='trial';
alter table marketplace_private.shop_memberships enable row level security;
alter table marketplace_private.shop_membership_terms enable row level security;
alter table marketplace_private.shop_membership_commands enable row level security;
revoke all on marketplace_private.shop_memberships, marketplace_private.shop_membership_terms,
  marketplace_private.shop_membership_commands from public,anon,authenticated,service_role;

create function marketplace_private.protect_shop_membership_history() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='shop_membership_commands' or tg_op='DELETE' then
    raise exception 'Membership history is retained.' using errcode='42501';
  end if;
  if new.owner_id is distinct from old.owner_id
     or (old.trial_claimed_at is not null and new.trial_claimed_at is distinct from old.trial_claimed_at) then
    raise exception 'Membership identity and Trial use are immutable.' using errcode='42501';
  end if;
  return new;
end;$$;
create trigger shop_membership_history before update or delete on marketplace_private.shop_membership_commands
for each row execute function marketplace_private.protect_shop_membership_history();
create trigger shop_membership_identity before update or delete on marketplace_private.shop_memberships
for each row execute function marketplace_private.protect_shop_membership_history();

-- Resolve explicit Toronto wall time, including B10's earlier fold / first valid gap.
create function marketplace_private.shop_calendar_boundary(p_anchor timestamp,p_months integer)
returns timestamptz language plpgsql stable set search_path='' as $$
declare month_start timestamp; target timestamp; wall timestamp; answer timestamptz; i integer;
begin
  if p_anchor is null or not isfinite(p_anchor) or p_months is null or p_months<0 then
    raise exception 'Invalid membership anchor.' using errcode='23514';
  end if;
  month_start:=date_trunc('month',p_anchor)+make_interval(months=>p_months);
  target:=month_start+make_interval(days=>least(extract(day from p_anchor)::integer,
    extract(day from month_start+interval '1 month - 1 day')::integer)-1)
    +(p_anchor-date_trunc('day',p_anchor));
  for i in 0..180 loop
    wall:=case when i=0 then target else date_trunc('minute',target)+make_interval(mins=>i) end;
    select min(candidate) into answer from (
      select timezone('UTC',wall)-(timezone('America/Toronto',sample)-timezone('UTC',sample)) candidate
      from generate_series(timezone('UTC',wall)-interval '36 hours',
        timezone('UTC',wall)+interval '36 hours',interval '6 hours') sample
    ) candidates where timezone('America/Toronto',candidate)=wall;
    if answer is not null then return answer;end if;
  end loop;
  raise exception 'Unable to resolve membership boundary.' using errcode='23514';
end;$$;

create function marketplace_private.shop_membership_price(p_tier text,p_mode text)
returns integer language plpgsql immutable set search_path='' as $$
begin
  if p_tier='plus' and p_mode='one_month' then return 299;
  elsif p_tier='plus' and p_mode='auto_renew' then return 199;
  elsif p_tier='pro' and p_mode='one_month' then return 599;
  elsif p_tier='pro' and p_mode='auto_renew' then return 499;
  end if;
  raise exception 'Invalid membership plan.' using errcode='23514';
end;$$;

create function marketplace_private.shop_entitlements(p_owner uuid,p_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare m marketplace_private.shop_memberships; t marketplace_private.shop_membership_terms;
  current_term boolean:=false; state text; tier text; eligible boolean; shop_exists boolean;
  boundary timestamptz; enabled boolean:=false;
begin
  if p_at is null or not isfinite(p_at) then raise exception 'Invalid evaluation time.' using errcode='23514';end if;
  select exists(select 1 from public.shops where owner_id=p_owner) into shop_exists;
  select * into m from marketplace_private.shop_memberships where owner_id=p_owner;
  select * into t from marketplace_private.shop_membership_terms where owner_id=p_owner
    and starts_at<=p_at and ends_at>p_at order by starts_at desc limit 1;
  current_term:=found;
  if not current_term then
    select * into t from marketplace_private.shop_membership_terms where owner_id=p_owner
      and ends_at<=p_at order by ends_at desc limit 1;
  end if;
  if t.id is not null then
    state:=case when current_term then case when t.source='trial' then 'trial' else 'active' end
      when p_at<t.ends_at+interval '432000 seconds' then 'grace' else 'suspended' end;
    enabled:=shop_exists and state<>'suspended';
    tier:=case when enabled then t.tier else null end;
    boundary:=case when current_term then t.ends_at when state='grace' then t.ends_at+interval '432000 seconds' else null end;
  end if;
  eligible:=shop_exists and m.trial_claimed_at is null
    and m.renewal_consent_ref is null and m.pending_renewal_ref is null
    and not exists(select 1 from marketplace_private.shop_membership_terms where owner_id=p_owner
      and (ends_at>p_at or (source='paid' and ends_at+interval '432000 seconds'>p_at)));
  return jsonb_build_object('evaluatedAt',p_at,'revision',coalesce(m.revision,0),'status',state,
    'reason',case when not shop_exists then 'no_shop' when t.id is null then 'not_started' else null end,
    'effectiveTier',tier,'currentTermStart',t.starts_at,'currentTermEnd',t.ends_at,
    'graceEndsAt',case when t.id is not null then t.ends_at+interval '432000 seconds' else null end,
    'nextBoundaryAt',boundary,'trialClaimed',m.trial_claimed_at is not null,'trialEligible',eligible,
    'maxActiveProducts',case when not enabled then 0 when tier='pro' then 100 else 40 end,
    'canOperateShop',enabled,'canUseShopAnalytics',enabled,'proPromotionEligible',enabled and tier='pro',
    'accessCycleId',m.cycle_id,'scheduledTier',m.scheduled_tier,'scheduledAt',m.scheduled_at,
    'purchaseMode',t.purchase_mode);
end;$$;

-- Internal domain boundary only. NO EXECUTE to service_role/authenticated/anon.
-- A later verified provider adapter needs separate approval before it can call this.
-- p_at is internal-only for deterministic local qualification; public wrappers never accept it.
create function marketplace_private.shop_membership_command(
  p_owner uuid,p_action text,p_action_id uuid,p_value jsonb default '{}'::jsonb,p_at timestamptz default null
) returns jsonb language plpgsql set search_path='' as $$
declare m marketplace_private.shop_memberships; t marketplace_private.shop_membership_terms;
  prior marketplace_private.shop_membership_commands; intent text; proof text;
  at_time timestamptz; view_state jsonb; result jsonb; v_tier text; mode text; start_time timestamptz;
  end_time timestamptz; cycle uuid; ordinal integer; due integer; amount integer; minimum integer;
begin
  if p_owner is null or p_action_id is null or p_action is null
     or p_action not in ('trial','purchase','upgrade','schedule','mode','pending','resolve')
     or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Invalid membership command.' using errcode='23514';
  end if;
  perform 1 from public.shops where owner_id=p_owner for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
  insert into marketplace_private.shop_memberships(owner_id) values(p_owner) on conflict do nothing;
  select * into strict m from marketplace_private.shop_memberships where owner_id=p_owner for update;
  at_time:=coalesce(p_at,clock_timestamp());
  if not isfinite(at_time) then raise exception 'Invalid membership time.' using errcode='23514';end if;
  intent:=encode(extensions.digest(p_value::text,'sha256'),'hex');
  select * into prior from marketplace_private.shop_membership_commands
    where owner_id=p_owner and action=p_action and action_id=p_action_id;
  if found then
    if prior.input_digest<>intent then raise exception 'Conflicting membership retry.' using errcode='23505';end if;
    return prior.result;
  end if;
  if p_action in ('purchase','upgrade') then
    proof:=nullif(p_value->>'proof','');
    if proof is null or length(proof)>300 then raise exception 'Trusted payment evidence required.' using errcode='23514';end if;
    -- Serialize a proof used concurrently even across different owners.
    perform pg_advisory_xact_lock(hashtextextended('shop_payment:'||proof,0));
    select * into prior from marketplace_private.shop_membership_commands where proof_key=proof;
    if found then
      if prior.owner_id<>p_owner or prior.action<>p_action or prior.input_digest<>intent then
        raise exception 'Conflicting payment evidence.' using errcode='23505';
      end if;
      return prior.result;
    end if;
  end if;
  view_state:=marketplace_private.shop_entitlements(p_owner,at_time);
  select * into t from marketplace_private.shop_membership_terms where owner_id=p_owner
    and starts_at<=at_time order by ends_at desc limit 1;
  if p_action='trial' then
    if p_value<>'{}'::jsonb then raise exception 'Trial does not accept entitlement fields.' using errcode='23514';end if;
    if not (view_state->>'trialEligible')::boolean then
      raise exception 'Trial is already used or membership conflicts remain.' using errcode='23505';
    end if;
    cycle:=gen_random_uuid();
    update marketplace_private.shop_memberships set trial_claimed_at=at_time,cycle_id=cycle,
      anchor_local=timezone('America/Toronto',at_time),scheduled_tier=null,scheduled_at=null
      where owner_id=p_owner;
    insert into marketplace_private.shop_membership_terms(owner_id,cycle_id,ordinal,source,tier,starts_at,ends_at,
      base_price_cents,command_action,command_id)
    values(p_owner,cycle,2,'trial','pro',at_time,
      marketplace_private.shop_calendar_boundary(timezone('America/Toronto',at_time),2),0,p_action,p_action_id);
  else
    if (p_value->>'expectedRevision') is null then raise exception 'Membership revision required.' using errcode='23514';end if;
    if (p_value->>'expectedRevision')::bigint<>m.revision then
      if p_action not in ('purchase','upgrade') then raise exception 'Stale membership revision.' using errcode='40001';end if;
      result:=jsonb_build_object('outcome','reconciliation_required','reason','stale_revision','revision',m.revision);
    elsif p_action='purchase' then
      v_tier:=p_value->>'tier';mode:=p_value->>'mode';
      due:=marketplace_private.shop_membership_price(v_tier,mode);
      if p_value->>'currency' is distinct from 'CAD' or (p_value->>'amountCents') is null
        or (p_value->>'amountCents')::integer<>due then
        raise exception 'Payment amount or currency mismatch.' using errcode='23514';
      end if;
      if mode='auto_renew' and coalesce(nullif(p_value->>'consent',''),m.renewal_consent_ref) is null then
        raise exception 'Recurring authorization required.' using errcode='23514';end if;
      if t.source='trial' and view_state->>'status'='trial' then
        raise exception 'Trial cannot be ended by an early purchase.' using errcode='23514';end if;
      if view_state->>'status'='active' and t.tier<>v_tier
        and not (t.tier='pro' and v_tier='plus' and m.scheduled_tier='plus') then
        raise exception 'Use upgrade or scheduled downgrade.' using errcode='23514';end if;
      if m.scheduled_tier is not null and m.scheduled_tier<>v_tier then
        raise exception 'Purchase conflicts with scheduled plan.' using errcode='23514';end if;
      if m.pending_renewal_ref is not null and p_value->>'renewalReference' is distinct from m.pending_renewal_ref then
        raise exception 'Pending renewal must be reconciled first.' using errcode='23514';end if;
      if p_value->>'expectedCycle' is distinct from m.cycle_id::text then
        raise exception 'Purchase belongs to another membership cycle.' using errcode='40001';end if;
      if view_state->>'status'='suspended' or t.id is null then
        cycle:=gen_random_uuid();start_time:=at_time;ordinal:=1;
        update marketplace_private.shop_memberships set cycle_id=cycle,anchor_local=timezone('America/Toronto',at_time)
          where owner_id=p_owner returning * into m;
      else
        select * into t from marketplace_private.shop_membership_terms where owner_id=p_owner order by ends_at desc limit 1;
        cycle:=m.cycle_id;start_time:=t.ends_at;ordinal:=t.ordinal+1;
      end if;
      end_time:=marketplace_private.shop_calendar_boundary(m.anchor_local,ordinal);
      insert into marketplace_private.shop_membership_terms(owner_id,cycle_id,ordinal,source,tier,purchase_mode,
        starts_at,ends_at,base_price_cents,command_action,command_id)
        values(p_owner,cycle,ordinal,'paid',v_tier,mode,start_time,end_time,due,p_action,p_action_id);
      update marketplace_private.shop_memberships set
        renewal_consent_ref=case when mode='auto_renew' then coalesce(nullif(p_value->>'consent',''),renewal_consent_ref) else null end,
        pending_renewal_ref=null,scheduled_tier=null,scheduled_at=null where owner_id=p_owner;
    elsif p_action='upgrade' then
      if view_state->>'status' is distinct from 'active' or t.source is distinct from 'paid'
        or t.tier is distinct from 'plus' or t.cycle_id is distinct from m.cycle_id then
        raise exception 'Active paid Plus required.' using errcode='23514';end if;
      due:=round((marketplace_private.shop_membership_price('pro',t.purchase_mode)
        -marketplace_private.shop_membership_price('plus',t.purchase_mode))::numeric
        *extract(epoch from t.ends_at-at_time)/extract(epoch from t.ends_at-t.starts_at))::integer;
      amount:=(p_value->>'amountCents')::integer;minimum:=(p_value->>'minimumCents')::integer;
      if p_value->>'currency' is distinct from 'CAD' or amount is null
        or not coalesce(amount=due or (due>0 and minimum>due and amount=0 and p_value->>'waiver'='below_provider_minimum'),false) then
        raise exception 'Upgrade payment mismatch.' using errcode='23514';end if;
      -- Original base price and period stay frozen. Command retains upgrade pricing facts.
      update marketplace_private.shop_membership_terms set tier='pro' where id=t.id;
    elsif p_action='schedule' then
      v_tier:=p_value->>'tier';
      if v_tier not in ('plus','pro') or v_tier is null or t.id is null or view_state->>'status' not in ('trial','active') then
        raise exception 'Invalid scheduled plan.' using errcode='23514';end if;
      if exists(select 1 from marketplace_private.shop_membership_terms future
        where future.owner_id=p_owner and future.starts_at>at_time and future.tier<>v_tier) then
        raise exception 'Scheduled plan conflicts with prepaid coverage.' using errcode='23514';end if;
      update marketplace_private.shop_memberships set scheduled_tier=v_tier,scheduled_at=t.ends_at where owner_id=p_owner;
    elsif p_action='mode' then
      mode:=p_value->>'mode';
      if mode='auto_renew' and nullif(p_value->>'consent','') is not null then
        update marketplace_private.shop_memberships set renewal_consent_ref=p_value->>'consent' where owner_id=p_owner;
      elsif mode='one_month' then
        update marketplace_private.shop_memberships set renewal_consent_ref=null where owner_id=p_owner;
      else raise exception 'Explicit recurring consent required.' using errcode='23514';end if;
    elsif p_action='pending' then
      if m.renewal_consent_ref is null or m.pending_renewal_ref is not null or nullif(p_value->>'reference','') is null then
        raise exception 'Invalid pending renewal.' using errcode='23514';end if;
      update marketplace_private.shop_memberships set pending_renewal_ref=p_value->>'reference' where owner_id=p_owner;
    elsif p_action='resolve' then
      if m.pending_renewal_ref is null or p_value->>'reference' is distinct from m.pending_renewal_ref
        or p_value->>'outcome' is distinct from 'failed' then
        raise exception 'Invalid renewal resolution.' using errcode='23514';end if;
      update marketplace_private.shop_memberships set pending_renewal_ref=null where owner_id=p_owner;
    end if;
  end if;
  if result is null then
    update marketplace_private.shop_memberships set revision=revision+1 where owner_id=p_owner;
    result:=jsonb_build_object('outcome','applied','previousMembership',view_state,
      'membership',marketplace_private.shop_entitlements(p_owner,at_time));
  end if;
  insert into marketplace_private.shop_membership_commands(owner_id,action,action_id,input_digest,proof_key,input,result,recorded_at)
    values(p_owner,p_action,p_action_id,intent,proof,p_value,result,at_time);
  return result;
end;$$;

create function public.marketplace_shop_membership() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode='42501';end if;
  return marketplace_private.shop_entitlements(auth.uid(),clock_timestamp());
end;$$;
create function public.marketplace_claim_shop_trial(p_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
  if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode='42501';end if;
  receipt:=marketplace_private.shop_membership_command(auth.uid(),'trial',p_action_id);
  -- Keep the immutable command receipt, but never present expired replay rights as current.
  return jsonb_set(receipt,'{membership}',marketplace_private.shop_entitlements(auth.uid(),clock_timestamp()));
end;$$;
revoke all on function marketplace_private.protect_shop_membership_history(),
  marketplace_private.shop_calendar_boundary(timestamp,integer),marketplace_private.shop_membership_price(text,text),
  marketplace_private.shop_entitlements(uuid,timestamptz),
  marketplace_private.shop_membership_command(uuid,text,uuid,jsonb,timestamptz),
  public.marketplace_shop_membership(),public.marketplace_claim_shop_trial(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_membership(),public.marketplace_claim_shop_trial(uuid) to authenticated;
commit;

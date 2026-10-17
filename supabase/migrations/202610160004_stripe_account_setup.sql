-- Phase 1B: private test-mode account setup only. No Order or money movement.
begin;
create table marketplace_private.stripe_bindings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('payment_method','payout_account')),
 platform text not null check(platform ~ '^acct_[A-Za-z0-9]+$'),
 mode text not null default 'test' check(mode='test'),
 owner_ref text,
 instrument_ref text,
 setup_ref text,
 setup_operation uuid,
 status text not null default 'unset' check(status in ('unset','set','ready','needs_attention')),
 label text check(length(label)<=80 and label !~ '[[:cntrl:]]|[0-9]{5}'),
 last4 text check(last4 ~ '^[0-9]{4}$'),
 refresh_hash text,
 refresh_expires_at timestamptz,
 lease uuid,
 lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 synced_at timestamptz,
 unique(user_id,kind,platform,mode),
 unique(platform,mode,owner_ref),
 check(owner_ref is null or (kind='payment_method' and owner_ref ~ '^cus_[A-Za-z0-9]+$') or (kind='payout_account' and owner_ref ~ '^acct_[A-Za-z0-9]+$')),
 check(setup_ref is null or (kind='payment_method' and setup_ref ~ '^seti_[A-Za-z0-9]+$')),
 check(instrument_ref is null or instrument_ref ~ '^(pm|ba)_[A-Za-z0-9]+$'),
 check((kind='payment_method' and status<>'ready') or (kind='payout_account' and status<>'set'))
);
create table marketplace_private.stripe_setup_operations (
 id uuid primary key,
 binding_id uuid not null references marketplace_private.stripe_bindings(id) on delete cascade,
 kind text not null check(kind in ('owner','setup')),
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 provider_ref text,
 unique(binding_id,kind,id)
);
create table marketplace_private.stripe_webhook_inbox (
 platform text not null,
 mode text not null check(mode='test'),
 event_id text not null check(length(event_id) between 1 and 255),
 event_type text not null check(length(event_type) between 1 and 160),
 account_scope text not null,
 owner_ref text,
 received_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check(status in ('pending','processing','done')),
 lease uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default clock_timestamp(),
 error_code text check(error_code in ('reconcile_failed','binding_not_ready')),
 processed_at timestamptz,
 primary key(platform,mode,account_scope,event_id)
);
alter table marketplace_private.stripe_bindings enable row level security;
alter table marketplace_private.stripe_setup_operations enable row level security;
alter table marketplace_private.stripe_webhook_inbox enable row level security;
revoke all on marketplace_private.stripe_bindings,marketplace_private.stripe_setup_operations,marketplace_private.stripe_webhook_inbox from public,anon,authenticated,service_role;

create function marketplace_private.require_stripe_staging() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then
  raise exception 'Trusted staging service required.' using errcode='42501';
 end if;
end;$$;

-- Lease fencing serializes provider reads + projection writes without holding DB
-- locks across HTTPS. Provider operations retain durable identities after crashes.
create function public.marketplace_stripe_binding(p_action text,p_user uuid,p_kind text,p_platform text,p_token uuid default null,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b marketplace_private.stripe_bindings;o marketplace_private.stripe_setup_operations;t timestamptz:=clock_timestamp();k text;
begin
 perform marketplace_private.require_stripe_staging();
 if p_platform !~ '^acct_[A-Za-z0-9]+$' or p_kind not in ('payment_method','payout_account') then raise exception 'Invalid binding.';end if;
 if p_action='claim' then
  insert into marketplace_private.stripe_bindings(user_id,kind,platform) values(p_user,p_kind,p_platform) on conflict(user_id,kind,platform,mode) do nothing;
 end if;
 select * into b from marketplace_private.stripe_bindings where user_id=p_user and kind=p_kind and platform=p_platform and mode='test' for update;
 if b.id is null then return null;end if;
 if p_action='read' then return to_jsonb(b);end if;
 if p_action='claim' then
  if b.lease_until>t then return null;end if;
  update marketplace_private.stripe_bindings set lease=gen_random_uuid(),lease_until=t+interval '120 seconds' where id=b.id returning * into b;
  insert into marketplace_private.stripe_setup_operations(id,binding_id,kind) values(b.id,b.id,'owner') on conflict do nothing;
 elsif b.lease is distinct from p_token or b.lease_until<t then raise exception 'Stale provider operation.' using errcode='40001';
 elsif p_action='release' then
  update marketplace_private.stripe_bindings set lease=null,lease_until=null where id=b.id;
  return null;
 elsif p_action='prepare_setup' then
  if b.setup_operation is null or coalesce((p_value->>'rotate')::boolean,false) then
   update marketplace_private.stripe_bindings set setup_operation=gen_random_uuid(),setup_ref=null where id=b.id returning * into b;
   insert into marketplace_private.stripe_setup_operations(id,binding_id,kind) values(b.setup_operation,b.id,'setup');
  end if;
 elsif p_action='patch' then
  for k in select jsonb_object_keys(p_value) loop
   if k not in ('owner_ref','instrument_ref','setup_ref','status','label','last4','refresh_hash','project') then raise exception 'Unexpected binding field.';end if;
  end loop;
  if b.owner_ref is not null and p_value ? 'owner_ref' and p_value->>'owner_ref' is distinct from b.owner_ref then raise exception 'Immutable provider owner.';end if;
  update marketplace_private.stripe_bindings set
   owner_ref=case when p_value ? 'owner_ref' then p_value->>'owner_ref' else owner_ref end,
   instrument_ref=case when p_value ? 'instrument_ref' then p_value->>'instrument_ref' else instrument_ref end,
   setup_ref=case when p_value ? 'setup_ref' then p_value->>'setup_ref' else setup_ref end,
   status=coalesce(p_value->>'status',status),
   label=case when p_value ? 'label' then p_value->>'label' else label end,
   last4=case when p_value ? 'last4' then p_value->>'last4' else last4 end,
   refresh_hash=case when p_value ? 'refresh_hash' then p_value->>'refresh_hash' else refresh_hash end,
   refresh_expires_at=case when p_value ? 'refresh_hash' then t+interval '30 minutes' else refresh_expires_at end,
   synced_at=case when coalesce((p_value->>'project')::boolean,false) then t else synced_at end,
   lease_until=t+interval '120 seconds'
  where id=b.id returning * into b;
  if b.owner_ref is not null then update marketplace_private.stripe_setup_operations set completed_at=coalesce(completed_at,t),provider_ref=b.owner_ref where id=b.id;end if;
  if b.setup_ref is not null then update marketplace_private.stripe_setup_operations set completed_at=coalesce(completed_at,t),provider_ref=b.setup_ref where id=b.setup_operation;end if;
  if coalesce((p_value->>'project')::boolean,false) then
   if b.status='unset' then
    -- Never remove another provider's historical capability during setup.
    delete from marketplace_private.financial_capabilities where user_id=p_user and capability=p_kind and provider_key='stripe_test';
   else
    perform public.marketplace_record_financial_capability(b.user_id,b.kind,b.status,'stripe_test',b.owner_ref,coalesce(b.instrument_ref,b.owner_ref),b.label,b.last4);
   end if;
  end if;
 elsif p_action='operation' then
  select * into o from marketplace_private.stripe_setup_operations where id=case when p_value->>'kind'='owner' then b.id else b.setup_operation end;
  return to_jsonb(o);
 else raise exception 'Unknown provider operation.';
 end if;
 return to_jsonb(b);
end;$$;

create function public.marketplace_stripe_capabilities(p_user uuid,p_platform text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform marketplace_private.require_stripe_staging();
 return jsonb_build_object(
 'paymentMethod',coalesce((select jsonb_build_object('status',status,'brand',label,'last4',last4) from marketplace_private.stripe_bindings where user_id=p_user and kind='payment_method' and platform=p_platform and mode='test' and status<>'unset'),jsonb_build_object('status','unset','brand',null,'last4',null)),
 'payoutAccount',coalesce((select jsonb_build_object('status',status,'institution',label,'last4',last4) from marketplace_private.stripe_bindings where user_id=p_user and kind='payout_account' and platform=p_platform and mode='test' and status<>'unset'),jsonb_build_object('status','unset','institution',null,'last4',null)));
end;$$;

create function public.marketplace_stripe_events(p_action text,p_platform text,p_value jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e marketplace_private.stripe_webhook_inbox;b marketplace_private.stripe_bindings;t timestamptz:=clock_timestamp();
begin
 perform marketplace_private.require_stripe_staging();
 if p_action='enqueue' then
  insert into marketplace_private.stripe_webhook_inbox(platform,mode,event_id,event_type,account_scope,owner_ref)
  values(p_platform,'test',p_value->>'id',p_value->>'type',p_value->>'scope',p_value->>'owner') on conflict do nothing;
  return '{}'::jsonb;
 elsif p_action='claim' then
  select * into e from marketplace_private.stripe_webhook_inbox where platform=p_platform and mode='test' and status<>'done' and next_attempt_at<=t and (lease_until is null or lease_until<t) order by received_at for update skip locked limit 1;
  if e.event_id is null then return null;end if;
  update marketplace_private.stripe_webhook_inbox set status='processing',lease=gen_random_uuid(),lease_until=t+interval '180 seconds',attempts=attempts+1
  where platform=e.platform and mode=e.mode and account_scope=e.account_scope and event_id=e.event_id returning * into e;
  select * into b from marketplace_private.stripe_bindings where platform=p_platform and mode='test' and (owner_ref=e.owner_ref or instrument_ref=e.owner_ref);
  return to_jsonb(e)||jsonb_build_object('binding',case when b.id is null then null else jsonb_build_object('user_id',b.user_id,'kind',b.kind) end);
 elsif p_action in ('done','retry') then
  update marketplace_private.stripe_webhook_inbox set status=case when p_action='done' then 'done' else 'pending' end,processed_at=case when p_action='done' then t else null end,
   lease=null,lease_until=null,next_attempt_at=t+interval '1 minute',error_code=case when p_action='done' then null else 'reconcile_failed' end
  where platform=p_platform and mode='test' and account_scope=p_value->>'scope' and event_id=p_value->>'id' and lease=(p_value->>'lease')::uuid and lease_until>t;
  return '{}'::jsonb;
 else raise exception 'Unknown event action.';end if;
end;$$;
revoke all on function marketplace_private.require_stripe_staging(),public.marketplace_stripe_binding(text,uuid,text,text,uuid,jsonb),public.marketplace_stripe_capabilities(uuid,text),public.marketplace_stripe_events(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_stripe_binding(text,uuid,text,text,uuid,jsonb),public.marketplace_stripe_capabilities(uuid,text),public.marketplace_stripe_events(text,text,jsonb) to service_role;
commit;

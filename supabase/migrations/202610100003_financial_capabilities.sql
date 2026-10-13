-- Phase A: account capabilities only; reviewed/applied exclusively to staging.
begin;
create table marketplace_private.financial_capabilities (
  user_id uuid not null references public.profiles(id) on delete cascade,
  capability text not null check (capability in ('payment_method','payout_account')),
  status text not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_owner_ref text not null check (length(provider_owner_ref) between 1 and 255 and provider_owner_ref = btrim(provider_owner_ref)),
  provider_instrument_ref text not null check (length(provider_instrument_ref) between 1 and 255 and provider_instrument_ref = btrim(provider_instrument_ref)),
  display_label text check (length(display_label) between 1 and 80 and display_label = btrim(display_label) and display_label !~ '[[:cntrl:]]|[0-9]{5}'),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id,capability),
  check ((capability='payment_method' and status in ('set','needs_attention'))
    or (capability='payout_account' and status in ('ready','needs_attention')))
);
-- Unset is absence, independently for each capability. No backfill or fake readiness.
alter table marketplace_private.financial_capabilities enable row level security;
revoke all on marketplace_private.financial_capabilities from public,anon,authenticated,service_role;
-- No table policies/grants: even safe reads use an identity-bound projection.

create function marketplace_private.financial_capabilities_projection(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'paymentMethod',coalesce((select jsonb_build_object('status',f.status,'brand',f.display_label,'last4',f.last4)
    from marketplace_private.financial_capabilities f where f.user_id=p_user_id and f.capability='payment_method'),
    jsonb_build_object('status','unset','brand',null,'last4',null)),
  'payoutAccount',coalesce((select jsonb_build_object('status',f.status,'institution',f.display_label,'last4',f.last4)
    from marketplace_private.financial_capabilities f where f.user_id=p_user_id and f.capability='payout_account'),
    jsonb_build_object('status','unset','institution',null,'last4',null)));
$$;
create function public.marketplace_financial_capabilities()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified Western account required.' using errcode='42501';
 end if;
 return marketplace_private.financial_capabilities_projection(auth.uid());
end; $$;

-- Trusted server read; arbitrary identity is deliberately unavailable to browsers.
create function public.marketplace_financial_capabilities_for_user(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id=p_user_id) then
  raise exception 'Account not found.' using errcode='23503';
 end if;
 return marketplace_private.financial_capabilities_projection(p_user_id);
end; $$;

-- Future adapter must validate provider evidence BEFORE calling this service-role-only
-- boundary. No provider callbacks, client setup endpoint or readiness gate in Phase A.
create function public.marketplace_record_financial_capability(
 p_user_id uuid,p_capability text,p_status text,p_provider_key text,
 p_provider_owner_ref text,p_provider_instrument_ref text,p_display_label text,p_last4 text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_capability is null or p_capability not in ('payment_method','payout_account') then
  raise exception 'Invalid capability.' using errcode='23514';
 end if;
 if not exists(select 1 from public.profiles where id=p_user_id) then
  raise exception 'Account not found.' using errcode='23503';
 end if;
 if p_status='unset' then
  if p_provider_key is not null or p_provider_owner_ref is not null or p_provider_instrument_ref is not null
    or p_display_label is not null or p_last4 is not null then
   raise exception 'Unset must clear metadata.' using errcode='23514';
  end if;
  delete from marketplace_private.financial_capabilities where user_id=p_user_id and capability=p_capability;
  return;
 end if;
 insert into marketplace_private.financial_capabilities(user_id,capability,status,provider_key,provider_owner_ref,provider_instrument_ref,display_label,last4)
 values(p_user_id,p_capability,p_status,p_provider_key,p_provider_owner_ref,p_provider_instrument_ref,p_display_label,p_last4)
 on conflict(user_id,capability) do update set status=excluded.status,provider_key=excluded.provider_key,
  provider_owner_ref=excluded.provider_owner_ref,provider_instrument_ref=excluded.provider_instrument_ref,
  display_label=excluded.display_label,last4=excluded.last4,updated_at=clock_timestamp();
end; $$;
revoke all on function marketplace_private.financial_capabilities_projection(uuid),
 public.marketplace_financial_capabilities(),public.marketplace_financial_capabilities_for_user(uuid),
 public.marketplace_record_financial_capability(uuid,text,text,text,text,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_financial_capabilities() to authenticated;
grant execute on function public.marketplace_financial_capabilities_for_user(uuid),
 public.marketplace_record_financial_capability(uuid,text,text,text,text,text,text,text) to service_role;
commit;

-- B31: buyer-controlled receipt confirmation and 48-hour release protection.
-- Provider calls remain outside PostgreSQL; this migration only records
-- authoritative order facts and adds a fail-closed transfer gate.
begin;

alter table marketplace_private.order_protection
  drop constraint if exists order_protection_expires_at_check,
  add column if not exists buyer_confirmed_at timestamptz,
  add column if not exists release_eligible_at timestamptz,
  add constraint order_protection_expires_at_check
    check ((expires_at=started_at+interval '24 hours' and buyer_confirmed_at is null)
      or (expires_at=started_at+interval '48 hours'
        and buyer_confirmed_at is not null and release_eligible_at=expires_at)),
  add constraint order_protection_release_window_check
    check ((buyer_confirmed_at is null and release_eligible_at is null)
      or (buyer_confirmed_at is not null
        and release_eligible_at = buyer_confirmed_at + interval '48 hours'));

create index if not exists order_protection_release_due_idx
  on marketplace_private.order_protection(release_eligible_at, order_id)
  where release_eligible_at is not null and completed_at is null;

-- Handoff/delivery observations are not receipt confirmation.  Only the
-- buyer_receipt command below starts the protection clock.
create or replace function marketplace_private.begin_order_protection(
  o public.orders, p_source text, t timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_source is distinct from 'buyer_received' then
    insert into marketplace_private.order_protection(order_id,source,started_at,expires_at)
      values(o.id,p_source,t,t+interval '24 hours') on conflict (order_id) do nothing;
    return;
  end if;
  insert into marketplace_private.order_protection(
    order_id,source,started_at,expires_at,buyer_confirmed_at,release_eligible_at)
  values(o.id,p_source,t,t+interval '48 hours',t,t+interval '48 hours')
  on conflict (order_id) do update set
    source='buyer_received',started_at=excluded.started_at,expires_at=excluded.expires_at,
    buyer_confirmed_at=excluded.buyer_confirmed_at,release_eligible_at=excluded.release_eligible_at
    where marketplace_private.order_protection.buyer_confirmed_at is null;
end;$$;

create or replace function public.marketplace_confirm_buyer_receipt(
  p_order_id uuid, p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  o public.orders;
  cmd marketplace_private.buyer_receipt_commands;
  p marketplace_private.order_protection;
  a marketplace_private.handoff_authorizations;
  s marketplace_private.courier_shipments;
  c marketplace_private.protection_cases;
  t timestamptz;
begin
  if auth.uid() is null or not coalesce(marketplace_private.is_verified_user(),false)
    then raise exception 'Verified Buyer required.' using errcode='42501'; end if;
  if p_order_id is null or p_client_action_id is null
    then raise exception 'Order and command required.' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'buyer_receipt:'||p_order_id::text,0));
  select * into o from public.orders where id=p_order_id;
  if o.id is null or o.buyer_id is distinct from auth.uid()
    or o.order_protocol_version<>2 then
    raise exception 'Actual Order buyer required.' using errcode='42501'; end if;
  select * into cmd from marketplace_private.buyer_receipt_commands
    where buyer_id=auth.uid() and command=p_client_action_id;
  if found and cmd.order_id<>o.id then raise exception 'Command reused.' using errcode='23505'; end if;
  perform 1 from public.listings where id=o.listing_id for update;
  select * into o from public.orders where id=p_order_id for update;
  perform marketplace_private.assert_order_progression(o);
  select * into p from marketplace_private.order_protection where order_id=o.id for update;
  if p.order_id is not null and p.buyer_confirmed_at is not null then
    if exists(select 1 from marketplace_private.buyer_receipt_commands
      where order_id=o.id and buyer_id=auth.uid() and command=p_client_action_id)
      or cmd.order_id=o.id then
      return jsonb_build_object('received',true,'confirmedAt',p.buyer_confirmed_at,
        'releaseEligibleAt',p.release_eligible_at,'idempotent',true);
    end if;
    raise exception 'Buyer receipt already confirmed.' using errcode='23505';
  end if;
  select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
  select * into s from marketplace_private.courier_shipments where order_id=o.id;
  if (a.order_id is null or a.redeemed_at is null)
    and (s.order_id is null or s.state not in('shipped','delivered')) then
    raise exception 'Delivery or handoff confirmation required.' using errcode='23505'; end if;
  select * into c from marketplace_private.protection_cases where order_id=o.id;
  if o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing
    or c.order_id is not null then
    raise exception 'Paid open Order without an active protection case required.' using errcode='23505'; end if;
  t:=clock_timestamp();
  insert into marketplace_private.buyer_receipt_commands(buyer_id,command,order_id,confirmed_at)
    values(auth.uid(),p_client_action_id,o.id,t)
    on conflict (buyer_id,command) do nothing;
  perform marketplace_private.begin_order_protection(o,'buyer_received',t);
  select * into p from marketplace_private.order_protection where order_id=o.id;
  perform marketplace_private.emit_order_domain_event(o,'buyer_confirm_received',t,auth.uid());
  return jsonb_build_object('received',true,'confirmedAt',p.buyer_confirmed_at,
    'releaseEligibleAt',p.release_eligible_at,'idempotent',false);
end;$$;

-- Keep the existing courier endpoint compatible while using the same
-- authoritative receipt implementation and ordinary verified-email access.
create or replace function public.marketplace_confirm_courier_received(
  p_order_id uuid,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier'
    then raise exception 'Actual Courier Buyer required.' using errcode='42501'; end if;
  return public.marketplace_confirm_buyer_receipt(p_order_id,p_client_action_id);
end;$$;

create or replace function marketplace_private.settle_order_protection(p_listing uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; p marketplace_private.order_protection; t timestamptz;
begin
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing
    and order_protocol_version=2 for update;
  if o.id is null or o.lifecycle_status<>'open' or o.payment_status<>'paid' then return; end if;
  select * into p from marketplace_private.order_protection where order_id=o.id for update;
  t:=clock_timestamp();
  if p.order_id is null or p.completed_at is not null
    or p.buyer_confirmed_at is null or p.release_eligible_at is null
    or p.release_eligible_at>t
    or exists(select 1 from marketplace_private.protection_cases where order_id=o.id)
    or exists(select 1 from marketplace_private.order_refund_operations
      where order_id=o.id and state in('prepared','in_flight','reconciling')) then return; end if;
  update marketplace_private.order_protection set completed_at=t where order_id=o.id;
  update public.orders set lifecycle_status='completed',holds_listing=false,payout_status='eligible',
    fulfillment_status='fulfilled',reservation_ended_at=t,updated_at=t where id=o.id;
  update public.listings set status='sold',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
end;$$;

create or replace function marketplace_private.require_b31_transfer_release()
returns trigger language plpgsql security definer set search_path='' as $$
declare p marketplace_private.order_protection;
begin
  if new.transfer_kind='sale_proceeds' then
    select * into p from marketplace_private.order_protection where order_id=new.order_id;
    if p.order_id is null or p.buyer_confirmed_at is null or p.release_eligible_at is null
      or p.completed_at is null or p.completed_at<p.release_eligible_at then
      raise exception 'Buyer receipt protection is not released.' using errcode='23514';
    end if;
  end if;
  return new;
end;$$;
drop trigger if exists order_transfer_b31_release_gate on marketplace_private.order_transfer_operations;
create trigger order_transfer_b31_release_gate
  before insert or update on marketplace_private.order_transfer_operations
  for each row execute function marketplace_private.require_b31_transfer_release();

revoke all on function public.marketplace_confirm_buyer_receipt(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_confirm_buyer_receipt(uuid,uuid) to authenticated;
revoke all on function marketplace_private.require_b31_transfer_release() from public,anon,authenticated,service_role;

create or replace function public.marketplace_order_fulfillment(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.orders;p marketplace_private.order_protection;a marketplace_private.handoff_authorizations;c marketplace_private.protection_cases;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into p from marketplace_private.order_protection where order_id=o.id;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 return jsonb_build_object('agreement',public.marketplace_order_agreement(o.id),'orderId',o.id,
  'handoffReady',a.order_id is not null and a.redeemed_at is null and o.lifecycle_status='open' and marketplace_private.order_progression_allowed(o),
  'deliveryStartedAt',(select started_at from marketplace_private.seller_delivery_starts where order_id=o.id),
  'cancellation',public.marketplace_order_cancellation_state(o.id),'handoffConfirmedAt',a.redeemed_at,
  'protectionStartedAt',p.started_at,'protectionExpiresAt',p.expires_at,'buyerConfirmedAt',p.buyer_confirmed_at,
  'releaseEligibleAt',p.release_eligible_at,'protectionCompletedAt',p.completed_at,
  'protectionHold',c.id is not null,'caseState',c.state,
  'payoutEligible',o.lifecycle_status='completed' and c.id is null and o.payout_status='eligible',
  'serverTime',clock_timestamp());
end;$$;
revoke all on function public.marketplace_order_fulfillment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_fulfillment(uuid) to authenticated;

commit;

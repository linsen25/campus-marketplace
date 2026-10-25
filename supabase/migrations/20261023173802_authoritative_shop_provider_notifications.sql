-- B27-A: project already-authoritative Shop, membership and provider facts into
-- the existing notification domain. No provider action or financial transition
-- is performed here, and these event types remain in-app only by default.
begin;

create function marketplace_private.emit_authoritative_notification(
 p_source_key text,p_event_type text,p_recipient uuid,p_priority text,
 p_destination jsonb,p_created_at timestamptz
) returns void language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
 if p_source_key is null or length(p_source_key)>500 or p_event_type is null
  or p_recipient is null or p_priority not in('INFORMATIONAL','ACTION_REQUIRED')
  or p_destination is null or jsonb_typeof(p_destination)<>'object'
  or p_created_at is null then
  raise exception 'Complete authoritative notification required.' using errcode='23514';
 end if;
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values(p_source_key,p_event_type,p_created_at,p_destination)
 on conflict(source_key) do nothing;
 select id into event_id from marketplace_private.notification_events where source_key=p_source_key;
 perform marketplace_private.deliver_notification(event_id,p_recipient,p_priority);
end;$$;

-- Commands record an applied entitlement effect. They are not provider payment
-- evidence, so the projected names deliberately make no billing-success claim.
create function marketplace_private.project_shop_membership_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if new.result->>'outcome' is distinct from 'applied' then return new;end if;
 kind:=case new.action when 'trial' then 'shop_trial_activated'
  when 'purchase' then 'shop_membership_access_started'
  when 'upgrade' then 'shop_membership_access_upgraded' end;
 if kind is null then return new;end if;
 perform marketplace_private.emit_authoritative_notification(
  'shop-membership:'||new.owner_id::text||':'||new.action||':'||new.action_id::text,
  kind,new.owner_id,'INFORMATIONAL',jsonb_build_object('section','shop','destination','my-shop'),new.recorded_at);
 return new;
end;$$;
create trigger shop_membership_notification_projector
 after insert on marketplace_private.shop_membership_commands
 for each row execute function marketplace_private.project_shop_membership_notification();

-- A lifecycle cycle is created only after B12 evaluates the full Grace window as
-- expired. Reopen is tied to that same immutable cycle, never to a periodic scan.
create function marketplace_private.project_shop_suspension_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  perform marketplace_private.emit_authoritative_notification(
   'shop-suspension:'||new.id::text||':suspended','shop_suspended',new.owner_id,
   'INFORMATIONAL',jsonb_build_object('section','shop','destination','my-shop'),new.suspended_at);
 elsif old.state='open' and new.state='reopened' and new.reopened_at is not null then
  perform marketplace_private.emit_authoritative_notification(
   'shop-suspension:'||new.id::text||':reopened','shop_reopened',new.owner_id,
   'INFORMATIONAL',jsonb_build_object('section','shop','destination','my-shop'),new.reopened_at);
 end if;
 return new;
end;$$;
create trigger shop_suspension_notification_projector
 after insert or update of state,reopened_at on marketplace_private.shop_suspension_cycles
 for each row execute function marketplace_private.project_shop_suspension_notification();

create function marketplace_private.project_order_refund_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;kind text;
begin
 if new.state is not distinct from old.state and new.provider_status is not distinct from old.provider_status then return new;end if;
 kind:=case
  when new.state='succeeded' and new.provider_status='succeeded' then 'order_refund_succeeded'
  when new.state='failed' and new.provider_status in('failed','canceled') then 'order_refund_failed'
  when new.state='exception' then 'order_refund_unresolved' end;
 if kind is null then return new;end if;
 select buyer_id into recipient from public.orders where id=new.order_id;
 perform marketplace_private.emit_authoritative_notification(
  'order-refund:'||new.operation_id::text||':'||kind,kind,recipient,'INFORMATIONAL',
  jsonb_build_object('section','orders','orderId',new.order_id),new.updated_at);
 return new;
end;$$;
create trigger order_refund_notification_projector
 after update of state,provider_status on marketplace_private.order_refund_operations
 for each row execute function marketplace_private.project_order_refund_notification();

create function marketplace_private.project_order_transfer_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if new.state is not distinct from old.state and new.provider_status is not distinct from old.provider_status then return new;end if;
 kind:=case
  when new.provider_status='reversed' then 'seller_transfer_reversed'
  when new.provider_status='partially_reversed' then 'seller_transfer_partially_reversed'
  when new.state='succeeded' and new.provider_status='succeeded' then 'seller_transfer_succeeded'
  when new.state='failed' and new.provider_status='failed' then 'seller_transfer_failed'
  when new.state='exception' then 'seller_transfer_unresolved' end;
 if kind is null then return new;end if;
 perform marketplace_private.emit_authoritative_notification(
  'order-transfer:'||new.operation_id::text||':'||kind,kind,new.seller_id,'INFORMATIONAL',
  jsonb_build_object('section','orders','orderId',new.order_id),new.updated_at);
 return new;
end;$$;
create trigger order_transfer_notification_projector
 after update of state,provider_status on marketplace_private.order_transfer_operations
 for each row execute function marketplace_private.project_order_transfer_notification();

-- Connected-account Payouts are account-level bank facts. They are never
-- represented as Order settlement or inferred from a Transfer amount.
create function marketplace_private.project_connected_payout_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;kind text;
begin
 if tg_op='UPDATE' and new.provider_status is not distinct from old.provider_status then return new;end if;
 kind:=case new.provider_status when 'paid' then 'connected_bank_payout_paid'
  when 'failed' then 'connected_bank_payout_failed'
  when 'canceled' then 'connected_bank_payout_canceled' end;
 if kind is null then return new;end if;
 select b.user_id into recipient from marketplace_private.stripe_bindings b
  where b.kind='payout_account' and b.platform=new.provider_platform and b.mode=new.provider_mode
   and b.owner_ref=new.connected_account_ref;
 if recipient is null then return new;end if;
 perform marketplace_private.emit_authoritative_notification(
  'connected-payout:'||new.provider_platform||':'||new.provider_mode||':'||new.payout_ref||':'||kind,
  kind,recipient,'INFORMATIONAL',jsonb_build_object('section','settings','panel','payments-payouts'),
  new.provider_observed_at);
 return new;
end;$$;
create trigger connected_payout_notification_projector
 after insert or update of provider_status on marketplace_private.connected_payout_observations
 for each row execute function marketplace_private.project_connected_payout_notification();

revoke all on function marketplace_private.emit_authoritative_notification(text,text,uuid,text,jsonb,timestamptz),
 marketplace_private.project_shop_membership_notification(),
 marketplace_private.project_shop_suspension_notification(),
 marketplace_private.project_order_refund_notification(),
 marketplace_private.project_order_transfer_notification(),
 marketplace_private.project_connected_payout_notification()
 from public,anon,authenticated,service_role;

commit;

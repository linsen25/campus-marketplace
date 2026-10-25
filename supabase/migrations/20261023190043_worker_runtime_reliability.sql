-- B28-A: bound each existing transaction due-work pass without changing
-- expiry, settlement, reminder, authorization, locking or idempotency rules.
begin;

create or replace function marketplace_private.run_transaction_due_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 due_row record;
 current_order public.orders;
 reminder marketplace_private.notification_reminders;
 eligible boolean;
 event_id uuid;
 observed_at timestamptz;
 offers_checked integer:=0;
 orders_checked integer:=0;
 reminders_checked integer:=0;
 batch_limit constant integer:=50;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('marketplace_v2_due_work',0)) then
  return jsonb_build_object('overlapSkipped',true,'batchLimit',batch_limit);
 end if;

 for due_row in
  select c.id
  from public.conversations c
  where exists(
   select 1 from public.order_requests due_offer
   where due_offer.conversation_id=c.id and due_offer.protocol_version=2
    and due_offer.status='active' and due_offer.offer_terms->>'fulfillment'='on_campus'
    and (due_offer.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp())
  order by c.listing_id,c.id
  limit batch_limit
 loop
  perform marketplace_private.expire_conversation_offers(due_row.id);
  offers_checked:=offers_checked+1;
 end loop;

 for due_row in
  select distinct due_order.listing_id
  from public.orders due_order
  where due_order.order_protocol_version=2 and due_order.lifecycle_status='open'
   and due_order.holds_listing and(
    (due_order.payment_status in('pending','failed') and(
     exists(select 1 from marketplace_private.delivery_checkouts checkout
      where checkout.order_id=due_order.id and(
       (checkout.checkout_started_at is null and checkout.checkout_claim_deadline_at<=clock_timestamp())
       or checkout.payment_deadline_at<=clock_timestamp()))
     or exists(select 1 from public.order_meetup_revisions meetup_revision
      where meetup_revision.order_id=due_order.id and meetup_revision.status='confirmed'
       and meetup_revision.scheduled_at+interval '60 minutes'<=clock_timestamp()
       and meetup_revision.id=(select latest.id from public.order_meetup_revisions latest
        where latest.order_id=due_order.id and latest.status='confirmed'
        order by latest.revision desc limit 1))))
    or(due_order.payment_status='paid' and exists(
     select 1 from marketplace_private.order_protection protection
     where protection.order_id=due_order.id and protection.completed_at is null
      and protection.expires_at<=clock_timestamp()) and not exists(
     select 1 from marketplace_private.protection_cases protection_case
     where protection_case.order_id=due_order.id)))
  order by due_order.listing_id
  limit batch_limit
 loop
  perform marketplace_private.settle_delivery_checkout(due_row.listing_id);
  perform marketplace_private.settle_order_meetup(due_row.listing_id);
  perform marketplace_private.settle_order_protection(due_row.listing_id);
  orders_checked:=orders_checked+1;
 end loop;

 for reminder in
  select *
  from marketplace_private.notification_reminders
  where delivered_at is null and suppressed_at is null and due_at<=clock_timestamp()
  order by due_at,identity
  limit batch_limit
 loop
  reminders_checked:=reminders_checked+1;
  select * into current_order from public.orders where id=reminder.order_id;
  perform 1 from public.listings where id=current_order.listing_id for update;
  select * into current_order from public.orders where id=reminder.order_id for update;
  select reminder_row.* into reminder
  from marketplace_private.notification_reminders reminder_row
  where reminder_row.identity=reminder.identity for update;
  if reminder.delivered_at is not null or reminder.suppressed_at is not null then
   continue;
  end if;
  observed_at:=clock_timestamp();
  eligible:=current_order.lifecycle_status='open' and current_order.holds_listing
   and not marketplace_private.external_exchange_started(current_order.id);
  if reminder.confirmed_revision_id is not null then
   eligible:=eligible and current_order.payment_status in('pending','failed') and exists(
    select 1 from public.order_meetup_revisions meetup_revision
    where meetup_revision.id=reminder.confirmed_revision_id
     and meetup_revision.status='confirmed' and meetup_revision.scheduled_at>observed_at
     and meetup_revision.id=(
      select id from public.order_meetup_revisions
      where order_id=current_order.id and status='confirmed'
      order by revision desc limit 1));
  elsif reminder.kind='delivery_claim_1h' then
   eligible:=eligible and current_order.payment_status in('pending','failed') and exists(
    select 1 from marketplace_private.delivery_checkouts checkout
    where checkout.order_id=current_order.id and checkout.checkout_started_at is null
     and checkout.checkout_claim_deadline_at>observed_at);
  else
   eligible:=eligible and current_order.payment_status in('pending','failed','processing') and exists(
    select 1 from marketplace_private.delivery_checkouts checkout
    where checkout.order_id=current_order.id and checkout.payment_deadline_at>observed_at);
  end if;
  if eligible then
   insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
   values('reminder:'||reminder.identity,reminder.kind,observed_at,
    jsonb_build_object('section','orders','orderId',current_order.id))
   on conflict(source_key) do nothing;
   select id into event_id from marketplace_private.notification_events
    where source_key='reminder:'||reminder.identity;
   perform marketplace_private.deliver_notification(
    event_id,reminder.recipient,'ACTION_REQUIRED');
   update marketplace_private.notification_reminders reminder_row
   set delivered_at=observed_at where reminder_row.identity=reminder.identity;
  else
   update marketplace_private.notification_reminders reminder_row
   set suppressed_at=observed_at where reminder_row.identity=reminder.identity;
  end if;
 end loop;

 return jsonb_build_object(
  'offersChecked',offers_checked,
  'ordersChecked',orders_checked,
  'remindersChecked',reminders_checked,
  'batchLimit',batch_limit,
  'serverTime',clock_timestamp());
end;$$;

commit;


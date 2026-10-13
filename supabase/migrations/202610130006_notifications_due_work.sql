-- One durable, idempotent V2 deadline/reminder entry point. No email or UI.
begin;
create table marketplace_private.notification_reminders (
 identity text primary key,order_id uuid not null references public.orders(id),
 confirmed_revision_id uuid,kind text not null,recipient uuid not null,
 due_at timestamptz not null,created_at timestamptz not null,
 delivered_at timestamptz,suppressed_at timestamptz,
 check(due_at>created_at),check(num_nonnulls(delivered_at,suppressed_at)<=1)
);
alter table marketplace_private.notification_reminders enable row level security;
revoke all on marketplace_private.notification_reminders from public,anon,authenticated,service_role;

create or replace function marketplace_private.project_transaction_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;o public.orders;eid uuid;dest jsonb;kind text;target uuid;priority text:='INFORMATIONAL';
begin
select * into r from public.order_requests where id=new.request_id;
if r.protocol_version is distinct from 2 then return new;end if;
if new.order_id is not null then select * into o from public.orders where id=new.order_id;end if;
if o.id is null and new.event_type='offer_accepted' then select * into o from public.orders where request_id=r.id;end if;
dest:=case when o.id is not null then jsonb_build_object('section','orders','orderId',o.id)
else jsonb_build_object('section','messages','conversationId',new.conversation_id,'offerId',r.id) end;kind:=new.event_type;
if kind='offer_created' then
kind:=case when new.metadata->>'previousOfferId' is not null and exists(select 1 from public.order_requests prev
where prev.id=(new.metadata->>'previousOfferId')::uuid and prev.sender_user_id<>r.sender_user_id) then 'incoming_counter_offer' else 'incoming_offer' end;
target:=r.recipient_user_id;priority:='ACTION_REQUIRED';
elsif kind='offer_withdrawn' then target:=r.recipient_user_id;
elsif kind='offer_accepted' then target:=r.sender_user_id;
elsif kind in('meetup_proposed','meetup_confirmed','meetup_declined') then
target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
if kind='meetup_proposed' then priority:='ACTION_REQUIRED';end if;
elsif kind='order_cancelled' and new.actor_id is not null then target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
elsif kind='payment_paid' then target:=r.seller_id;
elsif kind='handoff_ready' then target:=null;priority:='ACTION_REQUIRED';
elsif kind='courier_delivered' then target:=null;
elsif kind='protection_started' then
-- One possession event already carries the useful Buyer/Seller context. Add only
-- the recipient not covered by that event, rather than duplicate both feeds.
if exists(select 1 from public.transaction_events where order_id=o.id and event_type='courier_delivered') then return new;end if;
if exists(select 1 from public.transaction_events where order_id=o.id and event_type='handoff_confirmed') then target:=r.seller_id;
elsif exists(select 1 from public.transaction_events where order_id=o.id and event_type='buyer_confirm_received') then target:=r.buyer_id;
else target:=null;end if;
elsif kind in('offer_closed','order_no_show_expired','reservation_expired','order_cancelled','order_completed') then target:=null;
elsif kind in('handoff_confirmed','courier_shipped') then target:=r.buyer_id;
elsif kind in('buyer_confirm_received','protection_case_opened') then target:=r.seller_id;
else return new;end if;
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('transaction:'||new.id,kind,new.created_at,dest) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='transaction:'||new.id;
if target is not null then
if target is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,target,priority);end if;
else
if r.buyer_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.buyer_id,case when kind='courier_delivered' then 'ACTION_REQUIRED' else priority end);end if;
if r.seller_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.seller_id,priority);end if;
end if;
if new.event_type='offer_accepted' and o.terms_snapshot->'terms'->>'fulfillment'='delivery' and r.sender_user_id=r.buyer_id then
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('checkout-available:'||o.id,'delivery_checkout_available',new.created_at,dest) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='checkout-available:'||o.id;
perform marketplace_private.deliver_notification(eid,r.buyer_id,'ACTION_REQUIRED');
end if;return new;
end;$$;

create function marketplace_private.schedule_order_reminders() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.orders;confirmed timestamptz;hours integer;member uuid;kind text;t timestamptz:=clock_timestamp();
begin
select * into o from public.orders where id=new.order_id;
if o.order_protocol_version<>2 then return new;end if;
if tg_table_name='order_meetup_revisions' then
if new.status<>'confirmed' then return new;end if;
confirmed:=coalesce(new.decided_at,new.proposed_at);
foreach hours in array array[24,1] loop
if new.scheduled_at-make_interval(hours=>hours)>confirmed then
foreach member in array array[o.buyer_id,o.seller_id] loop
if member is not null then
insert into marketplace_private.notification_reminders(identity,order_id,confirmed_revision_id,kind,recipient,due_at,created_at)
values('meetup:'||o.id||':'||new.id||':'||hours||':'||member,o.id,new.id,'meetup_'||hours||'h',member,new.scheduled_at-make_interval(hours=>hours),confirmed)
on conflict(identity) do nothing;
end if;end loop;end if;end loop;
else
if new.checkout_started_at is null then
insert into marketplace_private.notification_reminders(identity,order_id,kind,recipient,due_at,created_at)
values('checkout-claim:'||o.id,o.id,'delivery_claim_1h',o.buyer_id,new.checkout_claim_deadline_at-interval '1 hour',o.accepted_at)
on conflict(identity) do nothing;
else
insert into marketplace_private.notification_reminders(identity,order_id,kind,recipient,due_at,created_at)
values('payment-deadline:'||o.id,o.id,'delivery_payment_10m',o.buyer_id,new.payment_deadline_at-interval '10 minutes',new.checkout_started_at)
on conflict(identity) do nothing;
end if;end if;return new;
end;$$;
create trigger meetup_schedule_reminders after insert or update on public.order_meetup_revisions
for each row execute function marketplace_private.schedule_order_reminders();
create trigger delivery_schedule_reminders after insert or update of checkout_started_at on marketplace_private.delivery_checkouts
for each row execute function marketplace_private.schedule_order_reminders();

create function marketplace_private.run_transaction_due_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare row record;o public.orders;r marketplace_private.notification_reminders;eligible boolean;eid uuid;t timestamptz;processed integer:=0;
begin
-- Prevent overlapping scheduler scans, while domain locks serialize caller races.
if not pg_try_advisory_xact_lock(hashtextextended('marketplace_v2_due_work',0)) then return jsonb_build_object('overlapSkipped',true);end if;
for row in select distinct listing_id from public.orders where order_protocol_version=2 and lifecycle_status='open' and holds_listing order by listing_id loop
perform marketplace_private.settle_delivery_checkout(row.listing_id);
perform marketplace_private.settle_order_meetup(row.listing_id);
perform marketplace_private.settle_order_protection(row.listing_id);
processed:=processed+1;
end loop;
for r in select * from marketplace_private.notification_reminders where delivered_at is null and suppressed_at is null and due_at<=clock_timestamp() order by due_at,identity loop
select * into o from public.orders where id=r.order_id;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=r.order_id for update;
select * into r from marketplace_private.notification_reminders where identity=r.identity for update;
if r.delivered_at is not null or r.suppressed_at is not null then continue;end if;
t:=clock_timestamp();eligible:=o.lifecycle_status='open' and o.holds_listing;
if r.confirmed_revision_id is not null then
eligible:=eligible and o.payment_status in('pending','failed') and exists(select 1 from public.order_meetup_revisions mr
where mr.id=r.confirmed_revision_id and mr.status='confirmed' and mr.scheduled_at>t
and mr.id=(select id from public.order_meetup_revisions where order_id=o.id and status='confirmed' order by revision desc limit 1));
elsif r.kind='delivery_claim_1h' then
eligible:=eligible and o.payment_status in('pending','failed') and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=o.id and c.checkout_started_at is null and c.checkout_claim_deadline_at>t);
else
eligible:=eligible and o.payment_status in('pending','failed','processing') and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=o.id and c.payment_deadline_at>t);
end if;
if eligible then
insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
values('reminder:'||r.identity,r.kind,t,jsonb_build_object('section','orders','orderId',o.id)) on conflict(source_key) do nothing;
select id into eid from marketplace_private.notification_events where source_key='reminder:'||r.identity;
perform marketplace_private.deliver_notification(eid,r.recipient,'ACTION_REQUIRED');
update marketplace_private.notification_reminders set delivered_at=t where identity=r.identity;
else update marketplace_private.notification_reminders set suppressed_at=t where identity=r.identity;end if;
end loop;return jsonb_build_object('ordersChecked',processed,'serverTime',clock_timestamp());
end;$$;
create function public.marketplace_run_transaction_due_work() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
if auth.jwt()->>'role' is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging worker required.' using errcode='42501';end if;
return marketplace_private.run_transaction_due_work();end;$$;
revoke all on function marketplace_private.schedule_order_reminders(),marketplace_private.run_transaction_due_work(),public.marketplace_run_transaction_due_work()
from public,anon,authenticated,service_role;
grant execute on function public.marketplace_run_transaction_due_work() to service_role;
commit;

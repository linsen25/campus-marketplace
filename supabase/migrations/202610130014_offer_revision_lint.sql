-- Additive qualification fix: PL/pgSQL name resolution and clock volatility.
begin;
create or replace function marketplace_private.run_transaction_due_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare row record;o public.orders;r marketplace_private.notification_reminders;eligible boolean;eid uuid;t timestamptz;processed integer:=0;
begin
-- Prevent overlapping scheduler scans, while domain locks serialize caller races.
if not pg_try_advisory_xact_lock(hashtextextended('marketplace_v2_due_work',0)) then return jsonb_build_object('overlapSkipped',true);end if;
for row in select c.id from public.conversations c where exists(select 1 from public.order_requests proposal where proposal.conversation_id=c.id and proposal.protocol_version=2 and proposal.status='active' and proposal.offer_terms->>'fulfillment'='on_campus' and (proposal.offer_terms->>'scheduled_at')::timestamptz<=clock_timestamp()) order by c.listing_id,c.id loop
 perform marketplace_private.expire_conversation_offers(row.id);
end loop;
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

alter function public.marketplace_listing_offer_context(uuid) volatile;
alter function marketplace_private.offer_accept_eligibility(public.order_requests) volatile;
commit;

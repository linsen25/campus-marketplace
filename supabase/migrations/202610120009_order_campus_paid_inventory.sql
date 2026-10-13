-- D2A: preserve V1 finalized-money invariant and admit receipt-guarded V2 campus Paid.
-- 008 remains immutable. No existing data updates, handoff, Protection or payout.
begin;
alter table public.orders drop constraint orders_paid_inventory_check;
alter table public.orders add constraint orders_paid_inventory_check check(
 payment_status<>'paid' or (lifecycle_status='open' and holds_listing and (
  (order_protocol_version=1 and money_status='finalized') or
  (order_protocol_version=2 and terms_snapshot->'terms'->>'fulfillment'='on_campus'
   and money_status='v2_pending')
 ))
);
commit;

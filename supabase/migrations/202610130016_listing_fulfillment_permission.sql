-- Seller-editable preference; retain existing verified owner RLS and state guard.
begin;
grant update(preferred_fulfillment) on public.listings to authenticated;
commit;

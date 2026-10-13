-- Explicit preference on creation; existing verified seller/default identity RLS remains.
begin;
grant insert(preferred_fulfillment) on public.listings to authenticated;
commit;

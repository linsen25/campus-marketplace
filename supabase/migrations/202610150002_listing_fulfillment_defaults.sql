-- Staging only. Listing defaults are never accepted Offer/Order economic authority.
begin;
alter table public.listings
  add column estimated_delivery_fee_cents bigint not null default 0
    check (estimated_delivery_fee_cents between 0 and 9007199254740991),
  alter column pickup_area drop not null;
-- Preserve search behavior when the legacy, no-longer-user-facing field is NULL.
-- Existing non-NULL historical values produce exactly the same search text.
alter table public.listings alter column search_text set expression as
  (title || ' ' || description || ' ' || coalesce(pickup_area,'') || ' ' || category || ' ' || subcategory);
grant insert(estimated_delivery_fee_cents),update(estimated_delivery_fee_cents) on public.listings to authenticated;
create function marketplace_private.protect_listing_delivery_estimate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.estimated_delivery_fee_cents is distinct from old.estimated_delivery_fee_cents
    and old.status<>'available' then
    raise exception 'Only available Listing delivery estimates may change.' using errcode='23514';
  end if;
  return new;
end;$$;
revoke all on function marketplace_private.protect_listing_delivery_estimate() from public,anon,authenticated,service_role;
create trigger listings_delivery_estimate_guard before update of estimated_delivery_fee_cents on public.listings
for each row execute function marketplace_private.protect_listing_delivery_estimate();
commit;

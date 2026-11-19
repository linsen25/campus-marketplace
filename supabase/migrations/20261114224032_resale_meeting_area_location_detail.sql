-- Resale Create flow: retain the legacy fulfillment values while storing the
-- independently chosen Meeting area and optional free-text location detail.
-- This migration does not configure campus places or contact an external API.
begin;

do $$
begin
  if to_regclass('public.listings') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.listings'::regclass
         and attname in ('preferred_fulfillment','meeting_location','meeting_location_provider','meeting_place_id')
         and not attisdropped
       group by attrelid having count(*) = 4
     ) then
    raise exception 'Listing meeting baseline is missing.' using errcode = '55000';
  end if;
end;
$$;

alter table public.listings
  add column meeting_area text,
  add column meeting_location_detail text;

alter table public.listings
  add constraint listings_meeting_area_check
    check (meeting_area is null or meeting_area in ('ON_CAMPUS','OTHER')),
  add constraint listings_meeting_location_detail_check
    check (
      meeting_location_detail is null
      or (
        char_length(meeting_location_detail) between 1 and 500
        and meeting_location_detail = btrim(meeting_location_detail)
      )
    );

grant insert(meeting_area, meeting_location_detail),
      update(meeting_area, meeting_location_detail)
  on public.listings to authenticated;

create or replace function marketplace_private.protect_listing_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.meeting_location,
    old.meeting_location_provider,
    old.meeting_place_id,
    old.meeting_area,
    old.meeting_location_detail
  ) is distinct from row(
    new.meeting_location,
    new.meeting_location_provider,
    new.meeting_place_id,
    new.meeting_area,
    new.meeting_location_detail
  ) and old.status <> 'available' then
    raise exception 'Only available Listing Meeting defaults may change.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function marketplace_private.protect_listing_meeting() from public, anon, authenticated, service_role;

drop trigger listings_meeting_guard on public.listings;
create trigger listings_meeting_guard
  before update of meeting_location, meeting_location_provider, meeting_place_id, meeting_area, meeting_location_detail
  on public.listings
  for each row execute function marketplace_private.protect_listing_meeting();

create function marketplace_private.enforce_resale_listing_meeting_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Shop publication has its own authority and is deliberately untouched.
  if new.listing_channel <> 'resale' then return new; end if;

  if new.preferred_fulfillment = 'DELIVERY' then
    if new.meeting_area is not null
       or new.meeting_location is not null
       or new.meeting_location_provider is not null
       or new.meeting_place_id is not null
       or new.meeting_location_detail is not null then
      raise exception 'Delivery listings cannot include Meeting location data.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.preferred_fulfillment <> 'ON_CAMPUS'
     or new.meeting_area not in ('ON_CAMPUS','OTHER')
     or new.meeting_location is null
     or new.meeting_location_provider <> 'google'
     or not marketplace_private.valid_meeting_reference(new.meeting_location_provider, new.meeting_place_id) then
    raise exception 'A verified Google Place and Meeting area are required.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function marketplace_private.enforce_resale_listing_meeting_contract() from public, anon, authenticated, service_role;

create trigger listings_resale_meeting_contract
  before insert or update of preferred_fulfillment, meeting_area, meeting_location, meeting_location_provider, meeting_place_id, meeting_location_detail
  on public.listings
  for each row execute function marketplace_private.enforce_resale_listing_meeting_contract();

commit;

-- Staging-only Meeting defaults and optional V2 references. No enum/lifecycle/economics changes.
-- User-authored labels only; no Google response content, tokens or coordinates.
begin;
create function marketplace_private.valid_meeting_reference(provider text, place_id text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce((provider is null and place_id is null) or (provider='google' and char_length(place_id) between 6 and 256 and place_id ~ '^[A-Za-z0-9_-]+$'),false);
$$;
revoke all on function marketplace_private.valid_meeting_reference(text,text) from public,anon,authenticated,service_role;
alter table public.listings
 add column meeting_location text,
 add column meeting_location_provider text,
 add column meeting_place_id text;
alter table public.listings add constraint listings_meeting_location_check check (
 (meeting_location is null and meeting_location_provider is null and meeting_place_id is null) or
 (meeting_location is not null and char_length(meeting_location) between 1 and 120 and meeting_location=btrim(meeting_location)
 and marketplace_private.valid_meeting_reference(meeting_location_provider,meeting_place_id))
);
-- Constraint helpers require execute for direct Listing writes; no table/read privileges granted.
grant execute on function marketplace_private.valid_meeting_reference(text,text) to authenticated;
grant insert(meeting_location,meeting_location_provider,meeting_place_id),update(meeting_location,meeting_location_provider,meeting_place_id) on public.listings to authenticated;
create function marketplace_private.protect_listing_meeting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if row(old.meeting_location,old.meeting_location_provider,old.meeting_place_id) is distinct from row(new.meeting_location,new.meeting_location_provider,new.meeting_place_id)
 and old.status<>'available' then raise exception 'Only available Listing Meeting defaults may change.' using errcode='23514';end if;
 return new;
end;$$;
revoke all on function marketplace_private.protect_listing_meeting() from public,anon,authenticated,service_role;
create trigger listings_meeting_guard before update of meeting_location,meeting_location_provider,meeting_place_id on public.listings for each row execute function marketplace_private.protect_listing_meeting();
create or replace function marketplace_private.validate_offer_terms(v jsonb, at_time timestamptz default null) returns boolean
language plpgsql immutable set search_path='' as $$
declare amount numeric; fee numeric; scheduled timestamptz; local_time timestamp; keys text[];
begin
 if v is null or jsonb_typeof(v)<>'object' then raise exception 'Offer terms required.' using errcode='23514';end if;
 keys:=array['item_amount_cents','fulfillment','note'];
 if v->>'fulfillment'='on_campus' then keys:=keys||array['meetup_location','scheduled_at','meetup_location_provider','meetup_place_id'];
 elsif v->>'fulfillment'='delivery' then keys:=keys||array['delivery_fee_cents','delivery_method','delivery_area'];
 else raise exception 'Choose Meeting or Delivery.' using errcode='23514';end if;
 if (v-keys)<>'{}'::jsonb or jsonb_typeof(v->'item_amount_cents') is distinct from 'number'
 or (v ? 'note' and jsonb_typeof(v->'note') is distinct from 'string') then raise exception 'Unexpected Offer terms.' using errcode='23514';end if;
 amount:=(v->>'item_amount_cents')::numeric;
 if amount<>trunc(amount) or amount<1 or amount>9007199254740991 or char_length(coalesce(v->>'note',''))>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 if v->>'fulfillment'='on_campus' then
 if not marketplace_private.valid_meeting_reference(v->>'meetup_location_provider',v->>'meetup_place_id')
 or (v ? 'meetup_location_provider' and jsonb_typeof(v->'meetup_location_provider') not in ('null','string'))
 or (v ? 'meetup_place_id' and jsonb_typeof(v->'meetup_place_id') not in ('null','string')) then
 raise exception 'Invalid Meeting reference.' using errcode='23514';end if;
 if jsonb_typeof(v->'meetup_location') is distinct from 'string' or char_length(btrim(v->>'meetup_location')) not between 1 and 120
 or jsonb_typeof(v->'scheduled_at') is distinct from 'string' or (v->>'scheduled_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Meetup location and zoned time required.' using errcode='23514';end if;
 scheduled:=(v->>'scheduled_at')::timestamptz;local_time:=scheduled at time zone 'America/Toronto';
 if not isfinite(scheduled) or extract(minute from local_time)::integer%15<>0 or extract(second from local_time)<>0
 or(at_time is not null and (scheduled<at_time+interval '60 minutes' or scheduled>((at_time at time zone 'America/Toronto')+interval '30 days') at time zone 'America/Toronto')) then raise exception 'Choose a 15-minute time 60 minutes to 30 days ahead.' using errcode='23514';end if;
 else
 if jsonb_typeof(v->'delivery_fee_cents') is distinct from 'number' or v->>'delivery_method' is null or v->>'delivery_method' not in('seller_delivery','courier') then raise exception 'Delivery fee and method required.' using errcode='23514';end if;
 perform marketplace_private.normalize_delivery_area(v->'delivery_area');
 fee:=(v->>'delivery_fee_cents')::numeric;
 if fee<>trunc(fee) or fee<0 or fee>9007199254740991 or fee+amount>9007199254740991 then raise exception 'Invalid Delivery fee.' using errcode='23514';end if;
 end if;
 return true;
end;$$;

create or replace function marketplace_private.offer_changed_fields(current_terms jsonb,baseline jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(label order by position),'[]'::jsonb) from (values
 (1,'Price',current_terms->'item_amount_cents' is distinct from baseline->'item_amount_cents'),
 (2,'Fulfillment',current_terms->'fulfillment' is distinct from baseline->'fulfillment'),
 (3,'Meeting location',lower(regexp_replace(btrim(coalesce(current_terms->>'meetup_location','')),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(coalesce(baseline->>'meetup_location','')),'[[:space:]]+',' ','g'))),
 (4,'Meetup time',current_terms->'scheduled_at' is distinct from baseline->'scheduled_at'),
 (5,'Delivery method',current_terms->'delivery_method' is distinct from baseline->'delivery_method'),
 (6,'Delivery fee',current_terms->'delivery_fee_cents' is distinct from baseline->'delivery_fee_cents'),
 (7,'Delivery area',current_terms->'delivery_area' is distinct from baseline->'delivery_area'),
 (8,'Note',coalesce(current_terms->>'note','') is distinct from coalesce(baseline->>'note',''))
 ) d(position,label,changed) where changed;
$$;
commit;

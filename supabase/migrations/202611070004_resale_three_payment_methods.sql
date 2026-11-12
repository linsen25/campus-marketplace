-- B32: explicit offline Resale payment methods. Legacy `external` remains
-- accepted and is treated as the historical offline path.
begin;
alter table public.listings drop constraint if exists listings_preferred_payment_mode_check;
alter table public.listings drop constraint if exists listings_delivery_payment_mode;
alter table public.listings alter column preferred_payment_mode set default 'in_person';
alter table public.listings add constraint listings_preferred_payment_mode_check
  check (preferred_payment_mode in ('uu_pay','external','in_person','interac_etransfer'));
alter table public.listings add constraint listings_delivery_payment_mode
  check (preferred_fulfillment='ON_CAMPUS' or preferred_payment_mode='uu_pay');

create or replace function marketplace_private.payment_mode(v jsonb)
returns text language sql immutable set search_path='' as $$
  select case when coalesce(v->>'payment_mode','uu_pay') in
    ('external','in_person','interac_etransfer') then 'external'
    else 'uu_pay' end;
$$;

-- Meeting references are optional suggestions. Western building codes are
-- public directory identifiers; custom locations continue to use Google refs.
create or replace function marketplace_private.valid_meeting_reference(provider text, place_id text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce((provider is null and place_id is null)
      or (provider = 'google' and place_id ~ '^[A-Za-z0-9_-]{6,256}$')
      or (provider = 'western' and place_id = any(array[
        'UCC','WL','NSC','SSC','UC','MC','PAB','WSRC','WSSB','WSC','AH','SEB','IVEY','CC'
      ])), false);
$$;

create or replace function marketplace_private.validate_offer_terms(v jsonb, at_time timestamptz default null)
returns boolean language plpgsql immutable set search_path='' as $$
declare amount numeric; fee numeric; scheduled timestamptz; local_time timestamp; keys text[];
begin
 if v is null or jsonb_typeof(v)<>'object' then raise exception 'Offer terms required.' using errcode='23514';end if;
 if (v ? 'payment_mode') <> (v ? 'payment_mode_version')
 or (v ? 'payment_mode' and (jsonb_typeof(v->'payment_mode') is distinct from 'string'
 or v->>'payment_mode' not in('uu_pay','external','in_person','interac_etransfer')
 or v->'payment_mode_version' is distinct from '1'::jsonb))
 or (marketplace_private.payment_mode(v)='external' and v->>'fulfillment' is distinct from 'on_campus') then
 raise exception 'Invalid versioned payment mode.' using errcode='23514';end if;
 keys:=array['item_amount_cents','fulfillment','note','payment_mode','payment_mode_version'];
 if v->>'fulfillment'='on_campus' then keys:=keys||array['meetup_location','scheduled_at','meetup_location_provider','meetup_place_id'];
 elsif v->>'fulfillment'='delivery' then keys:=keys||array['delivery_fee_cents','delivery_method','delivery_area'];
 else raise exception 'Choose Meeting or Delivery.' using errcode='23514';end if;
 if (v-keys)<>'{}'::jsonb or jsonb_typeof(v->'item_amount_cents') is distinct from 'number'
 or (v ? 'note' and jsonb_typeof(v->'note') is distinct from 'string') then raise exception 'Unexpected Offer terms.' using errcode='23514';end if;
 amount:=(v->>'item_amount_cents')::numeric;
 if amount<>trunc(amount) or amount<1 or amount>9007199254740991 or char_length(coalesce(v->>'note',''))>1000 then raise exception 'Invalid Offer amount/note.' using errcode='23514';end if;
 if v->>'fulfillment'='on_campus' then
  if (v ? 'meetup_location_provider' and v->>'meetup_location_provider' is not null and not (v ? 'meetup_place_id'))
  or (v ? 'meetup_place_id' and v->>'meetup_place_id' is not null and not (v ? 'meetup_location_provider'))
  or not marketplace_private.valid_meeting_reference(v->>'meetup_location_provider',v->>'meetup_place_id')
  or (v ? 'meetup_location_provider' and jsonb_typeof(v->'meetup_location_provider') not in ('null','string'))
  or (v ? 'meetup_place_id' and jsonb_typeof(v->'meetup_place_id') not in ('null','string')) then
   raise exception 'Invalid Meeting reference.' using errcode='23514';end if;
  if (v ? 'meetup_location' and (jsonb_typeof(v->'meetup_location') is distinct from 'string' or char_length(btrim(v->>'meetup_location')) not between 1 and 120))
  or ((v ? 'meetup_location_provider' or v ? 'meetup_place_id') and not (v ? 'meetup_location'))
  or jsonb_typeof(v->'scheduled_at') is distinct from 'string' or (v->>'scheduled_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Invalid optional meeting location or zoned time.' using errcode='23514';end if;
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

create or replace function marketplace_private.offer_changed_fields(current_terms jsonb,baseline jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(label order by position),'[]'::jsonb) from (values
 (1,'Price',current_terms->'item_amount_cents' is distinct from baseline->'item_amount_cents'),
 (2,'Fulfillment',current_terms->'fulfillment' is distinct from baseline->'fulfillment'),
 (3,'Meeting location',lower(regexp_replace(btrim(coalesce(current_terms->>'meetup_location','')),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(coalesce(baseline->>'meetup_location','')),'[[:space:]]+',' ','g'))),
 (4,'Meetup time',current_terms->'scheduled_at' is distinct from baseline->'scheduled_at'),
 (5,'Delivery method',current_terms->'delivery_method' is distinct from baseline->'delivery_method'),
 (6,'Delivery fee',current_terms->'delivery_fee_cents' is distinct from baseline->'delivery_fee_cents'),
 (7,'Delivery area',current_terms->'delivery_area' is distinct from baseline->'delivery_area'),
 (9,'Payment method',coalesce(current_terms->>'payment_mode','uu_pay') is distinct from coalesce(baseline->>'payment_mode','uu_pay')),
 (8,'Note',coalesce(current_terms->>'note','') is distinct from coalesce(baseline->>'note',''))
 ) d(position,label,changed) where changed;
$$;

do $$declare expr text;
begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_v2_foundation';
 if expr is not null then
  execute 'alter table public.orders drop constraint orders_v2_foundation';
  execute 'alter table public.orders add constraint orders_v2_foundation check(('||expr||') or(order_protocol_version=2 and terms_schema_version=2 and terms_snapshot->''terms''->>''payment_mode'' in (''external'',''in_person'',''interac_etransfer'') and terms_snapshot->''terms''->>''fulfillment''=''on_campus'' and lifecycle_status=''completed'' and not holds_listing and payment_status=''pending'' and payment_paid_at is null and payout_status=''not_eligible'' and fulfillment_status=''fulfilled'' and money_status=''v2_pending'' and service_fee_rule_version=''not_finalized_v2'' and service_fee_amount_cents is null and total_amount_cents is null and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null and expired_at is null and cancelled_at is null and reservation_ended_at is not null))';
 end if;
end$$;
commit;

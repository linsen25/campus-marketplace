begin;

-- Immutable ownership/time facts survive deletion of the source Listing.
create table marketplace_private.account_activity_events (
 id uuid primary key default gen_random_uuid(),
 identity text not null unique,
 kind text not null check(kind in('view','listing_published','listing_sold')),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 listing_origin_id uuid not null,
 viewer_id uuid references auth.users(id) on delete set null,
 occurred_at timestamptz not null default clock_timestamp(),
 check(kind='view' or viewer_id is null)
);
create index account_activity_owner_time on marketplace_private.account_activity_events(owner_id,occurred_at,kind);
alter table marketplace_private.account_activity_events enable row level security;
revoke all on marketplace_private.account_activity_events from public,anon,authenticated,service_role;

create function marketplace_private.capture_listing_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.published_at is not null and (tg_op='INSERT' or old.published_at is null) then
  insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id,occurred_at)
  values(new.id::text||':published','listing_published',new.seller_id,new.id,new.published_at)
  on conflict(identity) do nothing;
 end if;
 if new.status='sold' and (tg_op='INSERT' or old.status is distinct from 'sold') then
  insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id)
  values(new.id::text||':sold','listing_sold',new.seller_id,new.id)
  on conflict(identity) do nothing;
 end if;
 return new;
end;$$;
create trigger listings_capture_activity after insert or update on public.listings
for each row execute function marketplace_private.capture_listing_activity();
revoke all on function marketplace_private.capture_listing_activity() from public,anon,authenticated,service_role;

-- Only known historical facts are backfilled; never infer Sold time from updated_at.
insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id,occurred_at)
select id::text||':published','listing_published',seller_id,id,published_at
from public.listings where published_at is not null on conflict(identity) do nothing;
insert into marketplace_private.account_activity_events(identity,kind,owner_id,listing_origin_id,occurred_at)
select distinct on(o.listing_origin_id) o.listing_origin_id::text||':sold','listing_sold',o.seller_origin_id,o.listing_origin_id,e.created_at
from public.transaction_events e join public.orders o on o.id=e.order_id
join public.profiles p on p.id=o.seller_origin_id
where e.event_type='order_completed' and o.lifecycle_status='completed'
order by o.listing_origin_id,e.created_at on conflict(identity) do nothing;

create function public.marketplace_record_listing_view(p_listing_id uuid,p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.listings;e marketplace_private.account_activity_events;actor uuid:=auth.uid();
begin
 if p_listing_id is null or p_event_id is null then raise exception 'Invalid view.' using errcode='23514';end if;
 -- Serializes duplicate delivery without turning a deliberate reopen into a duplicate.
 perform pg_advisory_xact_lock(hashtextextended('listing-view:'||p_event_id::text,0));
 select * into e from marketplace_private.account_activity_events where id=p_event_id;
 if found then
  if e.kind<>'view' or e.listing_origin_id<>p_listing_id or e.viewer_id is distinct from actor then
   raise exception 'View command conflict.' using errcode='23514';end if;
  return jsonb_build_object('recorded',true);
 end if;
 select * into l from public.listings where id=p_listing_id for share;
 if not found or l.published_at is null or l.status<>'available' or l.seller_id=actor then
  return jsonb_build_object('recorded',false);
 end if;
 insert into marketplace_private.account_activity_events(id,identity,kind,owner_id,listing_origin_id,viewer_id)
 values(p_event_id,'view:'||p_event_id::text,'view',l.seller_id,l.id,actor);
 return jsonb_build_object('recorded',true);
end;$$;
revoke all on function public.marketplace_record_listing_view(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_record_listing_view(uuid,uuid) to anon,authenticated;

-- Private anchor allows deterministic timezone/DST qualification, not client clocks.
create function marketplace_private.account_activity_buckets(p_period text,p_now timestamptz)
returns table(bucket_at timestamptz,bucket_end timestamptz,bucket_label text)
language plpgsql stable set search_path='' as $$
declare days integer;hour_start timestamptz;
begin
 if p_period='1D' then
  -- Subtract local minute/second components on the absolute timeline, preserving
  -- the current occurrence of an ambiguous fall-back hour.
  hour_start:=p_now-extract(minute from p_now at time zone 'America/Toronto')*interval '1 minute'
    -extract(second from p_now at time zone 'America/Toronto')*interval '1 second';
  return query select d,d+interval '1 hour',to_char(d at time zone 'America/Toronto','HH24:MI')||' UTC'||
    case when offset_seconds<0 then '-' else '+' end||lpad((abs(offset_seconds)/3600)::integer::text,2,'0')||':'||lpad(((abs(offset_seconds)%3600)/60)::integer::text,2,'0')
  from(select d,extract(epoch from((d at time zone 'America/Toronto')-(d at time zone 'UTC')))::integer offset_seconds
    from generate_series(hour_start-interval '23 hours',hour_start,interval '1 hour') d) hours;
  return;
 end if;
 if p_period not in('7D','30D') or p_period is null then raise exception 'Unsupported activity period.' using errcode='23514';end if;
 days:=case when p_period='7D' then 7 else 30 end;
 return query select d at time zone 'America/Toronto',(d+interval '1 day') at time zone 'America/Toronto',to_char(d,'Mon DD')
 from generate_series(date_trunc('day',p_now at time zone 'America/Toronto')-make_interval(days=>days-1),
 date_trunc('day',p_now at time zone 'America/Toronto'),interval '1 day') d;
end;$$;
revoke all on function marketplace_private.account_activity_buckets(text,timestamptz) from public,anon,authenticated,service_role;

create function public.marketplace_account_activity(p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();points jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('timestamp',to_char(bucket_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'label',bucket_label,'views',views,'listings',listings,'sold',sold,'overall',views+listings+sold) order by bucket_at) into points
 from(select b.bucket_at,b.bucket_label,count(e.id) filter(where e.kind='view') views,
 count(e.id) filter(where e.kind='listing_published') listings,count(e.id) filter(where e.kind='listing_sold') sold
 from marketplace_private.account_activity_buckets(p_period,statement_timestamp()) b
 left join marketplace_private.account_activity_events e on e.owner_id=actor and e.occurred_at>=b.bucket_at and e.occurred_at<b.bucket_end
 group by b.bucket_at,b.bucket_label) grouped;
 return jsonb_build_object('period',p_period,'points',points);
end;$$;
revoke all on function public.marketplace_account_activity(text) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_account_activity(text) to authenticated;

commit;

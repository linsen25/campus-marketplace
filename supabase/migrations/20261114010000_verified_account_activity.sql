-- Open-registration compatibility for the existing private Activity facts.
-- Keeps the same owner, visibility, bucketing and idempotency rules; only the
-- historical Western-only identity gate becomes the canonical verified-user gate.
begin;

do $$
declare activity_definition text; view_definition text;
begin
  if to_regprocedure('public.marketplace_account_activity(text)') is null
     or to_regprocedure('public.marketplace_record_listing_view(uuid,uuid)') is null then
    raise exception 'Reviewed account-activity functions are absent.' using errcode='P0001';
  end if;
  select pg_get_functiondef('public.marketplace_account_activity(text)'::regprocedure)
    into activity_definition;
  select pg_get_functiondef('public.marketplace_record_listing_view(uuid,uuid)'::regprocedure)
    into view_definition;
  if position('is_western_user' in activity_definition) = 0
     or position('is_western_user' in view_definition) = 0 then
    raise exception 'Account-activity baseline is not the reviewed Western-gated version.' using errcode='P0001';
  end if;
end;
$$;

create or replace function public.marketplace_account_activity(p_period text)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); points jsonb;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(), false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  select jsonb_agg(jsonb_build_object(
    'timestamp',to_char(bucket_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'label',bucket_label,
    'views',views,
    'listings',listings,
    'sold',sold,
    'overall',views+listings+sold
  ) order by bucket_at) into points
  from (
    select b.bucket_at,b.bucket_label,
      count(e.id) filter(where e.kind='view') views,
      count(e.id) filter(where e.kind='listing_published') listings,
      count(e.id) filter(where e.kind='listing_sold') sold
    from marketplace_private.account_activity_buckets(p_period,statement_timestamp()) b
    left join marketplace_private.account_activity_events e
      on e.owner_id=actor and e.occurred_at>=b.bucket_at and e.occurred_at<b.bucket_end
    group by b.bucket_at,b.bucket_label
  ) grouped;
  return jsonb_build_object('period',p_period,'points',points);
end;
$$;

create or replace function public.marketplace_record_listing_view(
  p_listing_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare l public.listings; e marketplace_private.account_activity_events; actor uuid:=auth.uid();
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(), false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  if p_listing_id is null or p_event_id is null then
    raise exception 'Invalid view.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('listing-view:'||p_event_id::text,0));
  select * into e from marketplace_private.account_activity_events where id=p_event_id;
  if found then
    if e.kind<>'view' or e.listing_origin_id is distinct from p_listing_id
       or e.viewer_id is distinct from actor then
      raise exception 'View command conflict.' using errcode='23514';
    end if;
    return jsonb_build_object('recorded',true);
  end if;
  select * into l from public.listings where id=p_listing_id for share;
  if not found or l.published_at is null or l.status<>'available' or l.seller_id=actor then
    return jsonb_build_object('recorded',false);
  end if;
  if l.listing_channel='shop'
     and marketplace_private.public_shop_eligibility(l.seller_id) is null then
    return jsonb_build_object('recorded',false);
  end if;
  insert into marketplace_private.account_activity_events(
    id,identity,kind,owner_id,listing_origin_id,viewer_id
  ) values(
    p_event_id,'view:'||p_event_id::text,'view',l.seller_id,l.id,actor
  );
  return jsonb_build_object('recorded',true);
end;
$$;

revoke all on function public.marketplace_account_activity(text)
  from public,anon,authenticated,service_role;
revoke all on function public.marketplace_record_listing_view(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_account_activity(text) to authenticated;
grant execute on function public.marketplace_record_listing_view(uuid,uuid) to authenticated;

commit;

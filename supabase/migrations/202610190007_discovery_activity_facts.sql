-- B17: authenticated intentional activity and source facts only. No historical backfill.
begin;

alter table marketplace_private.account_activity_events
 alter column listing_origin_id drop not null,
 add column listing_channel_snapshot text check(listing_channel_snapshot in('resale','shop')),
 add column shop_origin_id uuid,
 drop constraint account_activity_events_kind_check,
 drop constraint account_activity_events_check,
 add constraint account_activity_events_kind_check check(kind in('view','shop_view','listing_published','listing_sold')),
 add constraint account_activity_events_viewer_check check(kind in('view','shop_view') or viewer_id is null),
 add constraint account_activity_events_subject_check check(
  (kind='shop_view' and listing_origin_id is null and listing_channel_snapshot='shop' and shop_origin_id is not null)
  or(kind<>'shop_view' and listing_origin_id is not null)),
 add constraint account_activity_events_resale_check check(listing_channel_snapshot is distinct from 'resale' or shop_origin_id is null);

-- Only new INSERTs are attributed. Legacy NULLs and Auth FK cleanup are preserved.
create function marketplace_private.attribute_activity_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare l public.listings; s public.shops;
begin
 if new.kind='shop_view' then
  select * into s from public.shops where id=new.shop_origin_id;
  if not found or new.owner_id is distinct from s.owner_id or new.listing_origin_id is not null then
   raise exception 'Invalid activity source.' using errcode='23514';end if;
  if new.listing_channel_snapshot is not null and new.listing_channel_snapshot<>'shop' then
   raise exception 'Invalid activity channel.' using errcode='23514';end if;
  new.listing_channel_snapshot:='shop';
 else
  select * into l from public.listings where id=new.listing_origin_id;
  if not found or new.owner_id is distinct from l.seller_id then
   raise exception 'Invalid activity source.' using errcode='23514';end if;
  if new.listing_channel_snapshot is not null and new.listing_channel_snapshot<>l.listing_channel then
   raise exception 'Invalid activity channel.' using errcode='23514';end if;
  new.listing_channel_snapshot:=l.listing_channel;
  if l.listing_channel='shop' then select * into s from public.shops where owner_id=l.seller_id;end if;
  if new.shop_origin_id is not null and new.shop_origin_id is distinct from s.id then
   raise exception 'Invalid activity Shop.' using errcode='23514';end if;
  new.shop_origin_id:=s.id;
 end if;
 return new;
end;$$;
revoke all on function marketplace_private.attribute_activity_source() from public,anon,authenticated,service_role;
create trigger account_activity_attribute_source before insert on marketplace_private.account_activity_events
for each row execute function marketplace_private.attribute_activity_source();

create or replace function public.marketplace_record_listing_view(p_listing_id uuid,p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.listings; e marketplace_private.account_activity_events; actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 if p_listing_id is null or p_event_id is null then raise exception 'Invalid view.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('listing-view:'||p_event_id::text,0));
 select * into e from marketplace_private.account_activity_events where id=p_event_id;
 if found then
  if e.kind<>'view' or e.listing_origin_id is distinct from p_listing_id or e.viewer_id is distinct from actor then
   raise exception 'View command conflict.' using errcode='23514';end if;
  return jsonb_build_object('recorded',true);
 end if;
 select * into l from public.listings where id=p_listing_id for share;
 if not found or l.published_at is null or l.status<>'available' or l.seller_id=actor then
  return jsonb_build_object('recorded',false);end if;
 if l.listing_channel='shop' and marketplace_private.public_shop_eligibility(l.seller_id) is null then
  return jsonb_build_object('recorded',false);end if;
 insert into marketplace_private.account_activity_events(id,identity,kind,owner_id,listing_origin_id,viewer_id)
 values(p_event_id,'view:'||p_event_id::text,'view',l.seller_id,l.id,actor);
 return jsonb_build_object('recorded',true);
end;$$;
revoke all on function public.marketplace_record_listing_view(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_record_listing_view(uuid,uuid) to authenticated;

create function public.marketplace_record_shop_view(p_shop_id uuid,p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.shops; e marketplace_private.account_activity_events; actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 if p_shop_id is null or p_event_id is null then raise exception 'Invalid view.' using errcode='23514';end if;
 -- Share the existing event lock namespace: UUID reuse across source kinds conflicts.
 perform pg_advisory_xact_lock(hashtextextended('listing-view:'||p_event_id::text,0));
 select * into e from marketplace_private.account_activity_events where id=p_event_id;
 if found then
  if e.kind<>'shop_view' or e.shop_origin_id is distinct from p_shop_id or e.viewer_id is distinct from actor then
   raise exception 'View command conflict.' using errcode='23514';end if;
  return jsonb_build_object('recorded',true);
 end if;
 select * into s from public.shops where id=p_shop_id for key share;
 if not found or s.owner_id=actor then return jsonb_build_object('recorded',false);end if;
 if marketplace_private.public_shop_eligibility(s.owner_id) is null then return jsonb_build_object('recorded',false);end if;
 insert into marketplace_private.account_activity_events(id,identity,kind,owner_id,shop_origin_id,viewer_id)
 values(p_event_id,'view:'||p_event_id::text,'shop_view',s.owner_id,s.id,actor);
 return jsonb_build_object('recorded',true);
end;$$;
revoke all on function public.marketplace_record_shop_view(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_record_shop_view(uuid,uuid) to authenticated;

-- Source projection, NOT a sales/revenue aggregate or public API. One row per Order.
-- Unknown historic Shop identity/cost remains NULL, never inferred from today's Shop.
create function marketplace_private.completed_order_facts(p_owner uuid,p_from timestamptz,p_until timestamptz)
returns table(order_id uuid,listing_origin_id uuid,seller_origin_id uuid,listing_channel text,
 shop_origin_id uuid,completed_at timestamptz,payment_mode text,payment_status text,currency text,
 unit_cost_cents bigint,sale_eligible boolean)
language plpgsql stable set search_path='' as $$
begin
 if p_owner is null or p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
  or p_until<=p_from or p_until-p_from>interval '366 days' then
  raise exception 'Invalid fact range.' using errcode='23514';end if;
 return query select o.id,o.listing_origin_id,o.seller_origin_id,
  case when o.listing_snapshot->>'listingChannel' in('resale','shop') then o.listing_snapshot->>'listingChannel' else null end,
  null::uuid,o.reservation_ended_at,marketplace_private.payment_mode(o.terms_snapshot->'terms'),o.payment_status,
  o.listing_snapshot->>'currency',null::bigint,
  case when marketplace_private.payment_mode(o.terms_snapshot->'terms')='external' then
    o.payment_status<>'refunded' and exists(select 1 from marketplace_private.external_exchanges x where x.order_id=o.id
     and x.buyer_confirmed_at is not null and x.seller_confirmed_at is not null and x.disputed_at is null)
   else o.payment_status='paid' and exists(select 1 from marketplace_private.order_protection x where x.order_id=o.id and x.completed_at=o.reservation_ended_at)
  end
 from public.orders o
 where o.seller_origin_id=p_owner and o.lifecycle_status='completed'
  and o.reservation_ended_at>=p_from and o.reservation_ended_at<p_until
  and exists(select 1 from public.transaction_events e where e.order_id=o.id
   and e.event_type='order_completed' and e.created_at=o.reservation_ended_at);
end;$$;
revoke all on function marketplace_private.completed_order_facts(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
commit;

begin;

-- R1 deliberately records only authoritative order-derived facts.  Public
-- callers never receive a write grant to either private table.
do $preflight$
begin
  if to_regprocedure('marketplace_private.is_verified_user()') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.transaction_events') is null
     or to_regclass('public.listings') is null
     or to_regclass('public.shops') is null
     or to_regclass('marketplace_private.external_exchanges') is null
     or to_regclass('marketplace_private.protection_cases') is null then
    raise exception 'Review authority prerequisites are not installed.' using errcode='55000';
  end if;
end;
$preflight$;

create function marketplace_private.review_quick_tags_valid(p_tags jsonb)
returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_tags)='array'
    and jsonb_array_length(p_tags) <= 8
    and not exists (
      select 1 from jsonb_array_elements(p_tags) value
      where jsonb_typeof(value) <> 'string'
         or char_length(btrim(value #>> '{}')) not between 1 and 64
    );
$$;

create table marketplace_private.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  subject_type text not null check (subject_type in ('resale_seller','shop','shop_product')),
  shop_id uuid references public.shops(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete restrict,
  rating_units smallint not null check (rating_units between 1 and 10),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  quick_tags jsonb not null default '[]'::jsonb,
  completed_at_snapshot timestamptz not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  moderation_status text not null default 'visible' check (moderation_status in ('visible','hidden','removed')),
  constraint reviews_subject_shape check (
    (subject_type='resale_seller' and shop_id is null and listing_id is null)
    or (subject_type='shop' and shop_id is not null and listing_id is null)
    or (subject_type='shop_product' and shop_id is not null and listing_id is not null)
  ),
  constraint reviews_quick_tags_shape check (marketplace_private.review_quick_tags_valid(quick_tags)),
  unique(order_id,subject_type)
);

create index reviews_buyer_history on marketplace_private.reviews(buyer_id,reviewed_at desc,id);
create index reviews_shop_public on marketplace_private.reviews(shop_id,reviewed_at desc,id)
  where moderation_status='visible';
create index reviews_listing_public on marketplace_private.reviews(listing_id,reviewed_at desc,id)
  where moderation_status='visible';

create table marketplace_private.review_commands (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action_id uuid not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  subject_type text not null check (subject_type in ('resale_seller','shop','shop_product')),
  rating_units smallint not null check (rating_units between 1 and 10),
  comment text,
  quick_tags jsonb not null,
  review_id uuid not null references marketplace_private.reviews(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,action_id)
);

alter table marketplace_private.reviews enable row level security;
alter table marketplace_private.review_commands enable row level security;
revoke all on marketplace_private.reviews, marketplace_private.review_commands
  from public, anon, authenticated, service_role;

create function marketplace_private.review_eligibility_payload(
  p_order_id uuid,
  p_subject_type text,
  p_actor uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders;
  v_completed_at timestamptz;
  v_shop_id uuid;
  v_listing public.listings;
  v_reason text;
begin
  if p_actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    return jsonb_build_object('eligible',false,'reason','verified_account_required','expiresAt',null,'alreadyReviewed',false);
  end if;
  if p_subject_type not in ('resale_seller','shop','shop_product') then
    return jsonb_build_object('eligible',false,'reason','invalid_subject','expiresAt',null,'alreadyReviewed',false);
  end if;

  select * into v_order from public.orders where id=p_order_id;
  if not found then
    return jsonb_build_object('eligible',false,'reason','order_not_found','expiresAt',null,'alreadyReviewed',false);
  end if;
  if v_order.buyer_id is distinct from p_actor then
    return jsonb_build_object('eligible',false,'reason','buyer_required','expiresAt',null,'alreadyReviewed',false);
  end if;
  if v_order.buyer_id is null or v_order.seller_id is null or v_order.buyer_id=v_order.seller_id then
    return jsonb_build_object('eligible',false,'reason','invalid_order_participants','expiresAt',null,'alreadyReviewed',false);
  end if;
  if v_order.lifecycle_status<>'completed' then
    return jsonb_build_object('eligible',false,'reason','order_not_completed','expiresAt',null,'alreadyReviewed',false);
  end if;
  select min(e.created_at) into v_completed_at
    from public.transaction_events e
   where e.order_id=v_order.id and e.event_type='order_completed';
  if v_completed_at is null then
    return jsonb_build_object('eligible',false,'reason','completed_event_required','expiresAt',null,'alreadyReviewed',false);
  end if;
  if v_order.payment_status='refunded' then
    return jsonb_build_object('eligible',false,'reason','order_refunded','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
  end if;
  if exists(select 1 from marketplace_private.external_exchanges x where x.order_id=v_order.id and x.disputed_at is not null)
     or exists(select 1 from marketplace_private.protection_cases c where c.order_id=v_order.id and c.state in ('awaiting_seller','disputed')) then
    return jsonb_build_object('eligible',false,'reason','order_disputed','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
  end if;
  if exists(select 1 from marketplace_private.reviews r where r.order_id=v_order.id and r.subject_type=p_subject_type) then
    return jsonb_build_object('eligible',false,'reason','already_reviewed','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',true);
  end if;
  if clock_timestamp()>v_completed_at + interval '14 days' then
    return jsonb_build_object('eligible',false,'reason','review_window_expired','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
  end if;

  select * into v_listing from public.listings
    where id=v_order.listing_id and seller_id=v_order.seller_id;
  if not found then
    return jsonb_build_object('eligible',false,'reason','order_subject_unavailable','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
  end if;
  if v_listing.listing_channel='resale' and p_subject_type='resale_seller' then
    return jsonb_build_object('eligible',true,'reason',null,'expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false,
      'sellerId',v_order.seller_id,'shopId',null,'listingId',null,'completedAt',v_completed_at);
  end if;
  if v_listing.listing_channel='shop' and p_subject_type in ('shop','shop_product') then
    select s.id into v_shop_id from public.shops s where s.owner_id=v_order.seller_id;
    if v_shop_id is null then
      return jsonb_build_object('eligible',false,'reason','order_subject_unavailable','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
    end if;
    return jsonb_build_object('eligible',true,'reason',null,'expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false,
      'sellerId',v_order.seller_id,'shopId',v_shop_id,
      'listingId',case when p_subject_type='shop_product' then v_order.listing_id else null end,
      'completedAt',v_completed_at);
  end if;
  return jsonb_build_object('eligible',false,'reason','subject_not_available_for_order','expiresAt',v_completed_at + interval '14 days','alreadyReviewed',false);
end;$$;

create function public.marketplace_review_eligibility(p_order_id uuid,p_subject_type text)
returns jsonb language sql security definer set search_path='' as $$
  select marketplace_private.review_eligibility_payload(p_order_id,p_subject_type,auth.uid());
$$;

create function public.marketplace_submit_order_review(
  p_order_id uuid,
  p_subject_type text,
  p_rating_units integer,
  p_comment text,
  p_quick_tags jsonb,
  p_action_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_existing marketplace_private.review_commands;
  v_eligibility jsonb;
  v_review marketplace_private.reviews;
  v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
  if v_actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  if p_action_id is null or p_order_id is null or p_subject_type not in ('resale_seller','shop','shop_product')
     or p_rating_units not between 1 and 10 or p_quick_tags is null
     or jsonb_typeof(p_quick_tags)<>'array' or jsonb_array_length(p_quick_tags)>8
     or (v_comment is not null and char_length(v_comment)>500)
     or exists(select 1 from jsonb_array_elements(p_quick_tags) value where jsonb_typeof(value)<>'string' or char_length(btrim(value #>> '{}')) not between 1 and 64) then
    raise exception 'Invalid review submission.' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_action_id::text,0));
  select * into v_existing from marketplace_private.review_commands
   where actor_id=v_actor and action_id=p_action_id;
  if found then
    if v_existing.order_id is distinct from p_order_id
       or v_existing.subject_type is distinct from p_subject_type
       or v_existing.rating_units is distinct from p_rating_units
       or v_existing.comment is distinct from v_comment
       or v_existing.quick_tags is distinct from p_quick_tags then
      raise exception 'Action ID was already used with different review data.' using errcode='23505';
    end if;
    select * into v_review from marketplace_private.reviews where id=v_existing.review_id;
    return jsonb_build_object('reviewId',v_review.id,'orderId',v_review.order_id,'subjectType',v_review.subject_type,'reviewedAt',v_review.reviewed_at,'idempotent',true);
  end if;

  perform 1 from public.orders where id=p_order_id for update;
  v_eligibility:=marketplace_private.review_eligibility_payload(p_order_id,p_subject_type,v_actor);
  if not coalesce((v_eligibility->>'eligible')::boolean,false) then
    if v_eligibility->>'reason'='already_reviewed' then
      raise exception 'Review was already submitted.' using errcode='23505';
    end if;
    raise exception 'Review is not eligible: %',coalesce(v_eligibility->>'reason','unknown') using errcode='23514';
  end if;

  insert into marketplace_private.reviews(order_id,buyer_id,seller_id,subject_type,shop_id,listing_id,rating_units,comment,quick_tags,completed_at_snapshot)
  values(
    p_order_id,v_actor,(v_eligibility->>'sellerId')::uuid,p_subject_type,
    nullif(v_eligibility->>'shopId','')::uuid,nullif(v_eligibility->>'listingId','')::uuid,
    p_rating_units,v_comment,p_quick_tags,(v_eligibility->>'completedAt')::timestamptz
  ) returning * into v_review;
  insert into marketplace_private.review_commands(actor_id,action_id,order_id,subject_type,rating_units,comment,quick_tags,review_id)
  values(v_actor,p_action_id,p_order_id,p_subject_type,p_rating_units,v_comment,p_quick_tags,v_review.id);
  return jsonb_build_object('reviewId',v_review.id,'orderId',v_review.order_id,'subjectType',v_review.subject_type,'reviewedAt',v_review.reviewed_at,'idempotent',false);
exception when unique_violation then
  raise exception 'Review was already submitted.' using errcode='23505';
end;$$;

revoke all on function marketplace_private.review_quick_tags_valid(jsonb),
  marketplace_private.review_eligibility_payload(uuid,text,uuid),
  public.marketplace_review_eligibility(uuid,text),
  public.marketplace_submit_order_review(uuid,text,integer,text,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_review_eligibility(uuid,text),
  public.marketplace_submit_order_review(uuid,text,integer,text,jsonb,uuid)
  to authenticated;
notify pgrst,'reload schema';

commit;

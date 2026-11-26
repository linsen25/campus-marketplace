begin;

do $preflight$
begin
  if to_regclass('marketplace_private.reviews') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.shops') is null
     or to_regprocedure('marketplace_private.is_verified_user()') is null then
    raise exception 'Rating R1 authority prerequisites are not installed.' using errcode='55000';
  end if;
end;
$preflight$;

create table marketplace_private.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references marketplace_private.reviews(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  reply text not null check (char_length(btrim(reply)) between 1 and 500),
  replied_at timestamptz not null default clock_timestamp()
);

create index review_replies_seller_history
  on marketplace_private.review_replies(seller_id,replied_at desc,id);

alter table marketplace_private.review_replies enable row level security;
revoke all on marketplace_private.review_replies from public, anon, authenticated, service_role;

create function marketplace_private.review_reply_allowed(
  p_review marketplace_private.reviews,
  p_actor uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select p_actor is not null
    and p_review.seller_id=p_actor
    and (
      p_review.subject_type='resale_seller'
      or exists(select 1 from public.shops s where s.id=p_review.shop_id and s.owner_id=p_actor)
    );
$$;

create function public.marketplace_get_order_reviews(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_order public.orders;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  select * into v_order from public.orders where id=p_order_id;
  if not found or actor not in (v_order.buyer_id,v_order.seller_id) then
    raise exception 'Order review not found.' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'reviewId',r.id,'orderId',r.order_id,'subjectType',r.subject_type,
      'ratingUnits',r.rating_units,'comment',r.comment,'quickTags',r.quick_tags,
      'reviewedAt',r.reviewed_at,'completedAt',r.completed_at_snapshot,
      'reply',case when rr.id is null then null else jsonb_build_object('reply',rr.reply,'repliedAt',rr.replied_at) end,
      'canReply',marketplace_private.review_reply_allowed(r,actor)
    ) order by r.reviewed_at desc,r.id desc)
    from marketplace_private.reviews r
    left join marketplace_private.review_replies rr on rr.review_id=r.id
    where r.order_id=v_order.id
  ),'[]'::jsonb);
end;
$$;

create function public.marketplace_get_public_reviews(
  p_subject_type text,p_subject_id uuid,p_limit integer default 10,
  p_before timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,10),50));
begin
  if p_subject_type not in ('resale_seller','shop','shop_product') or p_subject_id is null then
    raise exception 'Invalid review subject.' using errcode='23514';
  end if;
  return coalesce((
    select jsonb_agg(row_payload order by reviewed_at desc,review_id desc)
    from (
      select r.reviewed_at,r.id review_id,jsonb_build_object(
        'reviewId',r.id,'subjectType',r.subject_type,'ratingUnits',r.rating_units,
        'comment',r.comment,'quickTags',r.quick_tags,'reviewedAt',r.reviewed_at,
        'reviewerName',coalesce(p.display_name,'UU member'),
        'reply',case when rr.id is null then null else jsonb_build_object('reply',rr.reply,'repliedAt',rr.replied_at) end
      ) row_payload
      from marketplace_private.reviews r
      join public.profiles p on p.id=r.buyer_id
      left join marketplace_private.review_replies rr on rr.review_id=r.id
      where r.moderation_status='visible'
        and ((p_subject_type='resale_seller' and r.subject_type='resale_seller' and r.seller_id=p_subject_id)
          or (p_subject_type='shop' and r.subject_type='shop' and r.shop_id=p_subject_id)
          or (p_subject_type='shop_product' and r.subject_type='shop_product' and r.listing_id=p_subject_id))
        and (p_before is null or (r.reviewed_at,r.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by r.reviewed_at desc,r.id desc limit v_limit
    ) page
  ),'[]'::jsonb);
end;
$$;

create function public.marketplace_get_review_summary(p_subject_type text,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare units numeric; total integer;
begin
  if p_subject_type not in ('resale_seller','shop','shop_product') or p_subject_id is null then
    raise exception 'Invalid review subject.' using errcode='23514';
  end if;
  select avg(r.rating_units),count(*) into units,total from marketplace_private.reviews r
  where r.moderation_status='visible' and (
    (p_subject_type='resale_seller' and r.subject_type='resale_seller' and r.seller_id=p_subject_id)
    or (p_subject_type='shop' and r.subject_type='shop' and r.shop_id=p_subject_id)
    or (p_subject_type='shop_product' and r.subject_type='shop_product' and r.listing_id=p_subject_id)
  );
  return jsonb_build_object('subjectType',p_subject_type,'subjectId',p_subject_id,
    'reviewCount',coalesce(total,0),'averageRating',case when total=0 then null else round(units/2.0,1) end);
end;
$$;

create function public.marketplace_submit_review_reply(p_review_id uuid,p_reply text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_review marketplace_private.reviews; v_reply marketplace_private.review_replies;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
    raise exception 'Verified account required.' using errcode='42501';
  end if;
  if p_review_id is null or p_reply is null or char_length(btrim(p_reply)) not between 1 and 500 then
    raise exception 'Valid review reply required.' using errcode='23514';
  end if;
  select * into v_review from marketplace_private.reviews where id=p_review_id for key share;
  if not found or not marketplace_private.review_reply_allowed(v_review,actor) then
    raise exception 'Review reply not permitted.' using errcode='42501';
  end if;
  insert into marketplace_private.review_replies(review_id,seller_id,reply)
  values(v_review.id,actor,btrim(p_reply)) returning * into v_reply;
  return jsonb_build_object('reviewId',v_review.id,'reply',v_reply.reply,'repliedAt',v_reply.replied_at);
exception when unique_violation then
  raise exception 'A reply has already been submitted for this review.' using errcode='23505';
end;
$$;

revoke all on function marketplace_private.review_reply_allowed(marketplace_private.reviews,uuid),
  public.marketplace_get_order_reviews(uuid),public.marketplace_get_public_reviews(text,uuid,integer,timestamptz,uuid),
  public.marketplace_get_review_summary(text,uuid),public.marketplace_submit_review_reply(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.marketplace_get_order_reviews(uuid),
  public.marketplace_submit_review_reply(uuid,text) to authenticated;
grant execute on function public.marketplace_get_public_reviews(text,uuid,integer,timestamptz,uuid),
  public.marketplace_get_review_summary(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;

-- Add only a boolean identity signal to public Shop projections.
begin;
create or replace function marketplace_private.public_shop_product(p_listing public.listings) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_listing.id,'listingChannel','shop','title',p_listing.title,
  'description',p_listing.description,'price',p_listing.price_cents,'currency',p_listing.currency,
  'category',p_listing.category,'subcategory',p_listing.subcategory,'condition',p_listing.condition,
  'preferredPaymentMode',p_listing.preferred_payment_mode,'preferredFulfillment',p_listing.preferred_fulfillment,
  'meetingLocation',case when p_listing.meeting_location is not null then jsonb_build_object('label',p_listing.meeting_location) else null end,
  'estimatedDeliveryFeeCents',p_listing.estimated_delivery_fee_cents,'status',p_listing.status,
  'createdAt',p_listing.created_at,'updatedAt',p_listing.updated_at,'publishedAt',p_listing.published_at,
  'seller',jsonb_build_object('id',p_listing.seller_id,'displayName',p.username,
    'uwoEmailVerified',marketplace_private.is_uwo_email_verified(p_listing.seller_id)),
  'photoUrls',(select coalesce(jsonb_agg('/api/listing-media/'||i.id::text order by i.slot),'[]'::jsonb)
   from public.listing_images i where i.listing_id=p_listing.id and i.owner_id=p_listing.seller_id and i.ready)))
 from public.profiles p where p.id=p_listing.seller_id;
$$;
create or replace function marketplace_private.public_shop_profile(p_shop public.shops) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_shop.id,'sellerProfileId',p.id,'username',p.username,
 'shopName',p_shop.name,'category',p_shop.category,'description',p_shop.description,
 'badgeTier',case when marketplace_private.is_shop_approved(p.id) then null else marketplace_private.public_shop_eligibility(p.id)->>'badgeTier' end,
 'uwoEmailVerified',marketplace_private.is_uwo_email_verified(p.id),
 'avatarUrl',case when p.avatar_path is not null then '/api/profile/avatar/'||p.id::text else null end,
 'imageUrl',(select '/api/listing-media/'||i.id::text from public.listings l join public.listing_images i on i.listing_id=l.id
  where l.seller_id=p.id and l.listing_channel='shop' and l.published_at is not null and l.status='available'
   and i.ready and i.owner_id=p.id order by l.created_at desc,l.id,i.slot limit 1)))
 from public.profiles p where p.id=p_shop.owner_id and p.username is not null;
$$;
commit;

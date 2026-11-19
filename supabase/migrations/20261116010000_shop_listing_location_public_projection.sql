-- Keep Shop Listing creation and its public projection aligned with the
-- already-persisted Meeting-area and location-detail Listing contract.
-- This migration is forward-only; it neither changes RLS nor grants access.
begin;

create or replace function public.marketplace_create_shop_listing(p_input jsonb,p_client_action_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v public.listings; prior public.listings; k text;
 allowed text[]:=array['title','description','price_cents','currency','category','subcategory','condition','pickup_area','expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_area','meeting_location','meeting_location_provider','meeting_place_id','meeting_location_detail','estimated_delivery_fee_cents'];
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) or not coalesce(marketplace_private.is_shop_operator(actor),false) then raise exception 'Approved Shop account required.' using errcode='42501'; end if;
 if p_client_action_id is null or jsonb_typeof(p_input) is distinct from 'object' or (p_input-allowed)<>'{}'::jsonb or not(p_input ?& array['title','description','price_cents','currency','category','subcategory','expected_image_count','preferred_payment_mode','preferred_fulfillment','estimated_delivery_fee_cents']) then raise exception 'Valid product fields and action ID required.' using errcode='23514'; end if;
 foreach k in array array['title','description','currency','category','subcategory','preferred_payment_mode','preferred_fulfillment'] loop if jsonb_typeof(p_input->k) is distinct from 'string' then raise exception 'Product fields must be text.' using errcode='23514'; end if; end loop;
 foreach k in array array['condition','pickup_area','meeting_area','meeting_location','meeting_location_provider','meeting_place_id','meeting_location_detail'] loop if p_input ? k and jsonb_typeof(p_input->k) not in('string','null') then raise exception 'Invalid optional product field.' using errcode='23514'; end if; end loop;
 foreach k in array array['price_cents','expected_image_count','estimated_delivery_fee_cents'] loop if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)::numeric<>trunc((p_input->>k)::numeric) or (p_input->>k)::numeric not between 0 and 9007199254740991 then raise exception 'Product amounts/count must be valid integers.' using errcode='23514'; end if; end loop;
 if (p_input->>'expected_image_count')::numeric not between 1 and 6 then raise exception 'Expected image count must be between 1 and 6.' using errcode='23514'; end if;
 select * into v from jsonb_populate_record(null::public.listings,p_input);
 if marketplace_private.shop_profile_text_length(v.title) not between 1 and 120 or marketplace_private.shop_profile_text_length(v.description)>5000 or v.currency<>'CAD' or v.expected_image_count not between 1 and 6 or (v.pickup_area is not null and marketplace_private.shop_profile_text_length(v.pickup_area) not between 1 and 120) or v.preferred_fulfillment not in('ON_CAMPUS','DELIVERY') or v.preferred_payment_mode not in('uu_pay','external') or (v.preferred_fulfillment='DELIVERY' and v.preferred_payment_mode<>'uu_pay') then raise exception 'Check the product fields.' using errcode='23514'; end if;
 if v.meeting_location_detail is not null and (char_length(v.meeting_location_detail) not between 1 and 100 or v.meeting_location_detail<>btrim(v.meeting_location_detail)) then raise exception 'Check the Location detail.' using errcode='23514'; end if;
 if v.preferred_fulfillment='DELIVERY' then
  if v.meeting_area is not null or v.meeting_location is not null or v.meeting_location_provider is not null or v.meeting_place_id is not null or v.meeting_location_detail is not null then raise exception 'Delivery listings cannot include Meeting location data.' using errcode='23514'; end if;
 elsif v.meeting_area not in('ON_CAMPUS','OTHER') or v.meeting_location is null or v.meeting_location_provider<>'google' or not marketplace_private.valid_meeting_reference(v.meeting_location_provider,v.meeting_place_id) then
  raise exception 'A valid Google Meeting place and area are required.' using errcode='23514';
 end if;
 perform 1 from public.shops where owner_id=actor for key share; if not found then raise exception 'Owned Shop required.' using errcode='42501'; end if;
 insert into public.listings(id,seller_id,listing_channel,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,preferred_payment_mode,preferred_fulfillment,meeting_area,meeting_location,meeting_location_provider,meeting_place_id,meeting_location_detail,estimated_delivery_fee_cents)
 values(p_client_action_id,actor,'shop',v.title,v.description,v.price_cents,v.currency,v.category,v.subcategory,v.condition,v.pickup_area,v.expected_image_count,v.preferred_payment_mode,v.preferred_fulfillment,v.meeting_area,v.meeting_location,v.meeting_location_provider,v.meeting_place_id,v.meeting_location_detail,v.estimated_delivery_fee_cents) on conflict(id) do nothing;
 select * into prior from public.listings where id=p_client_action_id for update; if prior.seller_id is distinct from actor or prior.listing_channel<>'shop' or not(to_jsonb(prior) @> p_input) then raise exception 'Conflicting product creation retry.' using errcode='23505'; end if; return prior.id;
end;$$;
revoke all on function public.marketplace_create_shop_listing(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_create_shop_listing(jsonb,uuid) to authenticated;

create or replace function marketplace_private.public_shop_product(p_listing public.listings) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_listing.id,'listingChannel','shop','title',p_listing.title,
  'description',p_listing.description,'price',p_listing.price_cents,'currency',p_listing.currency,
  'category',p_listing.category,'subcategory',p_listing.subcategory,'condition',p_listing.condition,
  'preferredPaymentMode',p_listing.preferred_payment_mode,'preferredFulfillment',p_listing.preferred_fulfillment,
  'meetingArea',p_listing.meeting_area,
  'meetingLocation',case when p_listing.meeting_location is not null then jsonb_build_object('label',p_listing.meeting_location) else null end,
  'meetingLocationDetail',p_listing.meeting_location_detail,
  'estimatedDeliveryFeeCents',p_listing.estimated_delivery_fee_cents,'status',p_listing.status,
  'createdAt',p_listing.created_at,'updatedAt',p_listing.updated_at,'publishedAt',p_listing.published_at,
  'seller',jsonb_build_object('id',p_listing.seller_id,'displayName',p.username,
    'uwoEmailVerified',marketplace_private.is_uwo_email_verified(p_listing.seller_id)),
  'shop',jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username),
  'photoUrls',(select coalesce(jsonb_agg('/api/listing-media/'||i.id::text order by i.slot),'[]'::jsonb)
   from public.listing_images i where i.listing_id=p_listing.id and i.owner_id=p_listing.seller_id and i.ready)))
 from public.profiles p join public.shops s on s.owner_id=p.id where p.id=p_listing.seller_id;
$$;
revoke all on function marketplace_private.public_shop_product(public.listings) from public,anon,authenticated,service_role;

commit;

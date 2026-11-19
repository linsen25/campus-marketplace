-- Task B: a Listing must always have a canonical category, while its
-- subcategory is optional. This is forward-only and is intentionally not
-- applied by the client or test suite.
begin;

alter table public.listings alter column subcategory drop not null;
alter table public.listings drop constraint if exists listings_category_subcategory_check;
alter table public.listings add constraint listings_category_subcategory_check check (
  subcategory is null or
  (category = 'Electronics' and subcategory in ('Computers & Tablets', 'Phones & Accessories', 'Monitors', 'Audio & Headphones', 'Gaming & Consoles', 'Cameras', 'Cables & Accessories')) or
  (category = 'Home & Dorm' and subcategory in ('Furniture', 'Kitchen & Dining', 'Small Appliances', 'Bedding & Bath', 'Storage & Organization', 'Lighting & Decor', 'Cleaning')) or
  (category = 'Textbooks & School' and subcategory in ('Textbooks', 'Calculators', 'Stationery', 'School Supplies', 'Lab & Art Supplies', 'Backpacks')) or
  (category = 'Clothing & Accessories' and subcategory in ('Tops & Bottoms', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Formalwear')) or
  (category = 'Sports & Outdoors' and subcategory in ('Fitness & Gym', 'Team Sports', 'Racket Sports', 'Winter Sports', 'Camping & Outdoors', 'Other Sports')) or
  (category = 'Bikes & Mobility' and subcategory in ('Bikes', 'E-bikes & Scooters', 'Skateboards', 'Helmets & Safety', 'Locks & Lights', 'Parts & Accessories')) or
  (category = 'Games & Hobbies' and subcategory in ('Video Games', 'Board Games', 'Musical Instruments', 'Books & Media', 'Arts & Crafts', 'Collectibles')) or
  (category = 'Other' and subcategory in ('Other'))
);

alter table public.listings drop column search_text;
alter table public.listings add column search_text text generated always as (
  title || ' ' || description || ' ' || coalesce(pickup_area, '') || ' ' || category || ' ' || coalesce(subcategory, '')
) stored;

create or replace function public.marketplace_create_shop_listing(p_input jsonb,p_client_action_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v public.listings; prior public.listings; k text;
 allowed text[]:=array['title','description','price_cents','currency','category','subcategory','condition','pickup_area','expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_area','meeting_location','meeting_location_provider','meeting_place_id','meeting_location_detail','estimated_delivery_fee_cents'];
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) or not coalesce(marketplace_private.is_shop_operator(actor),false) then raise exception 'Approved Shop account required.' using errcode='42501'; end if;
 if p_client_action_id is null or jsonb_typeof(p_input) is distinct from 'object' or (p_input-allowed)<>'{}'::jsonb or not(p_input ?& array['title','description','price_cents','currency','category','expected_image_count','preferred_payment_mode','preferred_fulfillment','estimated_delivery_fee_cents']) then raise exception 'Valid product fields and action ID required.' using errcode='23514'; end if;
 foreach k in array array['title','description','currency','category','preferred_payment_mode','preferred_fulfillment'] loop if jsonb_typeof(p_input->k) is distinct from 'string' then raise exception 'Product fields must be text.' using errcode='23514'; end if; end loop;
 foreach k in array array['subcategory','condition','pickup_area','meeting_area','meeting_location','meeting_location_provider','meeting_place_id','meeting_location_detail'] loop if p_input ? k and jsonb_typeof(p_input->k) not in('string','null') then raise exception 'Invalid optional product field.' using errcode='23514'; end if; end loop;
 foreach k in array array['price_cents','expected_image_count','estimated_delivery_fee_cents'] loop if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)::numeric<>trunc((p_input->>k)::numeric) or (p_input->>k)::numeric not between 0 and 9007199254740991 then raise exception 'Product amounts/count must be valid integers.' using errcode='23514'; end if; end loop;
 if (p_input->>'expected_image_count')::numeric not between 1 and 6 then raise exception 'Expected image count must be between 1 and 6.' using errcode='23514'; end if;
 select * into v from jsonb_populate_record(null::public.listings,p_input);
 if marketplace_private.shop_profile_text_length(v.title) not between 1 and 120 or marketplace_private.shop_profile_text_length(v.description)>5000 or v.currency<>'CAD' or v.expected_image_count not between 1 and 6 or (v.pickup_area is not null and marketplace_private.shop_profile_text_length(v.pickup_area) not between 1 and 120) or v.preferred_fulfillment not in('ON_CAMPUS','DELIVERY') or v.preferred_payment_mode not in('uu_pay','external','in_person','interac_etransfer') or (v.preferred_fulfillment='DELIVERY' and v.preferred_payment_mode<>'uu_pay') then raise exception 'Check the product fields.' using errcode='23514'; end if;
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

commit;

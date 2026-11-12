-- Disposable Supabase Local Stack integration assertions for 008/009.
-- This file is never run against a business database or a remote project.
begin;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values
 ('00000000-0000-0000-0000-0000000000a1','ordinary-a@example.com',now(),'{"username":"Ordinary_A"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000b2','ordinary-b@example.com',now(),'{"username":"Ordinary_B"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000c3','unconfirmed@example.com',null,'{"username":"Unconfirmed_C"}'::jsonb);

-- The seller readiness row is an explicit financial precondition for Offer
-- acceptance; it does not grant payment execution or provider access.
select public.marketplace_record_financial_capability(
  '00000000-0000-0000-0000-0000000000b2','payout_account','ready',
  'staging_test','permissions_fixture','permissions_payout','Test Bank','6789');

insert into public.shops(id,owner_id,name,category,description)
values ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000b2','Fixture Shop','Electronics','Fixture shop for permission tests');

insert into public.listings(
 id,seller_id,title,description,price_cents,currency,category,subcategory,pickup_area,
 status,published_at,expected_image_count,listing_channel)
values (
 '00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000b2','Fixture Listing','A listing for permission tests',1000,'CAD',
 'Electronics','Computers & Tablets','Campus','available',null,1,'resale');

-- Prepare the synthetic image metadata before the authenticated publication RPC.
-- This is disposable SQL fixture data, not a Storage API upload.
do $$
declare listing_id uuid; image_id uuid; object_path text;
begin
  select id into listing_id from public.listings where title='Fixture Listing';
  insert into public.listing_images(listing_id,owner_id,slot)
    values(listing_id,'00000000-0000-0000-0000-0000000000b2',1)
    returning id,path into image_id,object_path;
  insert into storage.objects(bucket_id,name,metadata)
    values('listing-images-private',object_path,'{"mimetype":"image/jpeg","size":100}');
  update public.listing_images set ready=true where id=image_id;
end $$;

-- Separate unpublished Resale fixture for verified ordinary-account owner reads.
insert into public.listings(
 id,seller_id,title,description,price_cents,currency,category,subcategory,pickup_area,
 status,published_at,expected_image_count,listing_channel)
values (
 '00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000a1',
 'Unpublished Fixture','A private draft for permission tests',1000,'CAD',
 'Electronics','Computers & Tablets','Campus','available',null,1,'resale');
insert into public.listing_images(listing_id,owner_id,slot)
values ('00000000-0000-0000-0000-0000000000e4',
        '00000000-0000-0000-0000-0000000000a1',1);

-- Publication is an authenticated state transition, not an INSERT value.
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select public.marketplace_finalize_listing(
  '00000000-0000-0000-0000-0000000000d4'::uuid
);
reset role;

insert into marketplace_private.notification_events(id,source_key,event_type,destination)
values
 ('00000000-0000-0000-0000-0000000000e1','qualification-a','new_message','{"section":"messages"}'),
 ('00000000-0000-0000-0000-0000000000e2','qualification-b','new_message','{"section":"messages"}');
insert into public.notifications(
 id,recipient_user_id,domain_event_id,event_type,priority,created_at,updated_at,destination)
values
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','new_message','INFORMATIONAL',now(),now(),'{"section":"messages"}'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000e2','new_message','INFORMATIONAL',now(),now(),'{"section":"messages"}');

insert into public.shop_favorites(user_id,shop_id)
select '00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000e3';
insert into public.shop_favorites(user_id,shop_id)
select '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e3';

-- A confirmed ordinary email can confirm a username and use the filtered RPC.
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
create temp table fixture_conversation(id uuid) on commit drop;
select public.marketplace_confirm_username('Ordinary_A');
do $$
declare result jsonb; conversation_id uuid;
begin
  result:=public.marketplace_notifications_filtered(null,null,null,null);
  if jsonb_array_length(result->'notifications')<>1
     or not (result->'notifications' @> '[{"id":"00000000-0000-0000-0000-0000000000f1"}]') then
    raise exception 'ordinary confirmed account notification isolation failed';
  end if;
  select id into conversation_id from public.marketplace_find_or_create_conversation(
    (select id from public.listings where title='Fixture Listing')
  );
  insert into fixture_conversation values(conversation_id);
  perform public.marketplace_send_text(conversation_id,gen_random_uuid(),'hello from ordinary account');
  perform public.marketplace_mark_conversation_read(conversation_id,1);
  if (select count(*) from public.listings
      where id='00000000-0000-0000-0000-0000000000e4')<>1
     or (select count(*) from public.listing_images
      where listing_id='00000000-0000-0000-0000-0000000000e4')<>1 then
    raise exception 'ordinary confirmed account own draft read failed';
  end if;
end $$;

-- A cannot see B's notification or B's favorite; its own favorite is visible.
do $$
declare result jsonb; shop_id uuid;
begin
  shop_id:='00000000-0000-0000-0000-0000000000e3';
  result:=public.marketplace_shop_favorite_states(array[shop_id]);
  if result->'favoriteShopIds' <> jsonb_build_array(shop_id) then
    raise exception 'ordinary confirmed account favorite read failed';
  end if;
end $$;

-- Unconfirmed accounts cannot use the same protected RPCs.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.marketplace_notifications_filtered(null,null,null,null);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'unconfirmed notification access was accepted'; end if;
  rejected:=false;
  begin
    perform public.marketplace_confirm_username('Unconfirmed_C');
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'unconfirmed username confirmation was accepted'; end if;
  if (select count(*) from public.listings
      where id='00000000-0000-0000-0000-0000000000e4')<>0
     or (select count(*) from public.listing_images
      where listing_id='00000000-0000-0000-0000-0000000000e4')<>0 then
    raise exception 'unconfirmed unpublished listing read was accepted';
  end if;
end $$;

-- Anonymous role cannot call the protected filtered RPC.
reset role;
set role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.marketplace_notifications_filtered(null,null,null,null);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'anonymous notification access was accepted'; end if;
  begin
    perform 1 from public.listings where id='00000000-0000-0000-0000-0000000000e4';
    if found then raise exception 'anonymous unpublished listing read was accepted'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.listing_images where listing_id='00000000-0000-0000-0000-0000000000e4';
    if found then raise exception 'anonymous unpublished image read was accepted'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot claim A's username and cannot use A's conversation as an outsider.
reset role;
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
do $$
declare rejected boolean:=false; conversation_id uuid;
begin
  begin perform public.marketplace_confirm_username('Ordinary_A'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'username collision was accepted'; end if;
  if (select count(*) from public.listings
      where id='00000000-0000-0000-0000-0000000000e4')<>0
     or (select count(*) from public.listing_images
      where listing_id='00000000-0000-0000-0000-0000000000e4')<>0 then
    raise exception 'cross-account unpublished listing read was accepted';
  end if;
  select id into conversation_id from fixture_conversation limit 1;
  perform public.marketplace_send_text(conversation_id,gen_random_uuid(),'seller reply');
end $$;

-- C is not a participant and cannot read/mark the conversation.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
do $$
declare rejected boolean:=false; conversation_id uuid;
begin
  select id into conversation_id from fixture_conversation limit 1;
  begin perform public.marketplace_mark_conversation_read(conversation_id,1); exception when others then rejected:=true; end;
  if not rejected then raise exception 'nonparticipant conversation read was accepted'; end if;
end $$;

-- Ordinary confirmed non-UWO accounts can traverse the Resale Offer boundary.
-- Existing participant, listing and seller payout-readiness checks remain active.
reset role;
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
do $$
declare
  conversation_id uuid;
  offer_id uuid;
  second_offer uuid;
  preflight jsonb;
  rejected boolean:=false;
  -- Keep this positive fixture aligned with the V2 Offer contract loaded by
  -- database-qualification.yml. Payment mode/version are server-injected by
  -- mutate_offer_revision(); all fulfillment terms below are caller-owned.
  offer_terms jsonb:=pg_catalog.jsonb_build_object(
    'item_amount_cents',800,
    'fulfillment','on_campus',
    'note','ordinary resale offer',
    'meetup_location','Fixture meeting point',
    'meetup_location_provider',null,
    'meetup_place_id',null,
    'scheduled_at',pg_catalog.date_trunc('hour',pg_catalog.clock_timestamp())+interval '2 hours'
  );
begin
  if not coalesce(marketplace_private.is_verified_user(),false)
     or coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'ordinary offer fixture must be confirmed but non-Western';
  end if;
  select id into conversation_id from fixture_conversation limit 1;

  -- Keep the malformed-terms rejection meaningful while the positive fixture
  -- exercises the complete current contract below.
  begin
    perform public.marketplace_create_offer(
      conversation_id,
      pg_catalog.jsonb_build_object('item_amount_cents',800,'note','missing fulfillment'),
      gen_random_uuid()
    );
  exception when check_violation then
    rejected:=true;
  end;
  if not rejected then
    raise exception 'malformed offer terms were accepted';
  end if;

  select id into offer_id from public.marketplace_create_offer(
    conversation_id,offer_terms,gen_random_uuid());
  if offer_id is null then raise exception 'ordinary confirmed account offer creation failed'; end if;
  perform public.marketplace_offer_history(conversation_id);

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
  perform public.marketplace_deny_offer(offer_id,gen_random_uuid());

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  select id into second_offer from public.marketplace_create_offer(
    conversation_id,
    offer_terms||pg_catalog.jsonb_build_object('note','ordinary resale offer 2'),
    gen_random_uuid());
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
  preflight:=public.marketplace_offer_accept_preflight(second_offer,gen_random_uuid());
  if preflight->>'ready' is distinct from 'true' then
    raise exception 'ordinary confirmed account offer preflight did not reach transaction checks: %',preflight;
  end if;
end $$;

-- The same confirmed accounts can read their own participant request/order
-- projections; direct writes and forged participants remain guarded by the
-- existing SECURITY DEFINER transaction functions and immutable triggers.
do $$
declare conversation_id uuid; request_id uuid; history jsonb;
begin
  select id into conversation_id from fixture_conversation limit 1;
  request_id:=null;
  select id into request_id from public.marketplace_create_order_request(
    conversation_id,'{"item_amount_cents":800,"fulfillment_type":"shipping","shipping_cost_mode":"included"}'::jsonb,gen_random_uuid());
  if request_id is null then raise exception 'ordinary confirmed account order request creation failed'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  history:=public.marketplace_order_request_history(conversation_id);
  if not (history->'requests' @> jsonb_build_array(jsonb_build_object('id',request_id))) then
    raise exception 'ordinary confirmed account order request history read failed';
  end if;
end $$;

rollback;

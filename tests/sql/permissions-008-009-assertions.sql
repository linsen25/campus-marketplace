-- Disposable Supabase Local Stack integration assertions for 008/009.
-- This file is never run against a business database or a remote project.
begin;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values
 ('00000000-0000-0000-0000-0000000000a1','ordinary-a@example.com',now(),'{}'::jsonb),
 ('00000000-0000-0000-0000-0000000000b2','ordinary-b@example.com',now(),'{}'::jsonb),
 ('00000000-0000-0000-0000-0000000000c3','unconfirmed@example.com',null,'{}'::jsonb);

insert into public.shops(owner_id,name,category,description)
values ('00000000-0000-0000-0000-0000000000b2','Fixture Shop','Electronics','Fixture shop for permission tests');

insert into public.listings(
 seller_id,title,description,price_cents,currency,category,subcategory,pickup_area,
 status,published_at,expected_image_count,listing_channel)
values (
 '00000000-0000-0000-0000-0000000000b2','Fixture Listing','A listing for permission tests',1000,'CAD',
 'Electronics','Computers & Tablets','Campus','available',clock_timestamp(),1,'resale');

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
select '00000000-0000-0000-0000-0000000000b2',id from public.shops where owner_id='00000000-0000-0000-0000-0000000000b2';

-- A confirmed ordinary email can confirm a username and use the filtered RPC.
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
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
  perform public.marketplace_send_text(conversation_id,gen_random_uuid(),'hello from ordinary account');
  perform public.marketplace_mark_conversation_read(conversation_id,1);
end $$;

-- A cannot see B's notification or B's favorite; its own favorite is visible.
insert into public.shop_favorites(user_id,shop_id)
select '00000000-0000-0000-0000-0000000000a1',id from public.shops where owner_id='00000000-0000-0000-0000-0000000000b2';
do $$
declare result jsonb; shop_id uuid;
begin
  select id into shop_id from public.shops where owner_id='00000000-0000-0000-0000-0000000000b2';
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
  select id into conversation_id from public.conversations limit 1;
  perform public.marketplace_send_text(conversation_id,gen_random_uuid(),'seller reply');
end $$;

-- C is not a participant and cannot read/mark the conversation.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
do $$
declare rejected boolean:=false; conversation_id uuid;
begin
  select id into conversation_id from public.conversations limit 1;
  begin perform public.marketplace_mark_conversation_read(conversation_id,1); exception when others then rejected:=true; end;
  if not rejected then raise exception 'nonparticipant conversation read was accepted'; end if;
end $$;

rollback;

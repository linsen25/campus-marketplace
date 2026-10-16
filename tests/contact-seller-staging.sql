create temporary table fc_people as select gen_random_uuid() buyer,gen_random_uuid() seller,gen_random_uuid() outsider;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'fc_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','FC_'||left(replace(id::text,'-',''),12)) from fc_people cross join lateral(values(buyer),(seller),(outsider)) v(id);
update public.profiles set display_name='Contact Buyer' where id=(select buyer from fc_people);
create function pg_temp.fc_assert(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'First contact assertion: %',label;end if;end;$$;
create function pg_temp.fc_actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);$$;
alter table public.listings disable trigger listings_publication_boundary;
create temporary table fc_listings as
with inserted as(insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
select p.seller,'Contact test '||v.n,'Rollback-only first contact',8000,l.currency,l.category,l.subcategory,l.condition,l.pickup_area,1,clock_timestamp()
from (select * from public.listings where published_at is not null limit 1) l cross join fc_people p cross join generate_series(1,4) v(n) returning id,title)select * from inserted;
do $$declare c public.conversations;existing public.conversations;l uuid;notice uuid;reply public.messages;result jsonb;begin
 perform pg_temp.fc_actor((select buyer from fc_people));
 select id into l from fc_listings where title='Contact test 1';
 c:=public.marketplace_contact_seller(l);
 perform pg_temp.fc_assert((select count(*)=2 from public.messages where conversation_id=c.id),'two atomic messages');
 perform pg_temp.fc_assert((select count(*)=1 from public.messages where conversation_id=c.id and origin='buyer_interest' and sender_id=c.buyer_id and content='Hi, I''m '||(select display_name from public.profiles where id=c.buyer_id)||'. I''m interested in your Contact test 1. Is it still available?'),'safe authoritative intro');
 perform pg_temp.fc_assert((select count(*)=1 from public.messages where conversation_id=c.id and origin='marketplace_auto_reply' and sender_id=c.buyer_id),'ack records initiating Buyer, not Seller impersonation');
 perform pg_temp.fc_assert((select count(*)=1 from public.notifications where recipient_user_id=c.seller_id and destination->>'conversationId'=c.id::text and event_type='new_message'),'one seller notification');
 perform pg_temp.fc_assert(not exists(select 1 from public.notifications where recipient_user_id=c.buyer_id),'no fake Buyer notification');
 perform pg_temp.fc_assert(not exists(select 1 from marketplace_private.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.destination->>'conversationId'=c.id::text),'no message email');
 existing:=public.marketplace_contact_seller(l);
 perform pg_temp.fc_assert(existing.id=c.id and (select count(*)=2 from public.messages where conversation_id=c.id),'repeat idempotent');
 begin
  perform public.marketplace_withdraw_message((select id from public.messages where conversation_id=c.id and origin='marketplace_auto_reply'));
  raise exception 'Automatic reply withdrawal unexpectedly allowed';exception when insufficient_privilege then null;end;
 begin
  insert into public.messages(conversation_id,sender_id,client_message_id,type,content,origin)values(c.id,c.buyer_id,gen_random_uuid(),'TEXT','Spoof','marketplace_auto_reply');
  raise exception 'Spoof unexpectedly allowed';exception when insufficient_privilege then null;end;
 perform pg_temp.fc_actor(c.seller_id);
 result:=public.marketplace_mark_conversation_read(c.id,0);
 perform pg_temp.fc_assert((result->>'unread_count')::int=1,'Seller only intro unread');
 reply:=public.marketplace_send_text(c.id,gen_random_uuid(),'Actual Seller reply');
 perform pg_temp.fc_assert(reply.origin='user','real Seller origin unchanged');
 perform pg_temp.fc_assert((select count(*)=1 from public.notifications where recipient_user_id=c.buyer_id and destination->>'conversationId'=c.id::text),'one real Seller reply notification to Buyer');
 perform pg_temp.fc_actor(c.buyer_id);
 result:=public.marketplace_mark_conversation_read(c.id,2);
 perform pg_temp.fc_assert((result->>'unread_count')::int=1,'real reply unread, automatic not unread');
 select id into l from fc_listings where title='Contact test 2';existing:=public.marketplace_find_or_create_conversation(l);
 c:=public.marketplace_contact_seller(l);
 perform pg_temp.fc_assert(c.id=existing.id and not exists(select 1 from public.messages where conversation_id=c.id),'existing empty conversation not initialized');
 perform pg_temp.fc_actor((select seller from fc_people));
 begin perform public.marketplace_contact_seller(l);raise exception 'Self contact allowed';exception when check_violation then null;end;
 perform pg_temp.fc_assert(not has_table_privilege('authenticated','public.messages','INSERT') and not has_table_privilege('authenticated','marketplace_private.conversation_first_contacts','SELECT'),'no client origin/initialization authority');
 perform pg_temp.fc_assert(not has_function_privilege('anon','public.marketplace_contact_seller(uuid)','EXECUTE') and has_function_privilege('authenticated','public.marketplace_contact_seller(uuid)','EXECUTE'),'least-privilege RPC');
end;$$;
-- Force an acknowledgement failure; the intro, conversation and notification must roll back together.
create function pg_temp.fc_fail_ack() returns trigger language plpgsql as $$begin if new.origin='marketplace_auto_reply' then raise exception 'synthetic acknowledgement failure';end if;return new;end;$$;
create trigger fc_fail_ack before insert on public.messages for each row execute function pg_temp.fc_fail_ack();
do $$declare l uuid;begin perform pg_temp.fc_actor((select buyer from fc_people));select id into l from fc_listings where title='Contact test 3';
 begin perform public.marketplace_contact_seller(l);raise exception 'Expected injected failure';exception when others then if sqlerrm<>'synthetic acknowledgement failure' then raise;end if;end;
 perform pg_temp.fc_assert(not exists(select 1 from public.conversations where listing_origin_id=l),'failed initialization leaves no conversation/partial messages');
end;$$;
drop trigger fc_fail_ack on public.messages;
do $$declare c public.conversations;begin c:=public.marketplace_contact_seller((select id from fc_listings where title='Contact test 3'));perform pg_temp.fc_assert(c.last_message_sequence=2,'retry after failure creates exactly one pair');end;$$;
select pg_temp.fc_actor((select outsider from fc_people));
set local role authenticated;
do $$begin
 if exists(select 1 from public.conversations where listing_title_snapshot like 'Contact test %')
 or exists(select 1 from public.messages where origin in('buyer_interest','marketplace_auto_reply')) then
 raise exception 'Outsider can read first-contact history';end if;
 begin
  insert into public.messages(conversation_id,sender_id,client_message_id,type,content)
  values(gen_random_uuid(),auth.uid(),gen_random_uuid(),'TEXT','Spoof');
  raise exception 'Direct message insert unexpectedly allowed';
 exception when insufficient_privilege then null;end;
end;$$;
reset role;
select true passed;

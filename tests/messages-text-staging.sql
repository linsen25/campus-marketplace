-- STAGING ONLY: western-marketplace-staging. Never execute against production.
-- Real Supabase schemas/functions; admin fixtures, then SET ROLE authenticated/JWT
-- claims exercise actual auth.uid(), RLS and privileges. No mock Auth/storage schema.
-- One-session behavioral suite; concurrency is tested separately.
begin;
create temp table phase1b_results (test text primary key, result text not null);
grant select, insert on phase1b_results to authenticated;
create function pg_temp.expect_error(statement text, expected_code text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> expected_code then
      raise exception 'Expected SQLSTATE %, got %: %', expected_code, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected rejected statement: %', statement;
end; $$;
do $$ declare namespace text; begin
  select nspname into namespace from pg_namespace where oid = pg_my_temp_schema();
  execute format('grant usage on schema %I to authenticated', namespace);
end; $$;

do $$
declare seller uuid := 'f1b00000-0000-4000-8000-000000000101';
  buyer uuid := 'f1b00000-0000-4000-8000-000000000102';
  outsider uuid := 'f1b00000-0000-4000-8000-000000000103';
  lid uuid; iid uuid; object_path text; n integer;
begin
  if exists (select 1 from auth.users where id in (seller,buyer,outsider)) then
    raise exception 'Phase1B fixture UUID collision; do not overwrite existing data';
  end if;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  values
    (seller,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase1b-seller@uwo.ca',now(),now(),now(),'{"provider":"email","providers":["email"]}','{"username":"Phase1B_Seller"}'),
    (buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase1b-buyer@uwo.ca',now(),now(),now(),'{"provider":"email","providers":["email"]}','{"username":"Phase1B_Buyer"}'),
    (outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase1b-outsider@uwo.ca',now(),now(),now(),'{"provider":"email","providers":["email"]}','{"username":"Phase1B_Outsider"}');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  for n in 1..4 loop
    lid := ('f1b00000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    insert into public.listings(id,seller_id,title,price_cents,currency,category,subcategory,pickup_area,expected_image_count)
      values(lid,seller,'Phase1B listing '||n,4500,'CAD','Home & Dorm','Furniture','Staging only',1);
    if n = 3 then continue; end if;
    iid := ('f1b10000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    insert into public.listing_images(id,listing_id,owner_id,slot) values(iid,lid,seller,1)
      returning path into object_path;
    -- SQL fixture metadata only, not a real Storage HTTP upload or production object.
    insert into storage.objects(bucket_id,name,metadata)
      values('listing-images',object_path,'{"mimetype":"image/jpeg","size":100}');
    update public.listing_images set ready=true where id=iid;
    perform public.marketplace_finalize_listing(lid);
  end loop;
  update public.listings set status='sold' where id='f1b00000-0000-4000-8000-000000000004';
end; $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000102',true);
select set_config('request.jwt.claims','{"sub":"f1b00000-0000-4000-8000-000000000102","role":"authenticated"}',true);
do $$
declare c public.conversations; other public.conversations; m public.messages; retry public.messages;
  state public.conversations; nonce uuid := gen_random_uuid(); text_value text; n integer;
begin
  if current_user <> 'authenticated' or auth.uid() <> 'f1b00000-0000-4000-8000-000000000102' then
    raise exception 'RLS test must use actual authenticated role/identity';
  end if;
  c := public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000001');
  if c.buyer_id <> auth.uid() or c.seller_id <> 'f1b00000-0000-4000-8000-000000000101'
    or c.listing_origin_id <> 'f1b00000-0000-4000-8000-000000000001' or c.listing_id <> c.listing_origin_id
    or c.listing_title_snapshot <> 'Phase1B listing 1' or c.listing_price_cents_snapshot <> 4500
    or c.listing_currency_snapshot <> 'CAD' or c.listing_category_snapshot <> 'Home & Dorm'
    or c.last_message_sequence <> 0 or c.buyer_last_read_sequence <> 0 or c.seller_last_read_sequence <> 0
    or c.last_message_at is not null then raise exception 'Find/create canonical fields failed'; end if;
  other := public.marketplace_find_or_create_conversation(c.listing_origin_id);
  if other.id <> c.id then raise exception 'Find/create duplicate'; end if;
  other := public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000002');
  if other.id = c.id then raise exception 'Different listings conflated'; end if;
  perform pg_temp.expect_error($q$select public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000003')$q$,'23514');
  perform pg_temp.expect_error($q$select public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000004')$q$,'23514');
  insert into phase1b_results values ('find/create, repeat, distinct listing, eligibility','PASS');
  m := public.marketplace_send_text(c.id,nonce,'Hello');
  select * into state from public.conversations where id=c.id;
  if m.sequence <> 1 or m.sender_id <> auth.uid() or m.content <> 'Hello' or m.type <> 'TEXT'
    or state.last_message_sequence <> 1 or state.last_message_at <> m.created_at
    or state.buyer_last_read_sequence <> 1 or state.seller_last_read_sequence <> 0 then
    raise exception 'First send/activity/read failed'; end if;
  retry := public.marketplace_send_text(c.id,nonce,'Hello');
  if retry.id <> m.id or (select count(*) from public.messages where conversation_id=c.id) <> 1
    or (select last_message_sequence from public.conversations where id=c.id) <> 1 then
    raise exception 'Exact retry failed'; end if;
  perform pg_temp.expect_error(format('select public.marketplace_send_text(%L,%L,%L)',c.id,nonce,'Different'),'23505');
  for text_value in select unnest(array['', '   ', E'\n\t\r ',repeat('x',2001),null]) loop
    perform pg_temp.expect_error(format('select public.marketplace_send_text(%L,%L,%L)',c.id,gen_random_uuid(),text_value),'23514');
  end loop;
  if (select last_message_sequence from public.conversations where id=c.id) <> 1 then raise exception 'Invalid send consumed sequence'; end if;
  m := public.marketplace_send_text(other.id,gen_random_uuid(),E'  Hello,\ncan I pick this up tomorrow? \t');
  if m.sequence <> 1 or m.content <> E'Hello,\ncan I pick this up tomorrow?' then raise exception 'Newline/edge trim failed'; end if;
  m := public.marketplace_send_text(other.id,gen_random_uuid(),repeat('x',2000));
  if char_length(m.content) <> 2000 then raise exception '2000 boundary failed'; end if;
  insert into phase1b_results values ('TEXT trim/newline/0/2000/2001/blank, independent sequence, exact retry/mismatch','PASS');
  -- Direct table writes are denied, regardless of row membership or forged sender.
  perform pg_temp.expect_error(format('insert into public.conversations(listing_origin_id) values(%L)',c.listing_origin_id),'42501');
  perform pg_temp.expect_error(format('update public.conversations set buyer_last_read_sequence=0 where id=%L',c.id),'42501');
  perform pg_temp.expect_error(format('delete from public.conversations where id=%L',c.id),'42501');
  perform pg_temp.expect_error(format('insert into public.messages(conversation_id,sender_id,client_message_id,content) values(%L,%L,%L,%L)',c.id,c.seller_id,gen_random_uuid(),'spoof'),'42501');
  perform pg_temp.expect_error(format('update public.messages set content=%L where id=%L','edit',retry.id),'42501');
  perform pg_temp.expect_error(format('delete from public.messages where id=%L',retry.id),'42501');
  insert into phase1b_results values ('authenticated direct INSERT/UPDATE/DELETE denied for both tables; sender spoof denied','PASS');
end; $$;

-- Seller context: reply is sequence 2, only seller watermark advances.
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000101',true);
select set_config('request.jwt.claims','{"sub":"f1b00000-0000-4000-8000-000000000101","role":"authenticated"}',true);
do $$ declare c public.conversations; m public.messages; begin
  perform pg_temp.expect_error($q$select public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000001')$q$,'23514');
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  if (select count(*) from public.messages where conversation_id=c.id) <> 1 then raise exception 'Seller RLS read failed'; end if;
  m := public.marketplace_send_text(c.id,gen_random_uuid(),'Seller reply');
  if m.sequence <> 2 then raise exception 'Seller sequence failed'; end if;
  insert into phase1b_results values ('seller participant RLS and self-contact rejection','PASS');
end; $$;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000102',true);
select set_config('request.jwt.claims','{"sub":"f1b00000-0000-4000-8000-000000000102","role":"authenticated"}',true);
do $$ declare c public.conversations; m public.messages; original public.messages; result jsonb; before_time timestamptz; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  select * into strict original from public.messages where conversation_id=c.id and sequence=1;
  m := public.marketplace_send_text(c.id,original.client_message_id,original.content);
  if (select buyer_last_read_sequence from public.conversations where id=c.id) <> 1 then raise exception 'Retry acknowledged newer reply'; end if;
  result := public.marketplace_mark_conversation_read(c.id,1);
  if (result->>'unread_count')::integer <> 1 then raise exception 'Mixed sender unread failed'; end if;
  before_time := c.last_message_at;
  result := public.marketplace_mark_conversation_read(c.id,2);
  result := public.marketplace_mark_conversation_read(c.id,1);
  if (result->>'last_read_sequence')::integer <> 2 or (result->>'unread_count')::integer <> 0
    or (select seller_last_read_sequence from public.conversations where id=c.id) <> 2
    or (select last_message_at from public.conversations where id=c.id) <> before_time then raise exception 'Read monotonic/activity failed'; end if;
  perform pg_temp.expect_error(format('select public.marketplace_mark_conversation_read(%L,-1)',c.id),'23514');
  perform pg_temp.expect_error(format('select public.marketplace_mark_conversation_read(%L,999)',c.id),'23514');
  perform pg_temp.expect_error(format('select public.marketplace_mark_conversation_read(%L,null)',c.id),'23514');
  m := public.marketplace_send_text(c.id,gen_random_uuid(),'Buyer third');
  if m.sequence <> 3 then raise exception 'Alternating 1/2/3 sequence failed'; end if;
  result := public.marketplace_mark_conversation_read(c.id,3);
  if (result->>'unread_count')::integer <> 0 then raise exception 'Own message unread'; end if;
  insert into phase1b_results values ('buyer RLS, sequences 1/2/3, retry read-state stability, mark-read/unread/activity','PASS');
end; $$;

-- Outsider creates a distinct conversation; neither buyer can see the other's rows.
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000103',true);
select set_config('request.jwt.claims','{"sub":"f1b00000-0000-4000-8000-000000000103","role":"authenticated"}',true);
do $$ declare c public.conversations; begin
  if exists(select 1 from public.conversations) or exists(select 1 from public.messages) then raise exception 'Outsider RLS leak'; end if;
  c := public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000002');
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Outsider own history');
  insert into phase1b_results values ('outsider actual RLS denies unrelated conversations/messages','PASS');
end; $$;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000102',true);
select set_config('request.jwt.claims','{"sub":"f1b00000-0000-4000-8000-000000000102","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.conversations where buyer_id='f1b00000-0000-4000-8000-000000000103')
    or exists(select 1 from public.messages where content='Outsider own history') then raise exception 'Buyer unrelated history leak'; end if;
end; $$;

reset role;
-- Privileged tests deliberately reach triggers; normal authenticated writes were denied above.
-- An artificial sequence gap is used only to isolate in-range/nonexistent boundary validation.
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  begin
    update public.conversations set last_message_sequence=100 where id=c.id;
    execute 'set local role authenticated';
    perform pg_temp.expect_error(format('select public.marketplace_mark_conversation_read(%L,99)',c.id),'23514');
    execute 'reset role';
    raise exception 'Rollback artificial sequence gap' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
  insert into phase1b_results values ('nonexistent in-range read boundary rejected (temporary privileged gap rolled back)','PASS');
end; $$;
do $$ declare c public.conversations; m public.messages; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  select * into m from public.messages where conversation_id=c.id limit 1;
  perform pg_temp.expect_error(format('update public.messages set content=%L where id=%L','edit',m.id),'23514');
  perform pg_temp.expect_error(format('delete from public.messages where id=%L',m.id),'23514');
  perform pg_temp.expect_error(format('update public.conversations set listing_id=%L where id=%L','f1b00000-0000-4000-8000-000000000002',c.id),'23514');
  perform pg_temp.expect_error(format('update public.conversations set buyer_id=%L where id=%L','f1b00000-0000-4000-8000-000000000103',c.id),'23514');
  perform pg_temp.expect_error(format('update public.conversations set seller_id=%L where id=%L','f1b00000-0000-4000-8000-000000000103',c.id),'23514');
  perform pg_temp.expect_error(format('update public.conversations set listing_title_snapshot=%L where id=%L','rewrite',c.id),'23514');
  update public.listings set title='Changed live title',price_cents=9900 where id=c.listing_id;
  if (select listing_title_snapshot from public.conversations where id=c.id) <> c.listing_title_snapshot
    or (select listing_price_cents_snapshot from public.conversations where id=c.id) <> c.listing_price_cents_snapshot then raise exception 'Live edit changed snapshot'; end if;
  -- Taxonomy edits are separately forbidden by the existing marketplace trigger.
  perform pg_temp.expect_error(format('update public.listings set category=%L where id=%L','Other',c.listing_id),'23514');
  update public.listings set status='sold' where id=c.listing_id;
  insert into phase1b_results values ('privileged message/snapshot/identity mutation rejected; live edits preserve snapshot','PASS');
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000102',true);
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Buyer after sold');
end; $$;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000101',true);
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Seller after sold');
end; $$;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000103',true);
select pg_temp.expect_error($q$select public.marketplace_find_or_create_conversation('f1b00000-0000-4000-8000-000000000001')$q$,'23514');
insert into phase1b_results values ('sold conversation both participants send/read; new buyer blocked','PASS');
reset role;
delete from public.listings where id='f1b00000-0000-4000-8000-000000000001';
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  if c.listing_id is not null or c.listing_title_snapshot <> 'Phase1B listing 1'
    or (select count(*) from public.messages where conversation_id=c.id) <> 5 then raise exception 'Listing deletion lost historical context/messages'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000102',true);
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Buyer after delete');
end; $$;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000101',true);
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Seller after delete');
end; $$;
insert into phase1b_results values ('listing delete SET NULL + identity trigger, preserved snapshot/history, both send/read','PASS');
reset role;
select pg_temp.expect_error($q$delete from auth.users where id='f1b00000-0000-4000-8000-000000000101'$q$,'23503');
insert into phase1b_results values ('seller account deletion blocked by existing listings seller FK; no silent redesign','PASS');
delete from auth.users where id='f1b00000-0000-4000-8000-000000000102';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1b00000-0000-4000-8000-000000000101',true);
do $$ declare c public.conversations; begin
  select * into strict c from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  if c.buyer_id is not null or (select count(*) from public.messages where conversation_id=c.id) <> 7 then raise exception 'Account deletion lost history'; end if;
  perform public.marketplace_send_text(c.id,gen_random_uuid(),'Surviving seller');
  insert into phase1b_results values ('real Auth account→profile delete SET NULL; surviving participant retains access/send','PASS');
end; $$;
reset role;
do $$ declare cid uuid; begin
  select id into cid from public.conversations where listing_origin_id='f1b00000-0000-4000-8000-000000000001';
  delete from public.conversations where id=cid;
  if exists(select 1 from public.messages where conversation_id=cid) then raise exception 'Administrative cascade blocked'; end if;
  insert into phase1b_results values ('administrative conversation delete cascades through messages_immutable','PASS');
end; $$;
select test,result from phase1b_results order by test;
rollback;

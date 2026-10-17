-- Executed only inside the runner's transaction, always rolled back.
create temporary table shop_test_users as
select gen_random_uuid() owner,gen_random_uuid() other,gen_random_uuid() plain,gen_random_uuid() unverified;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'shop_profile_'||id||'@uwo.ca',case when id=u.unverified then null else clock_timestamp() end,
jsonb_build_object('username','SP_'||left(replace(id::text,'-',''),12))
from shop_test_users u cross join lateral(values(owner),(other),(plain),(unverified)) v(id);
select set_config('test.shop_owner',owner::text,true),set_config('test.shop_other',other::text,true),
set_config('test.shop_plain',plain::text,true),set_config('test.shop_unverified',unverified::text,true)
from shop_test_users;
insert into public.shops(owner_id,name,category,description,updated_at)
select id,'Foundation fixture','Electronics','Rollback-only Shop profile.', '2000-01-01'::timestamptz
from shop_test_users cross join lateral(values(owner),(other))v(id);

create function pg_temp.shop_assert(value boolean,label text) returns void language plpgsql as $$
begin if value is not true then raise exception 'Shop foundation assertion: %',label;end if;end;$$;
create function pg_temp.shop_denied(statement text,expected text) returns void language plpgsql as $$
begin
  if statement like 'update public.shops %' then
    statement := statement || ' where owner_id=' || quote_literal(current_setting('test.shop_owner')) || '::uuid';
  end if;
  begin execute statement;
  exception when others then
    if sqlstate=expected then return;end if;
    raise exception 'Expected SQLSTATE %, got %',expected,sqlstate;
  end;
  raise exception 'Shop statement unexpectedly succeeded';
end;$$;

-- Constraints are tested through a privileged path, independent of RLS denial.
select pg_temp.shop_denied('insert into public.shops(owner_id,name,category,description) values('''||current_setting('test.shop_owner')||''',''Duplicate'',''Electronics'',''Valid description'')','23505');
select pg_temp.shop_denied($q$update public.shops set name=''$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set name='   '$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set name=repeat('n',41)$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set category='Furniture'$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set description=repeat('d',201)$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set description=' '$q$,'23514');
select pg_temp.shop_assert(marketplace_private.shop_profile_text_length(U&'\0009\00A0name\FEFF')=4,'JS whitespace trim parity');
select pg_temp.shop_assert(marketplace_private.shop_profile_text_length(repeat(U&'\+01F600',20))=40,'JS UTF-16 length parity');
select pg_temp.shop_denied($q$update public.shops set name=U&'\0009\00A0'$q$,'23514');
select pg_temp.shop_denied($q$update public.shops set name=repeat(U&'\+01F600',21)$q$,'23514');
update public.shops set name=repeat('n',40),description=repeat('d',200)
where owner_id=current_setting('test.shop_owner')::uuid;
select pg_temp.shop_assert((select count(*)=0 from public.shops where owner_id=current_setting('test.shop_plain')::uuid),'no automatic provisioning');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.shop_owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.shop_assert((select count(*)=1 from public.shops),'only own row visible');
select pg_temp.shop_assert((select count(*)=0 from public.shops where owner_id=current_setting('test.shop_other')::uuid),'other row hidden');
update public.shops set name='Changed name' where owner_id=auth.uid();
update public.shops set category='Home & Living' where owner_id=auth.uid();
update public.shops set description='Changed description' where owner_id=auth.uid();
select pg_temp.shop_assert((select name='Changed name' and category='Home & Living' and description='Changed description' and updated_at>'2000-01-01'::timestamptz from public.shops),'three editable fields and timestamp trigger');
with changed as(update public.shops set name='Intruder' where owner_id=current_setting('test.shop_other')::uuid returning id)
select pg_temp.shop_assert((select count(*)=0 from changed),'other owner update cannot reach row');
select pg_temp.shop_denied($q$insert into public.shops(owner_id,name,category,description) values(auth.uid(),'Forbidden','Electronics','No creation')$q$,'42501');
select pg_temp.shop_denied('delete from public.shops','42501');
select pg_temp.shop_denied('update public.shops set owner_id=gen_random_uuid()','42501');
select pg_temp.shop_denied('update public.shops set id=gen_random_uuid()','42501');
select pg_temp.shop_denied('update public.shops set created_at=now()','42501');
select pg_temp.shop_denied('update public.shops set updated_at=now()','42501');
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.shop_plain'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.shop_assert((select count(*)=0 from public.shops),'normal user has no Shop');
select pg_temp.shop_denied($q$insert into public.shops(owner_id,name,category,description) values(auth.uid(),'Forbidden','Electronics','No creation')$q$,'42501');
reset role;
-- Even a provisioned row must not bypass verified-Western authorization.
update public.shops set owner_id=current_setting('test.shop_unverified')::uuid where owner_id=current_setting('test.shop_other')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.shop_unverified'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.shop_assert((select count(*)=0 from public.shops),'unverified owner denied');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.shop_denied('select * from public.shops','42501');
select pg_temp.shop_denied($q$insert into public.shops(name,category,description) values('Forbidden','Electronics','No creation')$q$,'42501');
reset role;

select 'PASS owner SELECT/three updates; cross-owner RLS; normal/anon INSERT/DELETE denial; immutable column ACL; constraints; owner UNIQUE; verified-Western; updated_at; rollback isolation' result;

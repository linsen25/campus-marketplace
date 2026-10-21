-- Only the disposable loopback native runner. No remote migration or data.
create function public.b13_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'B13: %',label;end if;end;$$;
create function public.b13_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
 if sqlstate=expected then return;end if;raise;
end;raise exception 'B13 unexpected success: %',statement;end;$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'b13_local_'||i||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','B13_Local_'||i)
from generate_series(71,73) i;
insert into public.shops(owner_id,name,category,description,updated_at)
select id,'Local owner Shop','Electronics','Local private description','2026-10-19T12:34:56.123456Z'
from public.profiles where username in ('B13_Local_71','B13_Local_72');
-- A historical expired membership fixture, not a Trial/grant command invocation.
insert into marketplace_private.shop_memberships(owner_id)
values('00000000-0000-4000-8000-000000000071');
begin;
insert into marketplace_private.shop_membership_commands(owner_id,action,action_id,input_digest,input,result,recorded_at)
values('00000000-0000-4000-8000-000000000071','purchase','00000000-0000-4000-8000-000000000071',repeat('0',64),'{}','{}','2020-01-01');
insert into marketplace_private.shop_membership_terms(owner_id,cycle_id,ordinal,source,tier,purchase_mode,starts_at,ends_at,base_price_cents,command_action,command_id)
values('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071',1,'paid','plus','one_month','2020-01-01','2020-02-01',999,'purchase','00000000-0000-4000-8000-000000000071');
commit;
select public.b13_assert(marketplace_private.shop_entitlements('00000000-0000-4000-8000-000000000071',clock_timestamp())->>'status'='suspended','fixture is actually suspended');
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',true);
set local role authenticated;
select public.b13_assert((select count(*)=1 from public.shops),'owner-only GET while Suspended');
update public.shops set name='Suspended edit' where owner_id=auth.uid();
select public.b13_assert((select name='Suspended edit' from public.shops),'Suspended private edit allowed');
with changed as(update public.shops set name='Intruder' where owner_id='00000000-0000-4000-8000-000000000072' returning id)
select public.b13_assert((select count(*)=0 from changed),'cross-owner denied');
select public.b13_reject('update public.shops set owner_id=gen_random_uuid()','42501');
select public.b13_reject('update public.shops set name=''''','23514');
select public.b13_reject('update public.shops set category=''Furniture''','23514');
select public.b13_reject('update public.shops set description=''''','23514');
select public.b13_reject('insert into public.shops(owner_id,name,category,description) values(auth.uid(),''New'',''Electronics'',''Description'')','42501');
rollback;
begin;
set local role anon;
select public.b13_reject('select * from public.shops','42501');
select public.b13_reject('update public.shops set name=''Anonymous''','42501');
rollback;
select public.b13_assert((select name='Local owner Shop' from public.shops where owner_id='00000000-0000-4000-8000-000000000071'),'rolled-back permission probes preserve base');

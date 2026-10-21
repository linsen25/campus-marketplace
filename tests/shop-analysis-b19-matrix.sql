-- A second disposable DB tests projection math for states unavailable through
-- currently guarded Shop transactions. Not an Order-state-machine runtime test.
-- No current business trigger is removed/disabled. Actual B17 and B19 read
-- functions run on read-shaped facts; full RLS/B12 tested in current-schema suite.
create schema auth;
create schema marketplace_private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function marketplace_private.is_western_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
create function marketplace_private.payment_mode(j jsonb) returns text language sql immutable as $$select coalesce(j->>'payment_mode','uu_pay')$$;
create function marketplace_private.shop_entitlements(o uuid,t timestamptz) returns jsonb language sql stable as $$select jsonb_build_object('canUseShopAnalytics',true,'effectiveTier','plus','status','active','nextBoundaryAt',t+interval '1 day')$$;
create table public.shops(id uuid,owner_id uuid);
insert into public.shops values('19100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002');
create table public.orders(id uuid primary key,listing_origin_id uuid,seller_origin_id uuid,accepted_at timestamptz,created_at timestamptz,reservation_ended_at timestamptz,lifecycle_status text,payment_status text,currency text,listing_snapshot jsonb,terms_snapshot jsonb,item_amount_cents bigint,order_protocol_version int);
create table public.transaction_events(order_id uuid,event_type text,created_at timestamptz);
create table marketplace_private.external_exchanges(order_id uuid,buyer_confirmed_at timestamptz,seller_confirmed_at timestamptz,disputed_at timestamptz);
create table marketplace_private.order_protection(order_id uuid,completed_at timestamptz);
create table marketplace_private.shop_order_cost_snapshots(order_id uuid primary key,listing_origin_id uuid,seller_origin_id uuid,shop_origin_id uuid,amount_cents bigint,currency text,captured_at timestamptz);
create table marketplace_private.v2_order_economics(order_id uuid primary key,item_price_cents bigint);
create table marketplace_private.shop_expenses(id uuid,shop_origin_id uuid,owner_origin_id uuid,amount_cents bigint,currency text,deleted_at timestamptz,expense_on date,category text);
create table marketplace_private.account_activity_events(id uuid primary key,owner_id uuid,shop_origin_id uuid,listing_channel_snapshot text,kind text,occurred_at timestamptz);
create function public.b19_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'B19 MATRIX: %',label;end if;end;$$;
create function public.b19_seed(i int,payment text,mode text default 'uu_pay',state text default 'completed') returns uuid language plpgsql as $$
declare oid uuid:=('19200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;t timestamptz:=statement_timestamp()-interval '1 minute';begin
 insert into public.orders values(oid,oid,'19100000-0000-4000-8000-000000000002',t-interval '1 hour',t-interval '1 hour',case when state='completed' then t else null end,state,payment,'CAD',jsonb_build_object('listingChannel','shop','currency','CAD','title','Product '||i),jsonb_build_object('terms',jsonb_build_object('payment_mode',mode)),1000,2);
 insert into marketplace_private.v2_order_economics values(oid,1000);
 insert into marketplace_private.shop_order_cost_snapshots values(oid,oid,'19100000-0000-4000-8000-000000000002','19100000-0000-4000-8000-000000000001',200,'CAD',t-interval '1 hour');
 if state='completed' then
  insert into public.transaction_events values(oid,'order_completed',t),(oid,'order_completed',t);
  if mode='external' then insert into marketplace_private.external_exchanges values(oid,t,t,null);
  else insert into marketplace_private.order_protection values(oid,t);end if;
 end if;
 return oid;
end;$$;
-- MATRIX_ASSERT
select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000002',false);
select public.b19_seed(1,'paid'),public.b19_seed(2,'pending','external'),public.b19_seed(3,'processing','uu_pay','open'),public.b19_seed(4,'failed','uu_pay','cancelled');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'sold'='2','paid and externally confirmed only; duplicate events do not multiply');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents'='2000','item revenue no processing/cancelled amount');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'estimatedProfitCents'='1600','frozen cost once per eligible sale');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'externalCents'='1000','external separated');
select public.b19_seed(5,'refunded');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents'='2000','refunded principal excluded');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'estimatedProfitCents' is null,'refund disposition unknown profit unavailable');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'excludedRefundedItemCents'='1000','excluded value not claimed executed refund');
select public.b19_seed(6,'paid');
update public.orders set currency='USD' where id='19200000-0000-4000-8000-000000000006';
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents' is null,'currency mismatch not mixed as CAD');
delete from public.orders where id='19200000-0000-4000-8000-000000000006';
select public.b19_seed(7,'paid');
delete from marketplace_private.shop_order_cost_snapshots where order_id='19200000-0000-4000-8000-000000000007';
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'missingProvenanceCount'='1','no today-Shop attribution fallback');
delete from public.orders where id='19200000-0000-4000-8000-000000000007';
select public.b19_seed(8,'pending','external');
update marketplace_private.external_exchanges set disputed_at=statement_timestamp() where order_id='19200000-0000-4000-8000-000000000008';
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents' is null,'disputed completion fact rejected');
delete from public.orders where id='19200000-0000-4000-8000-000000000008';
insert into marketplace_private.shop_expenses values(gen_random_uuid(),'19100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002',100,'CAD',null,(statement_timestamp() at time zone 'America/Toronto')::date,'Marketing'),(gen_random_uuid(),'19100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002',900,'CAD',statement_timestamp(),(statement_timestamp() at time zone 'America/Toronto')::date,'Other');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'knownExpensesCents'='500','active expenses plus eligible frozen COGS, no tombstone');
-- Bounded product payload, totals cover every eligible product.
do $$begin for i in 10..34 loop perform public.b19_seed(i,'paid');end loop;end;$$;
select public.b19_assert(jsonb_array_length(public.marketplace_shop_analysis('month')->'pro'->'products')=20,'top 20 only');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'productCount'='27','all products counted');
select public.b19_assert((select sum((x->>'cents')::bigint)=27000 from jsonb_array_elements(public.marketplace_shop_analysis('month')->'pro'->'distribution')x),'Other Products includes complete remainder');
insert into marketplace_private.account_activity_events values(gen_random_uuid(),'19100000-0000-4000-8000-000000000002','19100000-0000-4000-8000-000000000001','shop','view',statement_timestamp()-interval '1 second'),(gen_random_uuid(),'19100000-0000-4000-8000-000000000002','19100000-0000-4000-8000-000000000001','shop','shop_view',statement_timestamp()-interval '1 second'),(gen_random_uuid(),'19100000-0000-4000-8000-000000000002',null,'resale','view',statement_timestamp()-interval '1 second');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'authenticatedListingOpens'='1','Shop-only recorded view');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->'coverage'->>'authenticatedShopOpens'='1','Shop opens not featured attribution');
-- Unknown historic channel cannot be inferred from today's product/Shop.
select public.b19_seed(40,'paid');
update public.orders set listing_snapshot=listing_snapshot-'listingChannel' where id='19200000-0000-4000-8000-000000000040';
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'revenueCents' is null,'unknown channel is incomplete, never reattributed');
delete from public.orders where id='19200000-0000-4000-8000-000000000040';
-- Real expired periods/expenses cannot leak into this period.
insert into marketplace_private.shop_expenses values(gen_random_uuid(),'19100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000002',777,'CAD',null,'2001-01-01','Other');
select public.b19_assert(public.marketplace_shop_analysis('month')->'current'->>'knownExpensesCents'='5500','out-of-period expense excluded');
select public.b19_assert(extract(epoch from(('2026-03-09'::timestamp at time zone 'America/Toronto')-('2026-03-08'::timestamp at time zone 'America/Toronto')))=82800,'23h Toronto day');
select public.b19_assert(extract(epoch from(('2026-11-02'::timestamp at time zone 'America/Toronto')-('2026-11-01'::timestamp at time zone 'America/Toronto')))=90000,'25h Toronto day');
update marketplace_private.shop_expenses set amount_cents=9007199254740991 where deleted_at is null;
do $$begin begin perform public.marketplace_shop_analysis('month');exception when numeric_value_out_of_range then return;end;raise exception 'B19 overflow accepted';end;$$;

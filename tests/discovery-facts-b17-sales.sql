-- One authoritative completed Order, even though external completion has two representations.
select public.b14_assert((select count(*)=1 from marketplace_private.completed_order_facts(
 '11111111-1111-4111-8111-111111111111',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')),'one completed source row');
select public.b14_assert((select bool_and(listing_channel='shop' and shop_origin_id is null and unit_cost_cents is null
 and payment_mode='external' and payment_status<>'paid' and sale_eligible)
 from marketplace_private.completed_order_facts('11111111-1111-4111-8111-111111111111',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')),'completed external source, unknown Shop/cost, never UU Paid');
select public.b14_assert((select count(*)=2 from public.transaction_events where order_id=(select oid from public.b14_history where label='held') and event_type in('order_completed','external_exchange_completed')),'dual source events exist but not double counted');
select public.b14_assert(not exists(select 1 from marketplace_private.completed_order_facts(public.b14_owner(81),clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')),'manual Sold and no Orders is not completed sale');
select public.b14_assert(not exists(select 1 from public.orders o join public.b14_history h on h.oid=o.id where o.listing_snapshot<>h.hash),'immutable Order snapshot unchanged');
select public.b14_reject('select * from marketplace_private.completed_order_facts(gen_random_uuid(),now(),now()-interval ''1 day'')','23514');
select public.b14_assert(not has_function_privilege('anon','public.marketplace_record_listing_view(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.marketplace_record_shop_view(uuid,uuid)','EXECUTE'),'anonymous cannot persist');
select public.b14_assert(not has_function_privilege('authenticated','marketplace_private.completed_order_facts(uuid,timestamptz,timestamptz)','EXECUTE'),'no new seller analytics API');

-- Private event provenance outlives source Listing deletion. Existing Auth cleanup remains legal.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(public.b14_owner(92),'b17_viewer_92@uwo.ca',clock_timestamp(),'{"username":"B17_Viewer92"}');
select set_config('request.jwt.claim.sub',public.b14_owner(92)::text,false);
select public.marketplace_record_listing_view((select id from public.b17_ids where kind='resale'),'17300000-0000-4000-8000-000000000001');
delete from auth.users where id=public.b14_owner(92);
select public.b14_assert((select viewer_id is null and listing_channel_snapshot='resale' from marketplace_private.account_activity_events where id='17300000-0000-4000-8000-000000000001'),'Auth cleanup does not break source metadata');
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
delete from public.listings where id=(select id from public.b17_ids where kind='resale');
select public.b14_assert((select listing_channel_snapshot='resale' and shop_origin_id is null from marketplace_private.account_activity_events where id='17300000-0000-4000-8000-000000000001'),'deleted Listing fact retains verified channel');
select public.b14_assert((select count(*)>0 from public.b17_prior_activity b join marketplace_private.account_activity_events e using(id) where e.listing_channel_snapshot is null),'legacy unknown not guessed');

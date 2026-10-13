-- Invoked after rollback-only bc_people/helpers foundation. No canonical writes.
do $$declare lid uuid;begin
perform pg_temp.bc_actor((select seller from bc_people));
insert into public.listings(seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
select (select seller from bc_people),'BC rollback preference','Synthetic fulfillment permissions',8000,currency,category,subcategory,condition,pickup_area,1,clock_timestamp()
from public.listings where published_at is not null limit 1 returning id into lid;
create temporary table preference_fixture(id uuid);insert into preference_fixture values(lid);
end;$$;
grant select on preference_fixture to authenticated;
select pg_temp.bc_actor((select seller from bc_people));
set local role authenticated;
update public.listings set preferred_fulfillment='DELIVERY' where id=(select id from preference_fixture);
reset role;
select pg_temp.bc_assert((select preferred_fulfillment='DELIVERY' from public.listings where id=(select id from preference_fixture)),'Owner can edit preference');
select pg_temp.bc_actor((select outsider from bc_people));
set local role authenticated;
update public.listings set preferred_fulfillment='ON_CAMPUS' where id=(select id from preference_fixture);
reset role;
select pg_temp.bc_assert((select preferred_fulfillment='DELIVERY' from public.listings where id=(select id from preference_fixture)),'Non-owner cannot edit preference');
select pg_temp.bc_assert(not has_column_privilege('authenticated','public.listings','published_at','UPDATE'),'Publication authority unchanged');
select pg_temp.bc_actor((select seller from bc_people));
set local role authenticated;
insert into public.listings(title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,preferred_fulfillment)
select 'BC preference new','Synthetic explicit creation preference',8000,currency,category,subcategory,condition,pickup_area,1,'DELIVERY'
from public.listings where id=(select id from preference_fixture);
reset role;
select pg_temp.bc_assert(exists(select 1 from public.listings where title='BC preference new' and seller_id=(select seller from bc_people) and preferred_fulfillment='DELIVERY' and published_at is null),'Owner can create explicit preference without publication authority');

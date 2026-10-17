create temporary table aa_people as select gen_random_uuid() owner,gen_random_uuid() visitor,gen_random_uuid() lid,gen_random_uuid() event_id;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select id,'aa_'||id||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','AA_'||left(replace(id::text,'-',''),12)) from aa_people cross join lateral(values(owner),(visitor)) u(id);
create function pg_temp.aa_assert(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'Activity assertion: %',label;end if;end;$$;
create function pg_temp.aa_actor(id uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role',case when id is null then 'anon' else 'authenticated' end)::text,true);$$;
do $$declare f record;image public.listing_images;result jsonb;before_time timestamptz;n bigint;
begin
select * into f from aa_people;perform pg_temp.aa_actor(f.owner);
insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,pickup_area,expected_image_count,meeting_location)
values(f.lid,f.owner,'Analytics rollback synthetic','Synthetic',1000,'CAD','Electronics','Computers & Tablets','Campus',1,'Synthetic entrance');
insert into public.listing_images(listing_id,owner_id,slot)values(f.lid,f.owner,1)returning * into image;
insert into storage.objects(bucket_id,name,metadata)values('listing-images',image.path,'{"mimetype":"image/jpeg","size":1}');
update public.listing_images set ready=true where id=image.id;
perform public.marketplace_finalize_listing(f.lid);select published_at into before_time from public.listings where id=f.lid;
perform public.marketplace_finalize_listing(f.lid);update public.listings set description='Edited synthetic' where id=f.lid;
perform pg_temp.aa_assert((select count(*)=1 from marketplace_private.account_activity_events where listing_origin_id=f.lid and kind='listing_published'),'first publication only');
perform pg_temp.aa_assert((select published_at=before_time from public.listings where id=f.lid),'immutable publication timestamp');
perform public.marketplace_record_listing_view(f.lid,f.event_id);
perform pg_temp.aa_assert(not exists(select 1 from marketplace_private.account_activity_events where listing_origin_id=f.lid and kind='view'),'owner excluded');
perform pg_temp.aa_actor(f.visitor);perform public.marketplace_record_listing_view(f.lid,f.event_id);perform public.marketplace_record_listing_view(f.lid,f.event_id);
perform pg_temp.aa_actor(null);perform public.marketplace_record_listing_view(f.lid,gen_random_uuid());
perform pg_temp.aa_assert((select count(*)=2 from marketplace_private.account_activity_events where listing_origin_id=f.lid and kind='view'),'two opens, retry once, anonymous');
perform pg_temp.aa_actor(f.visitor);result:=public.marketplace_account_activity('7D');
perform pg_temp.aa_assert(not exists(select 1 from jsonb_array_elements(result->'points') p where (p->>'overall')::bigint<>0),'private owner aggregation');
perform pg_temp.aa_actor(f.owner);update public.listings set status='sold' where id=f.lid;update public.listings set status='sold' where id=f.lid;
perform pg_temp.aa_assert((select count(*)=1 from marketplace_private.account_activity_events where listing_origin_id=f.lid and kind='listing_sold'),'Sold once');
result:=public.marketplace_account_activity('1D');perform pg_temp.aa_assert(jsonb_array_length(result->'points')=24,'24 hours');
perform pg_temp.aa_assert((select sum((p->>'overall')::int)=4 from jsonb_array_elements(result->'points') p),'exact activity four');
result:=public.marketplace_account_activity('30D');perform pg_temp.aa_assert(jsonb_array_length(result->'points')=30,'30 days');
delete from public.listings where id=f.lid;
perform pg_temp.aa_assert((select count(*)=4 from marketplace_private.account_activity_events where listing_origin_id=f.lid),'history survives deletion');
perform pg_temp.aa_assert(not has_table_privilege('authenticated','marketplace_private.account_activity_events','SELECT'),'private ledger');
perform pg_temp.aa_assert(not has_function_privilege('anon','public.marketplace_account_activity(text)','EXECUTE'),'private aggregates');
perform pg_temp.aa_assert(has_function_privilege('anon','public.marketplace_record_listing_view(uuid,uuid)','EXECUTE'),'anonymous write boundary');
end;$$;
select 'PASS Activity rollback qualification: publication, edits, finalize, owner/visitor/anon, retry, Sold once, retained deletion history, own aggregate, grants' result;

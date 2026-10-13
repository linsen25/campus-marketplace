do $$declare o public.orders;r jsonb;cmd uuid;start timestamptz;source text;begin
foreach source in array array['carrier','buyer'] loop
o:=pg_temp.bc_paid('courier');
perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.handoff_authorizations where order_id=o.id),'Courier has no handoff codes');
perform pg_temp.bc_actor((select buyer from bc_people));
perform pg_temp.bc_reject(format('select public.marketplace_record_courier_shipment(%L,''Synthetic Carrier'',''Synthetic Tracking'',%L)',o.id,gen_random_uuid()),'42501');
perform pg_temp.bc_actor((select seller from bc_people));cmd:=gen_random_uuid();
perform public.marketplace_record_courier_shipment(o.id,'Synthetic Carrier','Synthetic Tracking',cmd);
perform public.marketplace_record_courier_shipment(o.id,'Synthetic Carrier','Synthetic Tracking',cmd);
perform pg_temp.bc_assert(not exists(select 1 from marketplace_private.order_protection where order_id=o.id),'Seller Shipped never starts Protection');
perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='courier_shipped'),'shipment event once');
perform pg_temp.bc_reject(format('select public.marketplace_record_trusted_courier_delivery(%L,''Synthetic event'')',o.id),'42501');
if source='carrier' then
perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
perform public.marketplace_record_trusted_courier_delivery(o.id,'Synthetic event '||o.id);
perform public.marketplace_record_trusted_courier_delivery(o.id,'Synthetic event '||o.id);
select started_at into start from marketplace_private.order_protection where order_id=o.id;
perform pg_temp.bc_actor((select buyer from bc_people));
perform public.marketplace_confirm_courier_received(o.id,gen_random_uuid());
else
perform pg_temp.bc_actor((select buyer from bc_people));cmd:=gen_random_uuid();
r:=public.marketplace_confirm_courier_received(o.id,cmd);
perform pg_temp.bc_assert(public.marketplace_confirm_courier_received(o.id,cmd)=r,'Buyer received idempotency');
select started_at into start from marketplace_private.order_protection where order_id=o.id;
perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
perform public.marketplace_record_trusted_courier_delivery(o.id,'Synthetic event '||o.id);
end if;
perform pg_temp.bc_assert((select started_at=start from marketplace_private.order_protection where order_id=o.id),'second trusted possession does not reset Protection');
perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='protection_started'),'Protection event once across channels');
perform pg_temp.bc_assert((select count(*)=1 from public.transaction_events where order_id=o.id and event_type='courier_delivered'),'delivered event once');
perform pg_temp.bc_actor((select outsider from bc_people));
perform pg_temp.bc_reject(format('select public.marketplace_courier_state(%L)',o.id),'42501');
end loop;
perform pg_temp.bc_assert(not has_function_privilege('authenticated','public.marketplace_record_trusted_courier_delivery(uuid,text)','EXECUTE'),'trusted provider boundary inaccessible to browser');
end;$$;

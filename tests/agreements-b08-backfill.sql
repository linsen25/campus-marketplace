-- Historical states live ONLY in temporary projection fixtures, not real Orders.
-- Execute the actual migration backfill statement with relation names rebound.
create temp table b08_legacy_orders as select * from public.orders with no data;
create temp table b08_legacy_delivery(order_id uuid);
create temp table b08_legacy_shipments(order_id uuid,shipped_at timestamptz);
create temp table b08_legacy_handoff(order_id uuid,redeemed_at timestamptz);
create temp table b08_legacy_protection(order_id uuid);
create temp table b08_legacy_agreements (like marketplace_private.order_agreements including constraints);
create temp table b08_legacy_cases(id uuid,label text,expected boolean);
do $$declare label text;base jsonb;oid uuid;begin
 select baseline into base from public.b08_orders where public.b08_orders.label='uu-pay';
 foreach label in array array['unpaid','processing','paid','refunded','paid_timestamp','closed','delivery_started','shipped','handoff','protection'] loop
  oid:=gen_random_uuid();
  insert into b08_legacy_cases values(oid,label,label not in('unpaid','processing'));
  insert into b08_legacy_orders select (jsonb_populate_record(null::public.orders,
   base||jsonb_build_object('id',oid,'lifecycle_status',case when label='closed' then 'cancelled' else 'open' end,
   'payment_status',case when label in('paid','refunded','processing') then label else 'pending' end,
   'payment_paid_at',case when label='paid_timestamp' then clock_timestamp() else null end))).*;
  if label='delivery_started' then insert into b08_legacy_delivery values(oid);end if;
  if label='shipped' then insert into b08_legacy_shipments values(oid,clock_timestamp());end if;
  if label='handoff' then insert into b08_legacy_handoff values(oid,clock_timestamp());end if;
  if label='protection' then insert into b08_legacy_protection values(oid);end if;
 end loop;
end;$$;
create temp table b08_legacy_before as select id,to_jsonb(o) payload from b08_legacy_orders o;
-- B08_EXECUTE_ACTUAL_BACKFILL
select public.b07_assert((select count(*)=10 and bool_and(a.preserved_progress=c.expected) from b08_legacy_agreements a join b08_legacy_cases c on c.id=a.order_id),'actual legacy backfill: unpaid/processing blocked, paid/refunded/closed/reached fulfillment preserved');
select public.b07_assert((select bool_and(a.terms_digest=sha256(convert_to(o.terms_snapshot::text,'UTF8'))) from b08_legacy_agreements a join b08_legacy_orders o on o.id=a.order_id),'legacy digest from unchanged full frozen snapshot');
select public.b07_assert((select bool_and(b.payload=to_jsonb(o)) from b08_legacy_orders o join b08_legacy_before b using(id)),'backfill only creates Agreement projection; historical Orders unchanged');
do $$declare code text;c record;ready boolean;begin
 select prosrc into code from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='marketplace_private' and p.proname='order_agreement_ready';
 code:=replace(replace(code,'marketplace_private.order_agreements','pg_temp.b08_legacy_agreements'),'public.orders','pg_temp.b08_legacy_orders');
 for c in select * from b08_legacy_cases loop
  execute replace(code,'p_order_id',quote_literal(c.id)||'::uuid') into ready;
  perform public.b07_assert(ready=c.expected,'backfilled readiness matches preservation: '||c.label);
 end loop;
 -- A simulated stale frozen digest in the projection cannot declare ready.
 update b08_legacy_agreements set terms_digest=decode(repeat('00',32),'hex');
 for c in select * from b08_legacy_cases loop
  execute replace(code,'p_order_id',quote_literal(c.id)||'::uuid') into ready;
  perform public.b07_assert(not ready,'digest mismatch denies readiness: '||c.label);
 end loop;
end;$$;

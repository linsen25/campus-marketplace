do $$begin
perform pg_temp.bc_assert((select provolatile='s' from pg_proc where oid='marketplace_private.normalize_delivery_area(jsonb)'::regprocedure),'area matches stable JSON constructor');
perform pg_temp.bc_assert((select provolatile='v' from pg_proc where oid='public.marketplace_delivery_checkout(uuid)'::regprocedure),'checkout server clock volatile');
perform pg_temp.bc_assert((select provolatile='v' from pg_proc where oid='public.marketplace_order_fulfillment(uuid)'::regprocedure),'fulfillment server clock volatile');
end;$$;

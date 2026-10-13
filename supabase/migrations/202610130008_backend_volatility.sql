-- Correct volatility of functions introduced/redefined in this backend pass.
-- Existing legacy order_money lint warnings are retained as separate technical debt.
begin;
alter function marketplace_private.normalize_delivery_area(jsonb) stable;
alter function marketplace_private.normalize_offer_terms(jsonb) stable;
alter function marketplace_private.normalize_checkout_address(jsonb,jsonb) stable;
alter function marketplace_private.validate_offer_terms(jsonb,timestamptz) stable;
alter function public.marketplace_delivery_checkout(uuid) volatile;
alter function public.marketplace_order_fulfillment(uuid) volatile;
commit;

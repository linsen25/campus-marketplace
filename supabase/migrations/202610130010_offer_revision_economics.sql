-- Additive V2 fee revision. Historical economics and V1 authority remain immutable.
begin;

create function marketplace_private.v2_buyer_service_fee(p_item bigint) returns bigint
language plpgsql immutable strict set search_path='' as $$
begin
 if p_item<1 or p_item>9007199254740991 then
  raise exception 'Invalid accepted item amount.' using errcode='23514';
 end if;
 -- PostgreSQL numeric round: nearest cent, half up for positive amounts.
 -- Numeric arithmetic avoids overflow and binary floating-point authority.
 return least(500,round(p_item::numeric / 100))::bigint;
end;$$;
revoke all on function marketplace_private.v2_buyer_service_fee(bigint)
from public,anon,authenticated,service_role;

alter table marketplace_private.v2_order_economics
 drop constraint v2_order_economics_buyer_service_fee_cents_check,
 drop constraint v2_order_economics_fee_rule_check;
alter table marketplace_private.v2_order_economics add constraint v2_order_economics_fee_rule_check check(
 (fee_rule='item_only_4pct_min100_max1500_v1' and buyer_service_fee_cents between 100 and 1500)
 or (fee_rule='item_only_1pct_max500_v2' and buyer_service_fee_cents between 0 and 500
 and buyer_service_fee_cents=least(500,round(item_price_cents::numeric / 100))::bigint));

create or replace function marketplace_private.freeze_v2_order_economics() returns trigger
language plpgsql security definer set search_path='' as $$
declare fee bigint;delivery bigint;total numeric;gross numeric;
begin
 if new.order_protocol_version<>2 then return new;end if;
 perform marketplace_private.validate_offer_terms(new.terms_snapshot->'terms');
 if new.terms_snapshot->'terms' is distinct from marketplace_private.normalize_offer_terms(new.terms_snapshot->'terms') then
  raise exception 'Accepted terms must be normalized.' using errcode='23514';end if;
 fee:=marketplace_private.v2_buyer_service_fee(new.item_amount_cents);
 delivery:=case when new.terms_snapshot->'terms'->>'fulfillment'='delivery'
 then (new.terms_snapshot->'terms'->>'delivery_fee_cents')::bigint else 0 end;
 gross:=new.item_amount_cents::numeric+delivery;
 total:=gross+fee;
 if total>9007199254740991 then raise exception 'Order total exceeds safe integer range.' using errcode='23514';end if;
 insert into marketplace_private.v2_order_economics values(new.id,new.item_amount_cents,delivery,fee,total::bigint,0,
 gross::bigint,'item_only_1pct_max500_v2',new.created_at);
 return new;
end;$$;

commit;

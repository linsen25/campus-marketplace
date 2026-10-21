-- B19: one owner/tier-authorized read projection. No new facts or financial writes.
begin;
create function public.marketplace_shop_analysis(p_range text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); shop uuid; membership jsonb; at_time timestamptz:=statement_timestamp();
 today date:=(statement_timestamp() at time zone 'America/Toronto')::date;
 first_day date; last_day date; begin_day date; end_day date; from_time timestamptz; until_time timestamptz;
 period integer; output jsonb[]:=array[]::jsonb[]; summary jsonb; products jsonb;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified owner required.' using errcode='42501';end if;
 if p_range not in('week','month','last-month','year') or p_range is null then
  raise exception 'Invalid analysis range.' using errcode='23514';end if;
 select id into shop from public.shops where owner_id=actor;
 if not found then raise exception 'Eligible owned Shop required.' using errcode='42501';end if;
 membership:=marketplace_private.shop_entitlements(actor,at_time);
 if not coalesce((membership->>'canUseShopAnalytics')::boolean,false) then
  raise exception 'Shop analytics entitlement required.' using errcode='42501';end if;
 if p_range='week' then first_day:=date_trunc('week',today::timestamp)::date;last_day:=first_day+7;
 elsif p_range='year' then first_day:=date_trunc('year',today::timestamp)::date;last_day:=(first_day+interval '1 year')::date;
 else first_day:=(date_trunc('month',today::timestamp)-case when p_range='last-month' then interval '1 month' else interval '0' end)::date;
  last_day:=(first_day+interval '1 month')::date;end if;
 for period in 0..1 loop
  begin_day:=first_day-case when period=1 then last_day-first_day else 0 end;
  end_day:=case when period=1 then first_day else last_day end;
  from_time:=begin_day::timestamp at time zone 'America/Toronto';
  until_time:=least(end_day::timestamp at time zone 'America/Toronto',at_time);
  with facts as materialized (
   select * from marketplace_private.completed_order_facts(actor,from_time,until_time)
  ), subjects as materialized (
   select o.*,f.sale_eligible,f.payment_mode as fact_mode,f.order_id as fact_id,
    c.amount_cents as frozen_cost,
    coalesce(o.listing_snapshot->>'listingChannel'='shop' and c.shop_origin_id=shop and c.seller_origin_id=o.seller_origin_id
      and c.listing_origin_id=o.listing_origin_id and c.captured_at=o.accepted_at,false) as attributed,
    coalesce(o.currency='CAD' and o.listing_snapshot->>'currency'='CAD'
      and (c.currency is null or c.currency='CAD'),false) as cad,
    coalesce(o.item_amount_cents between 0 and 9007199254740991
      and (o.order_protocol_version<>2 or e.item_price_cents=o.item_amount_cents),false) as amount_valid,
    (o.reservation_ended_at at time zone 'America/Toronto')::date as sale_day
   from public.orders o left join facts f on f.order_id=o.id
   left join marketplace_private.shop_order_cost_snapshots c on c.order_id=o.id
   left join marketplace_private.v2_order_economics e on e.order_id=o.id
   where o.seller_origin_id=actor and (o.listing_snapshot->>'listingChannel'='shop' or o.listing_snapshot->>'listingChannel' is null)
    and ((o.lifecycle_status='completed' and o.reservation_ended_at>=from_time and o.reservation_ended_at<until_time)
      or(o.lifecycle_status<>'completed' and o.created_at>=from_time and o.created_at<until_time))
  ), sales as materialized (
   select * from subjects where lifecycle_status='completed' and attributed and cad and amount_valid
    and fact_id is not null and sale_eligible
  ), expenses as materialized (
   select * from marketplace_private.shop_expenses where shop_origin_id=shop and owner_origin_id=actor
    and deleted_at is null and expense_on>=begin_day and expense_on<end_day and expense_on<=today
  ), views as materialized (
   select kind,(occurred_at at time zone 'America/Toronto')::date as on_day from marketplace_private.account_activity_events
   where owner_id=actor and shop_origin_id=shop and listing_channel_snapshot='shop'
    and kind in('view','shop_view') and occurred_at>=from_time and occurred_at<until_time
  ), totals as (
   select coalesce(sum(item_amount_cents),0)::numeric as revenue,
    coalesce(sum(frozen_cost),0)::numeric as cogs,
    count(*) filter(where frozen_cost is null) as missing_cost,count(*) as sold,
    coalesce(sum(item_amount_cents) filter(where fact_mode='external'),0)::numeric as external,
    coalesce(sum(item_amount_cents) filter(where fact_mode='uu_pay'),0)::numeric as uu
   from sales
  ), coverage as (
   select count(*) filter(where lifecycle_status='completed' and not attributed) as missing_source,
    count(*) filter(where lifecycle_status='completed' and not cad) as currency_mismatch,
    count(*) filter(where lifecycle_status='completed' and (not amount_valid or fact_id is null
      or(not coalesce(sale_eligible,false) and payment_status<>'refunded'))) as invalid_fact,
    count(*) filter(where lifecycle_status='completed' and payment_status='refunded') as refunded,
    coalesce(sum(item_amount_cents) filter(where lifecycle_status='completed' and attributed and cad and amount_valid and payment_status='refunded'),0)::numeric as refund_excluded,
    count(*) filter(where lifecycle_status='completed' and attributed) as completed,
    count(*) filter(where lifecycle_status='open' and attributed) as pending,
    count(*) filter(where lifecycle_status='cancelled' and attributed) as cancelled,
    count(*) filter(where lifecycle_status='expired' and attributed) as expired
   from subjects
  ), operating as (
   select coalesce(sum(amount_cents),0)::numeric as amount from expenses
  ), product_groups as (
   select listing_origin_id as id,min(coalesce(nullif(listing_snapshot->>'title',''),'Historical product')) as name,
    count(*) as sold,sum(item_amount_cents)::numeric as revenue,
    case when count(*) filter(where frozen_cost is null)>0 then null else sum(frozen_cost)::numeric end as cost
   from sales group by listing_origin_id
  ), product_list as (
   select *,row_number() over(order by revenue desc,id) as ordinal from product_groups
  ), daily as (
   select on_day,
    coalesce((select sum(item_amount_cents)::numeric from sales where sale_day=on_day),0) as revenue,
    coalesce((select sum(frozen_cost)::numeric from sales where sale_day=on_day),0)
      +coalesce((select sum(amount_cents)::numeric from expenses where expense_on=on_day),0) as expense,
    (select count(*) from sales where sale_day=on_day) as sold,
    (select count(*) from sales where sale_day=on_day and frozen_cost is null) as missing_cost
   from generate_series(0,end_day-begin_day-1) n cross join lateral(select begin_day+n as on_day) dates
  )
  select jsonb_build_object(
   'bounds',jsonb_build_object('start',begin_day,'end',end_day,'observedUntil',until_time),
   'revenueCents',case when cov.missing_source+cov.currency_mismatch+cov.invalid_fact=0 then t.revenue else null end,
   'knownExpensesCents',t.cogs+op.amount,
   'estimatedProfitCents',case when cov.missing_source+cov.currency_mismatch+cov.invalid_fact+cov.refunded+t.missing_cost=0 then t.revenue-t.cogs-op.amount else null end,
   'sold',t.sold,'missingCostCount',t.missing_cost,
   'orders',jsonb_build_object('completed',cov.completed,'pending',cov.pending,'cancelled',cov.cancelled),
   'coverage',jsonb_build_object('knownSalesCents',t.revenue,'uuPayCents',t.uu,'externalCents',t.external,
     'missingProvenanceCount',cov.missing_source,'currencyMismatchCount',cov.currency_mismatch,'invalidFactCount',cov.invalid_fact,
     'refundedCount',cov.refunded,'excludedRefundedItemCents',cov.refund_excluded,'expiredCount',cov.expired,
     'authenticatedListingOpens',(select count(*) from views where kind='view'),
     'authenticatedShopOpens',(select count(*) from views where kind='shop_view'),
     'productCount',(select count(*) from product_groups),'productLimit',20,
     'grossItemValueCents',t.revenue+cov.refund_excluded,
     'profitComplete',cov.missing_source+cov.currency_mismatch+cov.invalid_fact+cov.refunded+t.missing_cost=0),
   'breakdown',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'cents',amount) order by name),'[]') from(
     select 'Product Cost'::text as name,t.cogs as amount union all select category,sum(amount_cents)::numeric from expenses group by category
    ) x where amount>0),
   'trend',(select jsonb_agg(jsonb_build_object('date',on_day,
    'revenue',case when on_day>today or cov.missing_source+cov.currency_mismatch+cov.invalid_fact>0 then null else daily.revenue/100 end,
    'expenses',case when on_day>today then null else expense/100 end,
    'profit',case when on_day>today or cov.missing_source+cov.currency_mismatch+cov.invalid_fact+cov.refunded+daily.missing_cost>0 then null else (daily.revenue-expense)/100 end,
    'sold',case when on_day>today then null else daily.sold end,'impressions',null,'visits',null) order by on_day) from daily),
   'products',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'image','',
      'sold',sold,'revenueCents',revenue,'costCents',cost,'directExpenseCents',0,
      'profitCents',case when cov.missing_source+cov.currency_mismatch+cov.invalid_fact+cov.refunded=0 then revenue-cost else null end,
      'margin',case when revenue>0 and cost is not null and cov.missing_source+cov.currency_mismatch+cov.invalid_fact+cov.refunded=0 then (revenue-cost)*100/revenue else null end) order by ordinal),'[]') from product_list where ordinal<=20),
   'topProducts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'sold',sold) order by sold desc,id),'[]') from(select * from product_groups order by sold desc,id limit 5)x),
   'distribution',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'cents',amount) order by ordinal),'[]') from(
    select name,revenue as amount,ordinal from product_list where ordinal<=5 union all
    select 'Other Products',sum(revenue),6 from product_list where ordinal>5 having count(*)>0
   )x)
  ) into summary from totals t cross join operating op cross join coverage cov;
  -- Aggregate sums may exceed individually safe integer inputs. Never round a financial total.
  if exists(select 1 from jsonb_each(summary->'coverage') x where x.key like '%Cents'
     and abs((x.value#>>'{}')::numeric)>9007199254740991)
   or abs((summary->>'knownExpensesCents')::numeric)>9007199254740991
   or abs(coalesce((summary->>'estimatedProfitCents')::numeric,0))>9007199254740991 then
   raise exception 'Analysis amount exceeds supported precision.' using errcode='22003';end if;
  output:=array_append(output,summary);
 end loop;
 products:=output[1]->'products';
 return jsonb_build_object('source','real','timezone','America/Toronto','asOf',at_time,'range',p_range,
  'access',case when membership->>'status'='trial' then 'trial' else membership->>'effectiveTier' end,
  'membershipStatus',membership->>'status','nextBoundaryAt',membership->'nextBoundaryAt',
  'current',output[1]-'products'-'topProducts'-'distribution',
  'previous',output[2]-'products'-'topProducts'-'distribution',
  'pro',jsonb_build_object('products',products,'topProducts',output[1]->'topProducts','distribution',output[1]->'distribution',
    'featured',case when membership->>'effectiveTier'='pro' then jsonb_build_object('available',false,'reason','Promotion attribution is not collected.') else null end));
end;$$;
revoke all on function public.marketplace_shop_analysis(text) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_analysis(text) to authenticated;
commit;

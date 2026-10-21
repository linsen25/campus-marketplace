-- B18: private owner costs/expenses and atomic first-Accept cost capture only.
begin;

create table marketplace_private.shop_product_costs (
 shop_origin_id uuid not null, listing_origin_id uuid not null, owner_origin_id uuid not null,
 amount_cents bigint check(amount_cents between 0 and 9007199254740991),
 currency text not null check(currency='CAD'), revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(shop_origin_id,listing_origin_id)
);
create table marketplace_private.shop_expenses (
 id uuid primary key, shop_origin_id uuid not null, owner_origin_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 currency text not null check(currency='CAD'), expense_on date not null,
 category text not null check(category in('Packaging','Marketing','Other')),
 description text not null default '' check(char_length(description)<=500),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz, create_hash text not null
);
create index shop_expenses_owner_date on marketplace_private.shop_expenses(shop_origin_id,expense_on desc,id desc) where deleted_at is null;
create table marketplace_private.shop_order_cost_snapshots (
 order_id uuid primary key references public.orders(id) on delete restrict,
 listing_origin_id uuid not null, seller_origin_id uuid not null, shop_origin_id uuid,
 amount_cents bigint check(amount_cents between 0 and 9007199254740991),
 currency text not null check(currency='CAD'), cost_revision bigint, captured_at timestamptz not null,
 check(shop_origin_id is not null or (amount_cents is null and cost_revision is null))
);
alter table marketplace_private.shop_product_costs enable row level security;
alter table marketplace_private.shop_expenses enable row level security;
alter table marketplace_private.shop_order_cost_snapshots enable row level security;
revoke all on marketplace_private.shop_product_costs,marketplace_private.shop_expenses,marketplace_private.shop_order_cost_snapshots from public,anon,authenticated,service_role;
create policy shop_cost_owner_read on marketplace_private.shop_product_costs for select to authenticated
 using(owner_origin_id=(select auth.uid()) and (select marketplace_private.is_western_user()));
create policy shop_expense_owner_read on marketplace_private.shop_expenses for select to authenticated
 using(owner_origin_id=(select auth.uid()) and (select marketplace_private.is_western_user()));
create policy shop_order_cost_owner_read on marketplace_private.shop_order_cost_snapshots for select to authenticated
 using(seller_origin_id=(select auth.uid()) and (select marketplace_private.is_western_user()));

create function marketplace_private.shop_expense_data(e marketplace_private.shop_expenses) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',e.id,'shopId',e.shop_origin_id,'amountCents',e.amount_cents,'currency',e.currency,
 'on',e.expense_on,'kind',e.category,'description',e.description,'revision',e.revision,
 'createdAt',e.created_at,'updatedAt',e.updated_at,'deletedAt',e.deleted_at);
$$;

create function public.marketplace_shop_product_cost(p_listing_id uuid,p_change jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.shops;l public.listings;c marketplace_private.shop_product_costs;v bigint;r bigint;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified owner required.' using errcode='42501';end if;
 select * into s from public.shops where owner_id=actor for key share;
 if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
 -- Same Listing-first lock used by Accept, including the absent-cost-row race.
 select * into l from public.listings where id=p_listing_id for update;
 if not found and p_change is null then
  select * into c from marketplace_private.shop_product_costs where shop_origin_id=s.id and listing_origin_id=p_listing_id and owner_origin_id=actor;
  if found then return jsonb_build_object('listingId',p_listing_id,'shopId',s.id,'amountCents',c.amount_cents,'currency',c.currency,'revision',c.revision,'updatedAt',c.updated_at);end if;
 end if;
 if l.id is null or l.seller_id<>actor or l.listing_channel<>'shop' or l.currency<>'CAD' then
  raise exception 'Owned Shop product required.' using errcode='42501';end if;
 select * into c from marketplace_private.shop_product_costs where shop_origin_id=s.id and listing_origin_id=l.id for update;
 if p_change is not null then
  if jsonb_typeof(p_change)<>'object' or pg_column_size(p_change)>1024 then raise exception 'Invalid cost.' using errcode='23514';end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_change) k) is distinct from array['amountCents','currency','revision']::text[]
   or p_change->>'currency' is distinct from 'CAD' or jsonb_typeof(p_change->'revision') is distinct from 'number'
   or (p_change->>'revision') !~ '^[0-9]+$' then raise exception 'Invalid cost.' using errcode='23514';end if;
  if (p_change->>'revision')::numeric not between 0 and 9007199254740991 then raise exception 'Invalid revision.' using errcode='23514';end if;
  r:=(p_change->>'revision')::bigint;
  if p_change->'amountCents'<>'null'::jsonb then
   if jsonb_typeof(p_change->'amountCents') is distinct from 'number' or (p_change->>'amountCents') !~ '^[0-9]+$' then raise exception 'Invalid cost.' using errcode='23514';end if;
   if (p_change->>'amountCents')::numeric not between 0 and 9007199254740991 then raise exception 'Invalid cost.' using errcode='23514';end if;
   v:=(p_change->>'amountCents')::bigint;
  end if;
  if c.revision=r+1 and c.amount_cents is not distinct from v then null; -- committed/lost-response retry
  elsif coalesce(c.revision,0)<>r then raise exception 'Cost changed. Reload before saving.' using errcode='40001';
  elsif c.revision is null then
   insert into marketplace_private.shop_product_costs(shop_origin_id,listing_origin_id,owner_origin_id,amount_cents,currency)
   values(s.id,l.id,actor,v,'CAD') returning * into c;
  else
   update marketplace_private.shop_product_costs set amount_cents=v,revision=revision+1,updated_at=clock_timestamp()
   where shop_origin_id=s.id and listing_origin_id=l.id returning * into c;
  end if;
 end if;
 return jsonb_build_object('listingId',l.id,'shopId',s.id,'amountCents',c.amount_cents,'currency','CAD','revision',coalesce(c.revision,0),'updatedAt',c.updated_at);
end;$$;

create function public.marketplace_shop_expenses(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.shops;e marketplace_private.shop_expenses;b marketplace_private.shop_expenses;
 rows jsonb;cursor_id uuid;eid uuid;v bigint;r bigint;d date;h text;keys text[];
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified owner required.' using errcode='42501';end if;
 select * into s from public.shops where owner_id=actor for key share;
 if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or pg_column_size(p_input)>4096 then raise exception 'Invalid expense.' using errcode='23514';end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(p_input) k;
 if p_action='list' then
  if coalesce(keys,array[]::text[]) not in(array[]::text[],array['beforeId']::text[]) then raise exception 'Invalid list.' using errcode='23514';end if;
  if p_input ? 'beforeId' then
   select * into b from marketplace_private.shop_expenses where id=(p_input->>'beforeId')::uuid and owner_origin_id=actor and shop_origin_id=s.id;
   if not found then raise exception 'Expense unavailable.' using errcode='42501';end if;
  end if;
  select coalesce(jsonb_agg(marketplace_private.shop_expense_data(x) order by x.expense_on desc,x.id desc),'[]'::jsonb) into rows
  from(select * from marketplace_private.shop_expenses where owner_origin_id=actor and shop_origin_id=s.id and deleted_at is null
   and (b.id is null or (expense_on,id)<(b.expense_on,b.id)) order by expense_on desc,id desc limit 21) x;
  if jsonb_array_length(rows)>20 then cursor_id:=(rows->19->>'id')::uuid;rows:=rows-20;end if;
  return jsonb_build_object('expenses',rows,'nextCursor',cursor_id,'shopId',s.id);
 end if;
 if (p_action='create' and keys is distinct from array['amountCents','currency','description','id','kind','on']::text[])
  or (p_action='update' and keys is distinct from array['amountCents','currency','description','id','kind','on','revision']::text[])
  or (p_action='delete' and keys is distinct from array['id','revision']::text[])
  or p_action not in('create','update','delete') or p_action is null then raise exception 'Invalid expense.' using errcode='23514';end if;
 if jsonb_typeof(p_input->'id') is distinct from 'string' or p_input->>'id' is null then raise exception 'Expense ID required.' using errcode='23514';end if;
 eid:=(p_input->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('shop-expense:'||eid::text,0));
 select * into e from marketplace_private.shop_expenses where id=eid for update;
 if found and (e.owner_origin_id<>actor or e.shop_origin_id<>s.id) then raise exception 'Expense unavailable.' using errcode='42501';end if;
 if p_action<>'create' then
  if e.id is null then raise exception 'Expense unavailable.' using errcode='42501';end if;
  if jsonb_typeof(p_input->'revision') is distinct from 'number' or (p_input->>'revision') !~ '^[0-9]+$' then raise exception 'Invalid revision.' using errcode='23514';end if;
  if (p_input->>'revision')::numeric not between 1 and 9007199254740991 then raise exception 'Invalid revision.' using errcode='23514';end if;
  r:=(p_input->>'revision')::bigint;
 end if;
 if p_action='delete' then
  if e.deleted_at is not null and e.revision=r+1 then return marketplace_private.shop_expense_data(e);end if;
  if e.deleted_at is not null or e.revision<>r then raise exception 'Expense changed. Reload before saving.' using errcode='40001';end if;
  update marketplace_private.shop_expenses set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=eid returning * into e;
  return marketplace_private.shop_expense_data(e);
 end if;
 if jsonb_typeof(p_input->'amountCents') is distinct from 'number' or (p_input->>'amountCents') !~ '^[0-9]+$'
  or p_input->>'currency' is distinct from 'CAD' or jsonb_typeof(p_input->'kind') is distinct from 'string' or p_input->>'kind' not in('Packaging','Marketing','Other')
  or jsonb_typeof(p_input->'description') is distinct from 'string' or char_length(p_input->>'description')>500
  or jsonb_typeof(p_input->'on') is distinct from 'string' or (p_input->>'on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  raise exception 'Invalid expense.' using errcode='23514';end if;
 if (p_input->>'amountCents')::numeric not between 1 and 9007199254740991 then raise exception 'Invalid amount.' using errcode='23514';end if;
 v:=(p_input->>'amountCents')::bigint;d:=(p_input->>'on')::date;
 if d>(clock_timestamp() at time zone 'America/Toronto')::date then raise exception 'Expense date is in the future.' using errcode='23514';end if;
 h:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 if p_action='create' then
  if e.id is not null then
   if e.create_hash<>h then raise exception 'Expense ID reused.' using errcode='40001';end if;
   return marketplace_private.shop_expense_data(e); -- tombstones never resurrect
  end if;
  insert into marketplace_private.shop_expenses(id,shop_origin_id,owner_origin_id,amount_cents,currency,expense_on,category,description,create_hash)
  values(eid,s.id,actor,v,'CAD',d,p_input->>'kind',p_input->>'description',h) returning * into e;
 else
  if e.deleted_at is not null then raise exception 'Expense deleted.' using errcode='40001';end if;
  if e.revision=r+1 and (e.amount_cents,e.expense_on,e.category,e.description) is not distinct from (v,d,p_input->>'kind',p_input->>'description') then return marketplace_private.shop_expense_data(e);end if;
  if e.revision<>r then raise exception 'Expense changed. Reload before saving.' using errcode='40001';end if;
  update marketplace_private.shop_expenses set amount_cents=v,expense_on=d,category=p_input->>'kind',description=p_input->>'description',revision=revision+1,updated_at=clock_timestamp()
  where id=eid returning * into e;
 end if;
 return marketplace_private.shop_expense_data(e);
end;$$;

create function marketplace_private.capture_shop_order_cost() returns trigger
language plpgsql security definer set search_path='' as $$
declare l public.listings;s public.shops;c marketplace_private.shop_product_costs;
begin
 if new.listing_snapshot->>'listingChannel' is distinct from 'shop' then return new;end if;
 -- INSERT only: resolve the actual Shop now, never reattribute a historical Order.
 select * into l from public.listings where id=new.listing_id for update;
 if not found or l.id<>new.listing_origin_id or l.seller_id<>new.seller_origin_id or l.listing_channel<>'shop' or l.currency<>new.currency then
  raise exception 'Invalid cost subject.' using errcode='23514';end if;
 select * into s from public.shops where owner_id=new.seller_origin_id for key share;
 if found then
  select * into c from marketplace_private.shop_product_costs where shop_origin_id=s.id and listing_origin_id=l.id and owner_origin_id=new.seller_origin_id for share;
  if c.currency is not null and c.currency<>new.currency then raise exception 'Cost currency mismatch.' using errcode='23514';end if;
 end if;
 insert into marketplace_private.shop_order_cost_snapshots(order_id,listing_origin_id,seller_origin_id,shop_origin_id,amount_cents,currency,cost_revision,captured_at)
 values(new.id,new.listing_origin_id,new.seller_origin_id,s.id,c.amount_cents,new.currency,c.revision,new.accepted_at);
 return new;
end;$$;
create function marketplace_private.protect_shop_order_cost() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Order cost snapshots are immutable.' using errcode='42501';end;$$;
create trigger b18_capture_shop_order_cost after insert on public.orders for each row execute function marketplace_private.capture_shop_order_cost();
create trigger shop_order_cost_immutable before update or delete on marketplace_private.shop_order_cost_snapshots for each row execute function marketplace_private.protect_shop_order_cost();

revoke all on function marketplace_private.shop_expense_data(marketplace_private.shop_expenses),marketplace_private.capture_shop_order_cost(),marketplace_private.protect_shop_order_cost(),
 public.marketplace_shop_product_cost(uuid,jsonb),public.marketplace_shop_expenses(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_product_cost(uuid,jsonb),public.marketplace_shop_expenses(text,jsonb) to authenticated;
commit;

-- B32: Interac payment attestation, separate from delivery exchange and Stripe.
begin;
create table if not exists marketplace_private.interac_payment_confirmations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  buyer_reported_at timestamptz,
  buyer_reference text,
  seller_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interac_reference_length check (buyer_reference is null or length(btrim(buyer_reference)) between 1 and 120)
);
alter table marketplace_private.interac_payment_confirmations enable row level security;
revoke all on marketplace_private.interac_payment_confirmations from public, anon, authenticated, service_role;

create or replace function marketplace_private.interac_order_participant(p_order_id uuid)
returns public.orders language sql stable security definer set search_path='pg_catalog, public, marketplace_private' as $$
  select o from public.orders o where o.id=p_order_id
    and marketplace_private.is_verified_user()
    and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())
    and o.order_protocol_version=2
    and o.lifecycle_status='open'
    and o.payment_status='pending'
    and o.payment_paid_at is null
    and o.payout_status='not_eligible'
    and o.holds_listing
    and o.terms_snapshot->'terms'->>'payment_mode'='interac_etransfer';
$$;

create or replace function public.marketplace_interac_payment_state(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog, public, marketplace_private' as $$
declare o public.orders; p marketplace_private.interac_payment_confirmations;
begin
  select * into o from marketplace_private.interac_order_participant(p_order_id);
  if o.id is null then raise exception 'Interac order participant required.' using errcode='42501'; end if;
  select * into p from marketplace_private.interac_payment_confirmations where order_id=p_order_id;
  return jsonb_build_object('orderId',o.id,'mode','interac_etransfer','buyerReportedAt',p.buyer_reported_at,
    'buyerReference',case when o.buyer_id=auth.uid() or o.seller_id=auth.uid() then p.buyer_reference else null end,
    'sellerReceivedAt',p.seller_received_at,'status',case when p.seller_received_at is not null then 'receipt_confirmed'
      when p.buyer_reported_at is not null then 'payment_reported' else 'pending' end);
end; $$;

create or replace function public.marketplace_report_interac_payment(p_order_id uuid,p_reference text default null)
returns jsonb language plpgsql security definer set search_path='pg_catalog, public, marketplace_private' as $$
declare o public.orders; p marketplace_private.interac_payment_confirmations; ref text;
begin
  -- Lock the order before evaluating eligibility.  This serializes payment
  -- reports with cancellation, completion, and other order state changes.
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null
     or not coalesce(marketplace_private.is_verified_user(), false)
     or o.buyer_id<>auth.uid()
     or o.order_protocol_version<>2
     or o.lifecycle_status<>'open'
     or o.payment_status<>'pending'
     or o.payment_paid_at is not null
     or o.payout_status<>'not_eligible'
     or not o.holds_listing
     or o.terms_snapshot->'terms'->>'payment_mode' <> 'interac_etransfer' then
    raise exception 'Buyer required.' using errcode='42501';
  end if;
  ref:=nullif(btrim(coalesce(p_reference,'')),'');
  if ref is not null and length(ref)>120 then raise exception 'Reference is too long.' using errcode='22023'; end if;
  insert into marketplace_private.interac_payment_confirmations(order_id,buyer_reported_at,buyer_reference)
    values(o.id,clock_timestamp(),ref)
  on conflict(order_id) do update set buyer_reported_at=coalesce(interac_payment_confirmations.buyer_reported_at,excluded.buyer_reported_at),
    buyer_reference=coalesce(interac_payment_confirmations.buyer_reference,excluded.buyer_reference),updated_at=clock_timestamp();
  return public.marketplace_interac_payment_state(o.id);
end; $$;

create or replace function public.marketplace_confirm_interac_receipt(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog, public, marketplace_private' as $$
declare o public.orders; p marketplace_private.interac_payment_confirmations;
begin
  -- Use the same order lock as the report path so a seller receipt cannot
  -- race a cancellation, completion, or Stripe state transition.
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null
     or not coalesce(marketplace_private.is_verified_user(), false)
     or o.seller_id<>auth.uid()
     or o.order_protocol_version<>2
     or o.lifecycle_status<>'open'
     or o.payment_status<>'pending'
     or o.payment_paid_at is not null
     or o.payout_status<>'not_eligible'
     or not o.holds_listing
     or o.terms_snapshot->'terms'->>'payment_mode' <> 'interac_etransfer' then
    raise exception 'Seller required.' using errcode='42501';
  end if;
  select * into p from marketplace_private.interac_payment_confirmations where order_id=o.id for update;
  if p.order_id is null or p.buyer_reported_at is null then raise exception 'Buyer payment report required.' using errcode='23505'; end if;
  insert into marketplace_private.interac_payment_confirmations(order_id,seller_received_at)
    values(o.id,clock_timestamp()) on conflict(order_id) do update set seller_received_at=coalesce(interac_payment_confirmations.seller_received_at,excluded.seller_received_at),updated_at=clock_timestamp();
  return public.marketplace_interac_payment_state(o.id);
end; $$;

revoke all on function marketplace_private.interac_order_participant(uuid), public.marketplace_interac_payment_state(uuid), public.marketplace_report_interac_payment(uuid,text), public.marketplace_confirm_interac_receipt(uuid) from public, anon;
grant execute on function public.marketplace_interac_payment_state(uuid), public.marketplace_report_interac_payment(uuid,text), public.marketplace_confirm_interac_receipt(uuid) to authenticated;
commit;

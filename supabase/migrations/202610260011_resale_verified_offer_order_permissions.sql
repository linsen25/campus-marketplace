-- Resale Offer/Order access follows confirmed login, while transaction,
-- participant, listing, payout-readiness and financial guards remain intact.
-- This migration deliberately targets an explicit function/signature allowlist.
begin;

do $migration$
declare
  item record;
  definition text;
  actual integer;
begin
  for item in
    select v.signature::regprocedure::oid as oid,v.signature,v.expected
    from (values
      ('marketplace_private.prepare_request_protocol_identity()',1),
      -- This is a SQL SECURITY DEFINER wrapper; the authorization predicate
      -- lives in mutate_offer_revision(), which is checked separately below.
      ('marketplace_private.mutate_offer(text,uuid,jsonb,uuid,text)',0),
      ('public.marketplace_offer_history(uuid)',1),
      ('public.marketplace_offer_accept_preflight(uuid,uuid)',1),
      ('public.marketplace_accept_offer(uuid,uuid,uuid)',1),
      ('public.marketplace_cancel_order(uuid,text,text,uuid)',1),
      ('marketplace_private.mutate_offer_revision(text,uuid,jsonb,uuid,text,uuid,text)',1),
      ('public.marketplace_listing_offer_context(uuid)',1),
      ('public.marketplace_order_request_history(uuid)',1),
      ('marketplace_private.mutate_order_request(text,uuid,jsonb,uuid,text,text)',1),
      ('public.marketplace_accept_order_request(uuid,uuid)',1),
      ('public.marketplace_order_workspace(text)',1),
      ('public.marketplace_order_detail(uuid)',1)
    ) v(signature,expected)
  loop
    definition:=pg_catalog.pg_get_functiondef(item.oid);
    actual:=(length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
      / length('marketplace_private.is_western_user()');
    if actual<>item.expected then
      raise exception 'Unexpected Western predicate count for %: expected %, got %.',item.signature,item.expected,actual
        using errcode='P0001';
    end if;
    if item.expected=0 then
      if definition like '%marketplace_private.is_western_user()%' then
        raise exception 'Wrapper retained a Western predicate: %.',item.signature using errcode='P0001';
      end if;
      if item.signature='marketplace_private.mutate_offer(text,uuid,jsonb,uuid,text)'
         and definition not like '%marketplace_private.mutate_offer_revision%' then
        raise exception 'Offer wrapper no longer delegates to guarded revision function.' using errcode='P0001';
      end if;
      continue;
    end if;
    execute replace(definition,'marketplace_private.is_western_user()','marketplace_private.is_verified_user()');
    if pg_catalog.pg_get_functiondef(item.oid) like '%marketplace_private.is_western_user()%' then
      raise exception 'Resale function retained a Western predicate: %.',item.signature using errcode='P0001';
    end if;
    if pg_catalog.pg_get_functiondef(item.oid) not like '%marketplace_private.is_verified_user()%' then
      raise exception 'Resale function missing verified predicate: %.',item.signature using errcode='P0001';
    end if;
  end loop;
end;
$migration$;

-- Offer event realtime fan-out must include any confirmed account, not only
-- UWO addresses. Event actor and transaction ownership checks are unchanged.
do $migration$
declare definition text; expected text:='u.email_confirmed_at is not null and lower(u.email)~''^[^[:space:]@]+@uwo[.]ca$''';
begin
  definition:=pg_catalog.pg_get_functiondef('marketplace_private.emit_offer_event(public.order_requests,text)'::regprocedure::oid);
  if (length(definition)-length(replace(definition,expected,'')))/length(expected)<>1 then
    raise exception 'Unexpected UWO fan-out predicate count in emit_offer_event.' using errcode='P0001';
  end if;
  execute replace(definition,expected,'u.email_confirmed_at is not null');
  if pg_catalog.pg_get_functiondef('marketplace_private.emit_offer_event(public.order_requests,text)'::regprocedure::oid)
     like '%@uwo[.]ca%' then
    raise exception 'Offer event fan-out retained a UWO-only predicate.' using errcode='P0001';
  end if;
end;
$migration$;

drop policy if exists order_requests_participant_read on public.order_requests;
create policy order_requests_participant_read on public.order_requests for select to authenticated
using ((select marketplace_private.is_verified_user())
  and (buyer_id=(select auth.uid()) or seller_id=(select auth.uid())));

drop policy if exists transaction_events_participant_read on public.transaction_events;
create policy transaction_events_participant_read on public.transaction_events for select to authenticated
using ((select marketplace_private.is_verified_user()) and exists(
  select 1 from public.order_requests r
  where r.id=transaction_events.request_id
    and r.conversation_id=transaction_events.conversation_id
    and (r.buyer_id=(select auth.uid()) or r.seller_id=(select auth.uid()))));

drop policy if exists orders_participant_read on public.orders;
create policy orders_participant_read on public.orders for select to authenticated
using ((select marketplace_private.is_verified_user())
  and (buyer_id=(select auth.uid()) or seller_id=(select auth.uid())));

drop policy if exists listings_pending_participant_read on public.listings;
create policy listings_pending_participant_read on public.listings for select to authenticated
using ((select marketplace_private.is_verified_user()) and status='pending' and exists(
  select 1 from public.orders o where o.id=reserved_order_id and o.holds_listing
    and (o.buyer_id=(select auth.uid()) or o.seller_id=(select auth.uid()))));

commit;

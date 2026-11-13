-- B29-B: bounded recipient-scoped Notification filtering before pagination.
-- The original two-argument RPC remains unchanged for backwards compatibility.
begin;

create function marketplace_private.notification_category(
 p_event_type text,p_destination jsonb)
returns text language sql immutable parallel safe set search_path='' as $$
 select case
  when p_event_type in(
   'shop_trial_activated','shop_membership_access_started','shop_membership_access_upgraded',
   'shop_suspended','shop_reopened','connected_bank_payout_paid',
   'connected_bank_payout_failed','connected_bank_payout_canceled') then 'system'
  when p_event_type in(
   'order_refund_succeeded','order_refund_failed','order_refund_unresolved',
   'seller_transfer_succeeded','seller_transfer_failed','seller_transfer_unresolved',
   'seller_transfer_reversed','seller_transfer_partially_reversed') then 'order'
  when p_event_type='new_message' then 'message'
  when p_event_type='price_drop' or p_destination->>'section'='listing' then 'listing'
  when p_event_type~'^(incoming_|offer_|agreement_|payment_|seller_delivery_|handoff_|protection_|order_|cancellation_|courier_|buyer_confirm_|meetup_|reservation_|delivery_|payout_)'
   or p_destination->>'section'='orders' then 'order'
  when p_destination->>'section'='messages' then 'message'
  else 'system'
 end
$$;

create index notifications_recipient_category_newest
 on public.notifications(
  recipient_user_id,
  marketplace_private.notification_category(event_type,destination),
  created_at desc,id desc);
create index notifications_recipient_category_read_newest
 on public.notifications(
  recipient_user_id,
  marketplace_private.notification_category(event_type,destination),
  (read_at is null),created_at desc,id desc);

create function public.marketplace_notifications_filtered(
 p_before timestamptz,p_before_id uuid,p_category text,p_status text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();items jsonb;more boolean;cursor_at timestamptz;
 cursor_id uuid;cutoff timestamptz:=statement_timestamp()-interval '90 days';query text;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 if (p_before is null)<>(p_before_id is null) then
  raise exception 'Complete cursor required.' using errcode='23514';end if;
 if p_category is not null and p_category not in('message','order','listing','system') then
  raise exception 'Invalid notification category.' using errcode='23514';end if;
 if p_status is not null and p_status not in('read','unread') then
  raise exception 'Invalid notification status.' using errcode='23514';end if;

 -- Only server-selected clauses are concatenated. Every caller value remains a
 -- bound parameter, while each filter combination receives its own query plan.
 query:='with page as materialized(
  select n.id,n.event_type,n.priority,n.created_at,n.updated_at,n.read_at,n.destination,
   n.original_price_cents,n.latest_price_cents,
   row_number() over(order by n.created_at desc,n.id desc) ordinal
  from public.notifications n
  where n.recipient_user_id=$1 and n.created_at>=$2
   and($3::timestamptz is null or(n.created_at,n.id)<($3,$4))';
 if p_category is not null then
  query:=query||' and marketplace_private.notification_category(n.event_type,n.destination)=$5';
 end if;
 if p_status is not null then
  query:=query||' and ($6=''unread'')=(n.read_at is null)';
 end if;
 query:=query||' order by n.created_at desc,n.id desc limit 51)
 select coalesce(jsonb_agg(to_jsonb(page)-''ordinal'' order by created_at desc,id desc)
   filter(where ordinal<=50),''[]''::jsonb),count(*)>50,
  (array_agg(created_at) filter(where ordinal=50))[1],
  (array_agg(id) filter(where ordinal=50))[1] from page';
 execute query into items,more,cursor_at,cursor_id
  using actor,cutoff,p_before,p_before_id,p_category,p_status;

 return jsonb_build_object(
  'notifications',items,
  'unreadCount',(select count(*) from public.notifications
   where recipient_user_id=actor and read_at is null and created_at>=cutoff),
  'hasMore',more,
  'nextCursor',case when more then jsonb_build_object('before',cursor_at,'beforeId',cursor_id) else null end);
end;$$;

revoke all on function marketplace_private.notification_category(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_notifications_filtered(timestamptz,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.marketplace_notifications_filtered(timestamptz,uuid,text,text)
 to authenticated;

commit;

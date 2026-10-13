-- Additive V2 inspection receipt compatibility with frozen 1% economics.
-- Staging qualification only; historical receipts and Order economics are untouched.
begin;
alter table marketplace_private.campus_inspections
 drop constraint campus_inspections_check,
 drop constraint campus_inspections_fee_rule_check;
alter table marketplace_private.campus_inspections add constraint campus_inspections_check check(
 item_cents>=0 and total_cents=item_cents+fee_cents and total_cents<=9007199254740991
 and ((fee_rule='preview_cad_v1' and fee_cents between 100 and 1500)
 or(fee_rule='item_only_1pct_max500_v2' and item_cents>=1 and fee_cents=least(500,round(item_cents::numeric/100))::bigint))
);

create or replace function public.marketplace_confirm_campus_inspection(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;i marketplace_private.campus_inspections;m jsonb;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_inspection'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into i from marketplace_private.campus_inspections where buyer_id=auth.uid() and command=p_client_action_id;
 if found and i.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into i from marketplace_private.campus_inspections where order_id=o.id;
 if i.order_id is not null then return public.marketplace_campus_payment_state(o.id);end if;
 if not marketplace_private.meetup_mutable(o) or o.buyer_id is distinct from auth.uid() then raise exception 'Order not inspectable.' using errcode='23505';end if;
 m:=marketplace_private.v2_order_money(o.id);t:=clock_timestamp();
 insert into marketplace_private.campus_inspections values(o.id,auth.uid(),p_client_action_id,t,o.item_amount_cents,(m->>'fee')::bigint,(m->>'total')::bigint,
 case when m->>'feeRule'='item_only_1pct_max500_v2' then 'item_only_1pct_max500_v2' else 'preview_cad_v1' end);
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','buyer_inspection_confirmed',t,o.id::text||':buyer_inspection_confirmed',jsonb_build_object('orderId',o.id));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_campus_payment_state(o.id);
end;$$;
commit;

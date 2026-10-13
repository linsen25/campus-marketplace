-- Provider-independent Courier possession boundary. No real carrier integration.
begin;
create table marketplace_private.courier_shipments (
 order_id uuid primary key references public.orders(id) on delete restrict,
 state text not null default 'not_shipped' check(state in('not_shipped','shipped','delivered')),
 carrier_label text,tracking_reference text,shipped_at timestamptz,delivered_at timestamptz,
 shipment_command uuid,delivery_source text,delivery_event_key text unique,
 check((state='not_shipped')=(shipped_at is null)),
 check((state='delivered')=(delivered_at is not null)),
 check(delivered_at>=shipped_at)
);
create table marketplace_private.courier_commands (
 seller_id uuid not null,command uuid not null,order_id uuid not null references public.orders(id),
 input_digest text not null,primary key(seller_id,command)
);
alter table marketplace_private.courier_shipments enable row level security;
alter table marketplace_private.courier_commands enable row level security;
revoke all on marketplace_private.courier_shipments,marketplace_private.courier_commands from public,anon,authenticated,service_role;
do $$declare expr text;begin
select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_event_type_check';
execute 'alter table public.transaction_events drop constraint transaction_events_event_type_check';
execute 'alter table public.transaction_events add constraint transaction_events_event_type_check check(('||expr||') or event_type in(''courier_shipped'',''courier_delivered'',''buyer_confirm_received''))';
end;$$;

create function public.marketplace_record_courier_shipment(p_order_id uuid,p_carrier_label text,p_tracking_reference text,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;s marketplace_private.courier_shipments;cmd marketplace_private.courier_commands;digest text;t timestamptz;
begin
if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Seller required.' using errcode='42501';end if;
if p_client_action_id is null or p_carrier_label is null or char_length(btrim(p_carrier_label)) not between 1 and 120
or p_tracking_reference is null or char_length(btrim(p_tracking_reference)) not between 1 and 200 then raise exception 'Carrier and tracking reference required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'courier_shipment'||p_client_action_id::text,0));
select * into o from public.orders where id=p_order_id;
if o.id is null or o.seller_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Actual Courier Seller required.' using errcode='42501';end if;
digest:=encode(sha256(convert_to(jsonb_build_array(o.id,btrim(p_carrier_label),btrim(p_tracking_reference))::text,'UTF8')),'hex');
select * into cmd from marketplace_private.courier_commands where seller_id=auth.uid() and command=p_client_action_id;
if found then if cmd.input_digest<>digest then raise exception 'Command reused.' using errcode='23505';end if;return jsonb_build_object('recorded',true);end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
if o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing then raise exception 'Paid Open Courier Order required.' using errcode='23505';end if;
select * into s from marketplace_private.courier_shipments where order_id=o.id for update;
if s.order_id is not null and s.state<>'not_shipped' then raise exception 'Shipment already recorded.' using errcode='23505';end if;t:=clock_timestamp();
insert into marketplace_private.courier_shipments(order_id,state,carrier_label,tracking_reference,shipped_at,shipment_command)
values(o.id,'shipped',btrim(p_carrier_label),btrim(p_tracking_reference),t,p_client_action_id);
insert into marketplace_private.courier_commands values(auth.uid(),p_client_action_id,o.id,digest);
perform marketplace_private.emit_order_domain_event(o,'courier_shipped',t,auth.uid());
return jsonb_build_object('recorded',true);
end;$$;

create function public.marketplace_record_trusted_courier_delivery(p_order_id uuid,p_event_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;s marketplace_private.courier_shipments;t timestamptz;
begin
-- Only current staging qualification authority. A real carrier adapter must later
-- verify its webhook and map provider identity; no caller-submitted delivery clock.
if auth.jwt()->>'role' is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging authority required.' using errcode='42501';end if;
if p_event_key is null or char_length(p_event_key) not between 1 and 200 then raise exception 'Delivery event identity required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended('courier_delivery:'||p_event_key,0));
if exists(select 1 from marketplace_private.courier_shipments where delivery_event_key=p_event_key and order_id<>p_order_id) then raise exception 'Delivery event reused.' using errcode='23505';end if;
select * into o from public.orders where id=p_order_id;
if o.id is null or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Courier Order required.' using errcode='23514';end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
select * into s from marketplace_private.courier_shipments where order_id=o.id for update;
if s.state='delivered' then return jsonb_build_object('delivered',true,'deliveredAt',s.delivered_at);end if;
if o.lifecycle_status<>'open' or o.payment_status<>'paid' or s.order_id is null or s.state<>'shipped' then raise exception 'Paid shipped Order required.' using errcode='23505';end if;t:=clock_timestamp();
update marketplace_private.courier_shipments set state='delivered',delivered_at=t,delivery_source='staging_trusted_boundary',delivery_event_key=p_event_key where order_id=o.id;
perform marketplace_private.emit_order_domain_event(o,'courier_delivered',t);
perform marketplace_private.begin_order_protection(o,'courier_delivered',t);
return jsonb_build_object('delivered',true,'deliveredAt',t);
end;$$;

create table marketplace_private.buyer_receipt_commands (
 buyer_id uuid not null,command uuid not null,order_id uuid not null references public.orders(id),
 confirmed_at timestamptz not null,primary key(buyer_id,command),unique(order_id)
);
alter table marketplace_private.buyer_receipt_commands enable row level security;
revoke all on marketplace_private.buyer_receipt_commands from public,anon,authenticated,service_role;
create function public.marketplace_confirm_courier_received(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;cmd marketplace_private.buyer_receipt_commands;t timestamptz;
begin
if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'courier_received'||p_client_action_id::text,0));
select * into o from public.orders where id=p_order_id;
if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Actual Courier Buyer required.' using errcode='42501';end if;
select * into cmd from marketplace_private.buyer_receipt_commands where buyer_id=auth.uid() and command=p_client_action_id;
if found and cmd.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
perform 1 from public.listings where id=o.listing_id for update;
select * into o from public.orders where id=p_order_id for update;
select * into cmd from marketplace_private.buyer_receipt_commands where order_id=o.id;
if found then return jsonb_build_object('received',true,'confirmedAt',cmd.confirmed_at);end if;
if o.lifecycle_status<>'open' or o.payment_status<>'paid' then raise exception 'Paid Open Order required.' using errcode='23505';end if;t:=clock_timestamp();
insert into marketplace_private.buyer_receipt_commands values(auth.uid(),p_client_action_id,o.id,t);
perform marketplace_private.emit_order_domain_event(o,'buyer_confirm_received',t,auth.uid());
perform marketplace_private.begin_order_protection(o,'buyer_received',t);
return jsonb_build_object('received',true,'confirmedAt',t);
end;$$;
create function public.marketplace_courier_state(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;s marketplace_private.courier_shipments;
begin
if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
select * into o from public.orders where id=p_order_id;
if o.id is null or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) or o.terms_snapshot->'terms'->>'delivery_method' is distinct from 'courier' then raise exception 'Courier participant required.' using errcode='42501';end if;
select * into s from marketplace_private.courier_shipments where order_id=o.id;
return jsonb_build_object('state',coalesce(s.state,'not_shipped'),'carrierLabel',s.carrier_label,'trackingReference',s.tracking_reference,'shippedAt',s.shipped_at,'deliveredAt',s.delivered_at);
end;$$;
revoke all on function public.marketplace_record_courier_shipment(uuid,text,text,uuid),public.marketplace_record_trusted_courier_delivery(uuid,text),
 public.marketplace_confirm_courier_received(uuid,uuid),public.marketplace_courier_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_record_courier_shipment(uuid,text,text,uuid),public.marketplace_confirm_courier_received(uuid,uuid),public.marketplace_courier_state(uuid) to authenticated;
grant execute on function public.marketplace_record_trusted_courier_delivery(uuid,text) to service_role;
commit;

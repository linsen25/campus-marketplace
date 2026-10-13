-- Shared paid handoff authorization, trusted possession and minimum Protection hold.
begin;
create table marketplace_private.handoff_key (
 singleton boolean primary key default true check(singleton),
 secret bytea not null check(octet_length(secret)=32)
);
insert into marketplace_private.handoff_key(secret) values(extensions.gen_random_bytes(32));
create table marketplace_private.handoff_authorizations (
 order_id uuid primary key references public.orders(id) on delete restrict,
 id uuid not null unique default gen_random_uuid(),
 encrypted_credentials bytea not null,
 qr_digest bytea not null check(octet_length(qr_digest)=32),
 code_digest bytea not null check(octet_length(code_digest)=32),
 created_at timestamptz not null,
 redeemed_at timestamptz,verified_by uuid,verification_command uuid,
 numeric_window_started_at timestamptz,numeric_failures integer not null default 0 check(numeric_failures between 0 and 5),
 numeric_locked_until timestamptz,
 check(num_nonnulls(redeemed_at,verified_by,verification_command) in(0,3)),
 unique(verified_by,verification_command)
);
create table marketplace_private.order_protection (
 order_id uuid primary key references public.orders(id) on delete restrict,
 source text not null check(source in('handoff','courier_delivered','buyer_received')),
 started_at timestamptz not null,expires_at timestamptz not null,
 completed_at timestamptz,
 check(expires_at=started_at+interval '24 hours'),check(completed_at>=expires_at)
);
create table marketplace_private.protection_cases (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id) on delete restrict,
 buyer_id uuid not null,command uuid not null,reason text not null check(reason in(
 'ITEM_NOT_RECEIVED','WRONG_ITEM','MATERIALLY_NOT_AS_DESCRIBED','MISSING_AGREED_ITEM','QUALIFYING_HIDDEN_DEFECT')),
 state text not null default 'resolution_required' check(state='resolution_required'),
 opened_at timestamptz not null,unique(buyer_id,command)
);
alter table marketplace_private.handoff_key enable row level security;
alter table marketplace_private.handoff_authorizations enable row level security;
alter table marketplace_private.order_protection enable row level security;
alter table marketplace_private.protection_cases enable row level security;
revoke all on marketplace_private.handoff_key,marketplace_private.handoff_authorizations,
 marketplace_private.order_protection,marketplace_private.protection_cases from public,anon,authenticated,service_role;

-- No secret/address goes into event metadata or Realtime.
create function marketplace_private.emit_order_domain_event(o public.orders,kind text,t timestamptz,actor uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,actor,case when actor is null then 'system' when actor=o.buyer_id then 'buyer' else 'seller' end,
 kind,t,o.id::text||':'||kind,jsonb_build_object('orderId',o.id)) on conflict(transition_key) do nothing;
 perform marketplace_private.notify_order_history(o.conversation_id);
end;$$;
create function marketplace_private.create_paid_handoff() returns trigger
language plpgsql security definer set search_path='' as $$
declare key bytea;aid uuid:=gen_random_uuid();qr text;code text;n bigint;t timestamptz;
begin
 if new.order_protocol_version<>2 or new.payment_status<>'paid' or old.payment_status='paid'
 or not(new.terms_snapshot->'terms'->>'fulfillment'='on_campus' or new.terms_snapshot->'terms'->>'delivery_method'='seller_delivery') then return new;end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 qr:=encode(extensions.gen_random_bytes(32),'hex');
 loop n:=('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint;exit when n<4294000000;end loop;
 code:=lpad((n%1000000)::text,6,'0');t:=clock_timestamp();
 insert into marketplace_private.handoff_authorizations(order_id,id,encrypted_credentials,qr_digest,code_digest,created_at)
 values(new.id,aid,extensions.pgp_sym_encrypt(jsonb_build_object('qrToken',qr,'code',code)::text,encode(key,'hex'),'cipher-algo=aes256,compress-algo=0'),
 extensions.hmac(convert_to(aid::text||':qr:'||qr,'UTF8'),key,'sha256'),
 extensions.hmac(convert_to(aid::text||':code:'||code,'UTF8'),key,'sha256'),t);
 perform marketplace_private.emit_order_domain_event(new,'handoff_ready',t);
 return new;
end;$$;
create trigger orders_paid_handoff after update of payment_status on public.orders
for each row execute function marketplace_private.create_paid_handoff();

create function public.marketplace_handoff_credential(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;a marketplace_private.handoff_authorizations;key bytea;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer credential only.' using errcode='42501';end if;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 if a.order_id is null or o.lifecycle_status<>'open' or o.payment_status<>'paid' or a.redeemed_at is not null then
 return jsonb_build_object('available',false);end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 return extensions.pgp_sym_decrypt(a.encrypted_credentials,encode(key,'hex'))::jsonb||jsonb_build_object('available',true);
end;$$;

create function marketplace_private.begin_order_protection(o public.orders,p_source text,t timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if o.order_protocol_version<>2 or o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing then
 raise exception 'Paid Open possession context required.' using errcode='23514';end if;
 insert into marketplace_private.order_protection(order_id,source,started_at,expires_at)
 values(o.id,p_source,t,t+interval '24 hours') on conflict(order_id) do nothing;
 if found then perform marketplace_private.emit_order_domain_event(o,'protection_started',t);end if;
end;$$;
create function public.marketplace_verify_handoff(p_order_id uuid,p_channel text,p_credential text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.handoff_authorizations;key bytea;digest bytea;t timestamptz;fails integer;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Seller required.' using errcode='42501';end if;
 if p_client_action_id is null or p_channel is null or p_channel not in('qr','code') or p_credential is null
 or(p_channel='code' and p_credential !~ '^[0-9]{6}$') or(p_channel='qr' and p_credential !~ '^[0-9a-f]{64}$') then
 raise exception 'Valid verification channel and command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'handoff'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.seller_id is distinct from auth.uid() then raise exception 'Actual Seller required.' using errcode='42501';end if;
 if exists(select 1 from marketplace_private.handoff_authorizations where verified_by=auth.uid() and verification_command=p_client_action_id and order_id<>o.id) then raise exception 'Command reused.' using errcode='23505';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id for update;
 if a.order_id is null or o.payment_status<>'paid' then raise exception 'Paid handoff authorization required.' using errcode='23514';end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 digest:=extensions.hmac(convert_to(a.id::text||':'||p_channel||':'||p_credential,'UTF8'),key,'sha256');
 if a.redeemed_at is not null then
 if a.verified_by=auth.uid() and a.verification_command=p_client_action_id and digest=(case when p_channel='qr' then a.qr_digest else a.code_digest end) then
 return jsonb_build_object('verified',true,'confirmedAt',a.redeemed_at);end if;
 return jsonb_build_object('verified',false,'errorCode','handoff_already_redeemed');end if;
 if o.lifecycle_status<>'open' then raise exception 'Open Order required.' using errcode='23505';end if;t:=clock_timestamp();
 if p_channel='code' and a.numeric_locked_until>t then return jsonb_build_object('verified',false,'errorCode','numeric_temporarily_locked','retryAt',a.numeric_locked_until);end if;
 if digest is distinct from (case when p_channel='qr' then a.qr_digest else a.code_digest end) then
 if p_channel='code' then
 fails:=case when a.numeric_window_started_at is null or a.numeric_window_started_at<=t-interval '10 minutes' then 1 else a.numeric_failures+1 end;
 update marketplace_private.handoff_authorizations set numeric_failures=fails,
 numeric_window_started_at=case when fails=1 then t else numeric_window_started_at end,
 numeric_locked_until=case when fails>=5 then t+interval '15 minutes' else null end where order_id=o.id;
 end if;
 -- Return domain rejection rather than raise: rate-limit evidence must commit.
 return jsonb_build_object('verified',false,'errorCode','invalid_handoff_credential');end if;
 update marketplace_private.handoff_authorizations set redeemed_at=t,verified_by=auth.uid(),verification_command=p_client_action_id,
 numeric_failures=0,numeric_window_started_at=null,numeric_locked_until=null where order_id=o.id;
 perform marketplace_private.emit_order_domain_event(o,'handoff_confirmed',t,auth.uid());
 perform marketplace_private.begin_order_protection(o,'handoff',t);
 return jsonb_build_object('verified',true,'confirmedAt',t);
end;$$;

create function public.marketplace_open_protection_case(p_order_id uuid,p_reason text,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;p marketplace_private.order_protection;c marketplace_private.protection_cases;t timestamptz;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null or p_reason is null or p_reason not in('ITEM_NOT_RECEIVED','WRONG_ITEM','MATERIALLY_NOT_AS_DESCRIBED','MISSING_AGREED_ITEM','QUALIFYING_HIDDEN_DEFECT') then raise exception 'Protected reason required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'protection_case'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Actual Buyer required.' using errcode='42501';end if;
 if exists(select 1 from marketplace_private.protection_cases where buyer_id=auth.uid() and command=p_client_action_id and order_id<>o.id) then raise exception 'Command reused.' using errcode='23505';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 select * into p from marketplace_private.order_protection where order_id=o.id for update;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 if c.id is not null then
 if c.command=p_client_action_id and c.reason=p_reason then return jsonb_build_object('caseId',c.id,'state',c.state);end if;
 raise exception 'Unresolved case already exists.' using errcode='23505';end if;t:=clock_timestamp();
 if o.lifecycle_status<>'open' or p.order_id is null or p.completed_at is not null or t>=p.expires_at then raise exception 'Protection case window is not open.' using errcode='23505';end if;
 insert into marketplace_private.protection_cases(order_id,buyer_id,command,reason,opened_at) values(o.id,auth.uid(),p_client_action_id,p_reason,t) returning * into c;
 perform marketplace_private.emit_order_domain_event(o,'protection_case_opened',t,auth.uid());
 return jsonb_build_object('caseId',c.id,'state',c.state);
end;$$;

create function marketplace_private.settle_order_protection(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;p marketplace_private.order_protection;t timestamptz;
begin
 perform 1 from public.listings where id=p_listing for update;
 select * into o from public.orders where listing_id=p_listing and holds_listing and order_protocol_version=2 for update;
 if o.id is null or o.lifecycle_status<>'open' or o.payment_status<>'paid' then return;end if;
 select * into p from marketplace_private.order_protection where order_id=o.id for update;t:=clock_timestamp();
 if p.order_id is null or p.completed_at is not null or p.expires_at>t or exists(select 1 from marketplace_private.protection_cases where order_id=o.id) then return;end if;
 update marketplace_private.order_protection set completed_at=t where order_id=o.id;
 update public.orders set lifecycle_status='completed',holds_listing=false,payout_status='eligible',fulfillment_status='fulfilled',
 reservation_ended_at=t,updated_at=t where id=o.id;
 update public.listings set status='sold',reserved_order_id=null where id=o.listing_id and reserved_order_id=o.id;
end;$$;
create function public.marketplace_order_fulfillment(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;p marketplace_private.order_protection;a marketplace_private.handoff_authorizations;c marketplace_private.protection_cases;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into p from marketplace_private.order_protection where order_id=o.id;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'handoffReady',a.order_id is not null and a.redeemed_at is null and o.lifecycle_status='open',
 'handoffConfirmedAt',a.redeemed_at,'protectionStartedAt',p.started_at,'protectionExpiresAt',p.expires_at,
 'protectionCompletedAt',p.completed_at,'protectionHold',c.id is not null,'caseState',c.state,
 'payoutEligible',o.lifecycle_status='completed' and c.id is null and o.payout_status='eligible','serverTime',clock_timestamp());
end;$$;

alter table public.orders drop constraint orders_lifecycle_status_check;
alter table public.orders add constraint orders_lifecycle_status_check check(lifecycle_status in('open','expired','cancelled') or(order_protocol_version=2 and lifecycle_status='completed'));
alter table public.orders drop constraint orders_fulfillment_status_check;
alter table public.orders add constraint orders_fulfillment_status_check check(fulfillment_status in('awaiting_payment','awaiting_fulfillment') or(order_protocol_version=2 and fulfillment_status='fulfilled'));
do $$declare expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_v2_foundation';
 execute 'alter table public.orders drop constraint orders_v2_foundation';
 execute 'alter table public.orders add constraint orders_v2_foundation check(('||expr||') or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)=''object'' and lifecycle_status=''completed'' and not holds_listing and payment_status=''paid'' and payment_paid_at is not null and payout_status=''eligible'' and fulfillment_status=''fulfilled'' and money_status=''v2_pending'' and service_fee_rule_version=''not_finalized_v2'' and service_fee_amount_cents is null and total_amount_cents is null and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null and expired_at is null and cancelled_at is null and reservation_ended_at is not null))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.orders'::regclass and conname='orders_paid_inventory_check';
 execute 'alter table public.orders drop constraint orders_paid_inventory_check';
 execute 'alter table public.orders add constraint orders_paid_inventory_check check(('||expr||') or(order_protocol_version=2 and lifecycle_status=''completed'' and payment_status=''paid'' and not holds_listing))';
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_event_type_check';
 execute 'alter table public.transaction_events drop constraint transaction_events_event_type_check';
 execute 'alter table public.transaction_events add constraint transaction_events_event_type_check check(('||expr||') or event_type in(''handoff_ready'',''handoff_confirmed'',''protection_started'',''protection_case_opened'',''order_completed''))';
end;$$;

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='completed' then
 if old.payment_status<>'paid' or new.holds_listing or new.payout_status<>'eligible' or new.fulfillment_status<>'fulfilled'
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','payout_status','fulfillment_status','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.order_protection p where p.order_id=old.id and p.completed_at=new.reservation_ended_at and p.completed_at>=p.expires_at)
 or exists(select 1 from marketplace_private.protection_cases where order_id=old.id) then raise exception 'Mature unheld Protection receipt required.' using errcode='23514';end if;
 return new;end if;

 if tg_op='UPDATE' and old.order_protocol_version=2 and old.terms_snapshot->'terms'->>'fulfillment'='delivery' and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if old.payment_status not in('pending','failed') or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.expired_at=new.expired_at and
 ((c.checkout_started_at is null and c.checkout_claim_deadline_at<=new.expired_at) or c.payment_deadline_at<=new.expired_at)) then
 raise exception 'Authoritative Delivery expiry receipt required.' using errcode='23514';end if;return new;end if;
 if tg_op='UPDATE' and old.order_protocol_version=2 and old.lifecycle_status='open' and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions mr on mr.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=mr.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and mr.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

  if tg_op='UPDATE' and old.order_protocol_version=2 and new.payment_status is distinct from old.payment_status then
   if old.lifecycle_status<>'open' or new.lifecycle_status<>'open' or not old.holds_listing
    or old.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery')
    or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
      is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
    or not ((old.terms_snapshot->'terms'->>'fulfillment'='on_campus' and exists(select 1 from marketplace_private.campus_inspections where order_id=old.id)) or (old.terms_snapshot->'terms'->>'fulfillment'='delivery' and exists(select 1 from marketplace_private.delivery_checkouts c where c.order_id=old.id and c.address_frozen_at is not null and c.address_snapshot is not null)))
    or not exists(select 1 from marketplace_private.campus_payment_attempts a where a.order_id=old.id and a.status=new.payment_status
      and ((old.payment_status in('pending','failed') and new.payment_status='processing' and a.finished_at is null and auth.uid()=old.buyer_id)
        or(old.payment_status='processing' and new.payment_status in('paid','failed') and a.finished_at is not null
          and (auth.jwt()->>'role')='service_role' and (auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'
          and (new.payment_status<>'paid' or new.payment_paid_at=a.finished_at))))
    or new.fulfillment_status<>(case when new.payment_status='paid' then 'awaiting_fulfillment' else 'awaiting_payment' end)
    then raise exception 'Trusted V2 payment receipt required.' using errcode='42501';end if;return new;
  end if;
  if tg_op<>'DELETE' and new.order_protocol_version=2 then
   if tg_op='INSERT' then
    select * into r from public.order_requests where id=new.request_id;
    if r.protocol_version<>2 or r.status<>'active' or r.recipient_user_id is distinct from auth.uid()
    or new.buyer_id is distinct from r.buyer_id or new.seller_id is distinct from r.seller_id
    or new.buyer_origin_id<>r.buyer_origin_id or new.seller_origin_id<>r.seller_origin_id
    or new.listing_id<>r.listing_id or new.listing_origin_id<>r.listing_origin_id or new.conversation_id<>r.conversation_id
    or new.terms_snapshot->'terms' is distinct from r.offer_terms or new.item_amount_cents<>r.item_amount_cents
    or not exists(select 1 from marketplace_private.offer_accept_commands x where x.order_id=new.id and x.offer_id=r.id and x.actor_key=auth.uid())
    then raise exception 'Atomic recipient V2 Order required.' using errcode='42501';end if;
    return new;
   end if;
   if old.order_protocol_version<>2 then raise exception 'Order protocol immutable.' using errcode='42501';end if;
   if new.lifecycle_status='cancelled' and old.lifecycle_status='open'
    and old.payment_status in('pending','failed') and new.cancelled_by=auth.uid()
    and new.cancelled_by_role=(case when old.buyer_id=auth.uid() then 'buyer' when old.seller_id=auth.uid() then 'seller' end)
    and new.cancelled_at is not null and not new.holds_listing and new.reservation_ended_at=new.cancelled_at
    and (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
      is not distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
    then return new;end if;
   if (to_jsonb(new)-array['updated_at','buyer_id','seller_id']) is distinct from (to_jsonb(old)-array['updated_at','buyer_id','seller_id'])
    or (new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id)))
    or (new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)))
    then raise exception 'V2 Order snapshot/state immutable in C2.' using errcode='42501';end if;
   return new;
  end if;
  if tg_op='UPDATE' and new.order_protocol_version is distinct from old.order_protocol_version then
   raise exception 'Order protocol immutable.' using errcode='42501';end if;
  if tg_op='DELETE' then raise exception 'Order history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='INSERT' then
    if new.cancelled_at is not null or new.cancelled_by is not null or new.cancelled_by_role is not null or new.cancel_reason_code is not null or new.cancel_reason_label_snapshot is not null or new.cancel_note is not null then
      raise exception 'Canonical initial cancellation state required.' using errcode='23514'; end if;
    select * into r from public.order_requests where id=new.request_id;
    if not found or r.status<>'active' or auth.uid() is distinct from r.buyer_id or new.buyer_id is distinct from r.buyer_id
      or new.seller_id is distinct from r.seller_id or new.conversation_id<>r.conversation_id or new.listing_id<>r.listing_id
      or new.listing_origin_id<>r.listing_origin_id or new.buyer_origin_id<>r.buyer_origin_id or new.seller_origin_id<>r.seller_origin_id
      or new.terms_snapshot is distinct from to_jsonb(r) or new.item_amount_cents<>r.item_amount_cents
      or new.shipping_amount_cents is distinct from (case when r.fulfillment_type<>'shipping' then 0 else r.shipping_amount_cents end)
      or new.lifecycle_status<>'open' or new.holds_listing is distinct from (new.shipping_amount_cents is not null)
      or new.money_status<>(case when new.shipping_amount_cents is null then 'shipping_pending' else 'finalized' end)
      or new.service_fee_amount_cents is distinct from (marketplace_private.order_money(new.item_amount_cents,new.shipping_amount_cents)->>'fee')::bigint
      or new.total_amount_cents is distinct from (marketplace_private.order_money(new.item_amount_cents,new.shipping_amount_cents)->>'total')::bigint then
      raise exception 'Canonical Buyer Request required.' using errcode='23514'; end if;
    if new.payment_status<>'pending' or new.payment_paid_at is not null or new.payout_status<>'not_eligible' or new.fulfillment_status<>'awaiting_payment' then
      raise exception 'Canonical initial financial state required.' using errcode='23514'; end if;
    return new;
  end if;
  if new.lifecycle_status='cancelled' and old.lifecycle_status='open' then
    if old.payment_status not in('pending','failed') or old.payment_paid_at is not null
      or auth.uid() is null or (old.buyer_id is distinct from auth.uid() and old.seller_id is distinct from auth.uid())
      or new.cancelled_by is distinct from auth.uid()
      or new.cancelled_by_role is distinct from (case when old.buyer_id=auth.uid() then 'buyer' else 'seller' end)
      or new.cancelled_at is null or new.expired_at is not null or new.holds_listing
      or (old.holds_listing and (new.cancelled_at>=old.reservation_expires_at or new.reservation_ended_at is distinct from new.cancelled_at))
      or (not old.holds_listing and new.reservation_ended_at is not null)
      or (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])
        is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note']) then
      raise exception 'Invalid Order cancellation.' using errcode='23514'; end if;
    return new;
  end if;
  if new.payment_status is distinct from old.payment_status then
    if old.payment_status<>'pending' or new.payment_status<>'paid' or old.lifecycle_status<>'open'
      or new.lifecycle_status<>'open' or not old.holds_listing or old.money_status<>'finalized'
      or new.payment_paid_at is null or new.payment_paid_at>=old.reservation_expires_at
      or old.payment_paid_at is not null or new.payout_status<>'not_eligible'
      or new.fulfillment_status<>'awaiting_fulfillment'
      or (to_jsonb(new)-array['payment_status','payment_paid_at','fulfillment_status','updated_at'])
        is distinct from (to_jsonb(old)-array['payment_status','payment_paid_at','fulfillment_status','updated_at']) then
      raise exception 'Invalid financial transition.' using errcode='23514'; end if;
    return new;
  end if;
  if (to_jsonb(new)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','expired_at','buyer_id','seller_id'])
    is distinct from (to_jsonb(old)-array['lifecycle_status','holds_listing','updated_at','reservation_ended_at','expired_at','buyer_id','seller_id']) then
    raise exception 'Order identity, terms, money and deadlines are immutable.' using errcode='23514'; end if;
  if new.buyer_id is distinct from old.buyer_id and not(new.buyer_id is null and not exists(select 1 from public.profiles where id=old.buyer_id))
    or new.seller_id is distinct from old.seller_id and not(new.seller_id is null and not exists(select 1 from public.profiles where id=old.seller_id)) then
    raise exception 'Order participant cannot change.' using errcode='23514'; end if;
  if new.lifecycle_status=old.lifecycle_status then
    if (to_jsonb(new)-array['buyer_id','seller_id','updated_at']) is distinct from (to_jsonb(old)-array['buyer_id','seller_id','updated_at']) then
      raise exception 'Order lifecycle transition required.' using errcode='23514'; end if;
  elsif old.payment_status='paid' or old.lifecycle_status<>'open' or new.lifecycle_status<>'expired' or old.reservation_expires_at is null or old.reservation_expires_at>clock_timestamp() then
    raise exception 'Invalid Order transition.' using errcode='23514'; end if;
  return new;
end; $$;

create or replace function marketplace_private.protect_listing_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.status='pending' and new.status='sold' then
 if new.reserved_order_id is not null or
 (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text']) is distinct from(to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text'])
 or not exists(select 1 from public.orders o where o.id=old.reserved_order_id and o.order_protocol_version=2 and o.listing_id=old.id and o.lifecycle_status='completed' and not o.holds_listing and o.payment_status='paid' and o.payout_status='eligible') then
 raise exception 'Completed protected V2 transaction required.' using errcode='42501';end if;return new;end if;

 if tg_op<>'DELETE' and (new.status='pending' or old.status='pending') then
  if new.status='pending' then
   if old.reserved_order_id is not null and new.reserved_order_id is distinct from old.reserved_order_id
    or not exists(select 1 from public.orders o where o.id=new.reserved_order_id and o.order_protocol_version=2
    and o.listing_id=new.id and o.seller_id=new.seller_id and o.holds_listing and o.lifecycle_status='open')
    then raise exception 'Server V2 winner required.' using errcode='42501';end if;
   return new;
  end if;
  if new.status<>'available' or new.reserved_order_id is not null
   or exists(select 1 from public.orders where id=old.reserved_order_id and holds_listing)
   then raise exception 'Server V2 release required.' using errcode='42501';end if;
  return new;
 end if;
  if tg_op='DELETE' then
    if old.reserved_order_id is not null then raise exception 'Reserved inventory cannot be deleted.' using errcode='23514'; end if;
    return old;
  end if;
  -- Stored generated columns are unset in NEW during BEFORE triggers.
  if old.reserved_order_id is not null and (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text'])
    is distinct from (to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text']) then
    raise exception 'Reserved inventory cannot be edited.' using errcode='23514'; end if;
  if new.status='reserved' then
    if not exists(select 1 from public.orders o where o.id=new.reserved_order_id and o.listing_id=new.id
      and o.holds_listing and o.lifecycle_status='open' and o.seller_id=new.seller_id) then
      raise exception 'Server Order inventory claim required.' using errcode='23514'; end if;
    if old.reserved_order_id is not null and new.reserved_order_id<>old.reserved_order_id then
      raise exception 'Cannot reassign a reservation.' using errcode='23514'; end if;
  elsif old.reserved_order_id is not null then
    if new.status<>'available' or new.reserved_order_id is not null or exists(select 1 from public.orders where id=old.reserved_order_id and holds_listing) then
      raise exception 'Server reservation release required.' using errcode='23514'; end if;
  elsif new.reserved_order_id is not null then raise exception 'Invalid inventory pointer.' using errcode='23514'; end if;
  return new;
end; $$;

create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' and new.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
 values(new.conversation_id,new.request_id,new.id,'system','reservation_expired',new.expired_at,new.id::text||':reservation_expired',jsonb_build_object('orderId',new.id));
 perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
 select new.conversation_id,new.request_id,new.id,'system','order_no_show_expired',new.expired_at,new.id::text||':order_no_show_expired',
 jsonb_build_object('orderId',new.id,'confirmedRevisionId',e.confirmed_id,'graceDeadline',e.deadline,'reason','Meetup was not completed within the allowed grace period.') from marketplace_private.meetup_expiries e where e.order_id=new.id;
 perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
  if tg_op='INSERT' then kind:='order_created'; happened:=new.created_at;
  elsif new.payment_status='paid' and old.payment_status<>'paid' then kind:='payment_paid'; happened:=new.payment_paid_at;
  elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
  elsif new.lifecycle_status='completed' then kind:='order_completed';happened:=new.reservation_ended_at;
  elsif new.lifecycle_status='cancelled' then kind:='order_cancelled'; happened:=new.cancelled_at;
  else kind:='reservation_expired'; happened:=new.expired_at; end if;
  insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
    values(new.conversation_id,new.request_id,new.id,
      case when kind='order_cancelled' then new.cancelled_by when kind='order_created' then auth.uid() when kind='payment_paid' then new.buyer_id end,
      case when kind='order_cancelled' then new.cancelled_by_role when kind='order_created' then case when auth.uid()=new.buyer_id then 'buyer' else 'seller' end when kind='payment_paid' then 'buyer' else 'system' end,
      kind,happened,new.id::text||':'||kind,jsonb_build_object('orderId',new.id)||
      case when kind='payment_paid' then jsonb_build_object('source','staging_simulator')
        when kind='order_cancelled' then jsonb_build_object('reasonCode',new.cancel_reason_code,'reason',new.cancel_reason_label_snapshot,'note',new.cancel_note)
        else '{}'::jsonb end);
  perform marketplace_private.notify_order_history(new.conversation_id);
  return new;
end; $$;

revoke all on function marketplace_private.emit_order_domain_event(public.orders,text,timestamptz,uuid),
 marketplace_private.create_paid_handoff(),marketplace_private.begin_order_protection(public.orders,text,timestamptz),
 marketplace_private.settle_order_protection(uuid) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_handoff_credential(uuid),public.marketplace_verify_handoff(uuid,text,text,uuid),
 public.marketplace_open_protection_case(uuid,text,uuid),public.marketplace_order_fulfillment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_handoff_credential(uuid),public.marketplace_verify_handoff(uuid,text,text,uuid),
 public.marketplace_open_protection_case(uuid,text,uuid),public.marketplace_order_fulfillment(uuid) to authenticated;
commit;

-- Staging: mutual confirmation of immutable Order terms and short-lived handoff QR.
begin;

create table marketplace_private.order_agreements (
 order_id uuid primary key references public.orders(id) on delete cascade,
 terms_digest bytea not null check(octet_length(terms_digest)=32),
 buyer_confirmed_at timestamptz,
 seller_confirmed_at timestamptz,
 preserved_progress boolean not null default false
);
alter table marketplace_private.order_agreements enable row level security;
revoke all on marketplace_private.order_agreements from public,anon,authenticated,service_role;

-- Preserve reached progress deterministically; every other unpaid V2 Order needs both actors.
insert into marketplace_private.order_agreements(order_id,terms_digest,preserved_progress)
select o.id,sha256(convert_to(o.terms_snapshot::text,'UTF8')),
 o.lifecycle_status<>'open' or o.payment_status in('paid','refunded') or o.payment_paid_at is not null
 or exists(select 1 from marketplace_private.seller_delivery_starts d where d.order_id=o.id)
 or exists(select 1 from marketplace_private.courier_shipments s where s.order_id=o.id and s.shipped_at is not null)
 or exists(select 1 from marketplace_private.handoff_authorizations h where h.order_id=o.id and h.redeemed_at is not null)
 or exists(select 1 from marketplace_private.order_protection p where p.order_id=o.id)
from public.orders o where o.order_protocol_version=2;

create function marketplace_private.create_order_agreement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.order_protocol_version=2 then
  insert into marketplace_private.order_agreements(order_id,terms_digest)
  values(new.id,sha256(convert_to(new.terms_snapshot::text,'UTF8')));
 end if;
 return new;
end;$$;
create trigger orders_agreement_created after insert on public.orders
for each row execute function marketplace_private.create_order_agreement();

create function marketplace_private.order_agreement_ready(p_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select a.preserved_progress or (a.buyer_confirmed_at is not null and a.seller_confirmed_at is not null)
 from marketplace_private.order_agreements a join public.orders o on o.id=a.order_id
 where a.order_id=p_order_id and a.terms_digest=sha256(convert_to(o.terms_snapshot::text,'UTF8'))),false);
$$;

create function public.marketplace_order_agreement(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;a marketplace_private.order_agreements;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or (auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into a from marketplace_private.order_agreements where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'buyerConfirmedAt',a.buyer_confirmed_at,'sellerConfirmedAt',a.seller_confirmed_at,
 'preservedProgress',coalesce(a.preserved_progress,false),'complete',marketplace_private.order_agreement_ready(o.id),'serverTime',clock_timestamp());
end;$$;

create function public.marketplace_confirm_order_agreement(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.order_agreements;t timestamptz;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or (auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id) then raise exception 'Order participant required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
 if o.lifecycle_status<>'open' then raise exception 'Open Order required.' using errcode='23505';end if;
 select * into a from marketplace_private.order_agreements where order_id=o.id for update;
 if a.order_id is null or a.terms_digest is distinct from sha256(convert_to(o.terms_snapshot::text,'UTF8')) then raise exception 'Frozen Agreement required.' using errcode='23514';end if;
 if not a.preserved_progress then
  t:=clock_timestamp();
  if auth.uid()=o.buyer_id and a.buyer_confirmed_at is null then
   update marketplace_private.order_agreements set buyer_confirmed_at=t where order_id=o.id;
  elsif auth.uid()=o.seller_id and a.seller_confirmed_at is null then
   update marketplace_private.order_agreements set seller_confirmed_at=t where order_id=o.id;
  end if;
  perform marketplace_private.notify_order_history(o.conversation_id);
 end if;
 return public.marketplace_order_agreement(o.id);
end;$$;

-- Defense in depth, including already-processing unpaid Orders at adoption time.
-- An accepted cancellation intent must still be allowed to settle a late payment.
create function marketplace_private.guard_agreement_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.order_protocol_version=2 and new.payment_status is distinct from old.payment_status
 and new.payment_status in('processing','paid') and not marketplace_private.order_agreement_ready(new.id)
 and not exists(select 1 from marketplace_private.order_cancellation_intents where order_id=new.id) then
  raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';
 end if;
 return new;
end;$$;
create trigger orders_agreement_payment before update of payment_status on public.orders
for each row execute function marketplace_private.guard_agreement_payment();

alter table marketplace_private.handoff_authorizations
 add column qr_issued_at timestamptz,
 add column qr_expires_at timestamptz,
 add column qr_issue_command uuid,
 add constraint handoff_qr_lifetime check(
  (num_nonnulls(qr_issued_at,qr_expires_at,qr_issue_command)=0)
  or (num_nonnulls(qr_issued_at,qr_expires_at,qr_issue_command)=3 and qr_expires_at=qr_issued_at+interval '60 seconds'));
create table marketplace_private.handoff_qr_commands (
 buyer_id uuid not null,
 command uuid not null,
 order_id uuid not null references marketplace_private.handoff_authorizations(order_id) on delete cascade,
 primary key(buyer_id,command)
);
alter table marketplace_private.handoff_qr_commands enable row level security;
revoke all on marketplace_private.handoff_qr_commands from public,anon,authenticated,service_role;

create function public.marketplace_generate_handoff_qr(p_order_id uuid,p_client_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;a marketplace_private.handoff_authorizations;k bytea;v jsonb;qr text;t timestamptz;cmd marketplace_private.handoff_qr_commands;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'handoff_qr'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 then raise exception 'Buyer credential only.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 perform marketplace_private.assert_order_progression(o);
 if o.lifecycle_status<>'open' or o.payment_status<>'paid' or not o.holds_listing
 or o.terms_snapshot->'terms'->>'delivery_method'='courier' then raise exception 'Paid handoff authorization required.' using errcode='23514';end if;
 if o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery' and not exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id) then raise exception 'Start Seller Delivery before handoff.' using errcode='23505';end if;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id for update;
 if a.order_id is null or a.redeemed_at is not null then raise exception 'Open handoff authorization required.' using errcode='23505';end if;
 select * into cmd from marketplace_private.handoff_qr_commands where buyer_id=auth.uid() and command=p_client_action_id;
 if found and (cmd.order_id<>o.id or a.qr_issue_command is distinct from p_client_action_id) then raise exception 'Command reused.' using errcode='23505';end if;
 select secret into k from marketplace_private.handoff_key where singleton;
 v:=extensions.pgp_sym_decrypt(a.encrypted_credentials,encode(k,'hex'))::jsonb;
 if cmd.command is null then
  qr:=encode(extensions.gen_random_bytes(32),'hex');t:=clock_timestamp();
  v:=jsonb_set(v,'{qrToken}',to_jsonb(qr));
  update marketplace_private.handoff_authorizations set
   encrypted_credentials=extensions.pgp_sym_encrypt(v::text,encode(k,'hex'),'cipher-algo=aes256,compress-algo=0'),
   qr_digest=extensions.hmac(convert_to(a.id::text||':qr:'||qr,'UTF8'),k,'sha256'),
   qr_issued_at=t,qr_expires_at=t+interval '60 seconds',qr_issue_command=p_client_action_id
  where order_id=o.id returning * into a;
  insert into marketplace_private.handoff_qr_commands values(auth.uid(),p_client_action_id,o.id);
 end if;
 return jsonb_build_object('available',true,'qrToken',v->>'qrToken','expiresAt',a.qr_expires_at,'serverTime',clock_timestamp());
end;$$;

revoke all on function marketplace_private.create_order_agreement(),marketplace_private.order_agreement_ready(uuid),
 marketplace_private.guard_agreement_payment() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_agreement(uuid),public.marketplace_confirm_order_agreement(uuid),
 public.marketplace_generate_handoff_qr(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_agreement(uuid),public.marketplace_confirm_order_agreement(uuid),
 public.marketplace_generate_handoff_qr(uuid,uuid) to authenticated;

-- Existing RPC definitions are extended below; their prior fences and grants remain.

CREATE OR REPLACE FUNCTION public.marketplace_start_order_payment(p_order_id uuid, p_client_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;l public.listings;a marketplace_private.campus_payment_attempts;method text;t timestamptz;begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 if p_client_action_id is null then raise exception 'Command required.' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'campus_payment'||p_client_action_id::text,0));
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() or o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' not in('on_campus','delivery') then raise exception 'Buyer On Campus Order required.' using errcode='42501';end if;
 select * into a from marketplace_private.campus_payment_attempts where buyer_id=auth.uid() and command=p_client_action_id;
 if found and a.order_id<>o.id then raise exception 'Command reused.' using errcode='23505';end if;
 -- Match legacy V1 capability -> Listing -> Order, including stale V1 retries on a reused Listing.
 perform marketplace_private.lock_financial_capability(auth.uid(),'payment_method');
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.order_agreement_ready(o.id) then raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';end if;
 perform marketplace_private.assert_order_progression(o);
 select * into l from public.listings where id=o.listing_id;
 if a.id is not null then return jsonb_build_object('attemptId',a.id,'status',a.status);end if;
 -- A browser restart may lose its command. Reconcile the existing protected attempt,
 -- never create another attempt or require a new payment-method authorization.
 if o.lifecycle_status='open' and o.holds_listing and o.payment_status='processing' and o.buyer_id=auth.uid() then
  select * into a from marketplace_private.campus_payment_attempts where order_id=o.id and buyer_id=auth.uid() and status='processing';
  if a.id is null then raise exception 'Protected attempt missing.' using errcode='23514';end if;
  return jsonb_build_object('attemptId',a.id,'status',a.status);
 end if;
 if o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending' or l.reserved_order_id is distinct from o.id or o.payment_status not in('pending','failed')
 or o.buyer_id is distinct from auth.uid() then raise exception 'Order not payment ready.' using errcode='23505';end if;
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 perform 1 from marketplace_private.delivery_checkouts where order_id=o.id and checkout_started_at is not null and payment_deadline_at>clock_timestamp() and address_snapshot is not null for update;
 if not found then raise exception 'Valid checkout and matching private address required.' using errcode='23514';end if;
 end if;
 perform marketplace_private.v2_order_money(o.id);
 -- Capability is rechecked at actual payment initiation, before fulfillment.
 select status into method from marketplace_private.financial_capabilities where user_id=auth.uid() and capability='payment_method' for update;
 if method is distinct from 'set' then return jsonb_build_object('errorCode','buyer_payment_method_not_ready');end if;
 t:=clock_timestamp();
 if o.terms_snapshot->'terms'->>'fulfillment'='delivery' then
 update marketplace_private.delivery_checkouts set address_frozen_at=coalesce(address_frozen_at,t) where order_id=o.id;
 end if;
 insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at) values(o.id,auth.uid(),p_client_action_id,'processing',t) returning * into a;
 update public.orders set payment_status='processing',updated_at=t where id=o.id;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,auth.uid(),'buyer','payment_started',t,a.id::text||':payment_started',jsonb_build_object('orderId',o.id,'source','staging_simulator'));
 perform marketplace_private.notify_order_history(o.conversation_id);
 return jsonb_build_object('attemptId',a.id,'status',a.status);
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketplace_start_delivery_checkout(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;c marketplace_private.delivery_checkouts;t timestamptz;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer Order required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.order_agreement_ready(o.id) then raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';end if;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id for update;
 if c.order_id is null then raise exception 'Delivery Order required.' using errcode='23514';end if;
 if o.lifecycle_status<>'open' or not o.holds_listing then raise exception 'Order is no longer open.' using errcode='23505';end if;
 if c.checkout_started_at is not null then return public.marketplace_delivery_checkout(o.id);end if;
 t:=clock_timestamp();
 if c.checkout_claim_deadline_at<=t then raise exception 'Checkout claim deadline passed.' using errcode='23505';end if;
 update marketplace_private.delivery_checkouts set checkout_started_at=t,payment_deadline_at=t+interval '30 minutes' where order_id=o.id;
 perform marketplace_private.notify_order_history(o.conversation_id);
 return public.marketplace_delivery_checkout(o.id);
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketplace_save_delivery_address(p_order_id uuid, p_address jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;c marketplace_private.delivery_checkouts;v jsonb;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer Order required.' using errcode='42501';end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.order_agreement_ready(o.id) then raise exception 'Both participants must confirm the Order Agreement.' using errcode='23514';end if;
 select * into c from marketplace_private.delivery_checkouts where order_id=o.id for update;
 if c.order_id is null or c.checkout_started_at is null then raise exception 'Start Delivery checkout first.' using errcode='23514';end if;
 if o.lifecycle_status<>'open' or o.payment_status not in('pending','failed') or c.address_frozen_at is not null or c.payment_deadline_at<=clock_timestamp() then
 raise exception 'Address cannot be edited after payment starts or checkout expires.' using errcode='23505';end if;
 v:=marketplace_private.normalize_checkout_address(p_address,o.terms_snapshot->'terms'->'delivery_area');
 update marketplace_private.delivery_checkouts set address_snapshot=v where order_id=o.id;
 -- No exact address in transaction events, notifications, or Realtime.
 return public.marketplace_delivery_checkout(o.id);
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketplace_verify_handoff(p_order_id uuid, p_channel text, p_credential text, p_client_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 perform marketplace_private.assert_order_progression(o);
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id for update;
 if a.order_id is null or o.payment_status<>'paid' then raise exception 'Paid handoff authorization required.' using errcode='23514';end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 digest:=extensions.hmac(convert_to(a.id::text||':'||p_channel||':'||p_credential,'UTF8'),key,'sha256');
 if a.redeemed_at is not null then
 if a.verified_by=auth.uid() and a.verification_command=p_client_action_id and digest=(case when p_channel='qr' then a.qr_digest else a.code_digest end) then
 return jsonb_build_object('verified',true,'confirmedAt',a.redeemed_at);end if;
 return jsonb_build_object('verified',false,'errorCode','handoff_already_redeemed');end if;
 if o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery'
 and not exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id) then
 raise exception 'Start Seller Delivery before handoff.' using errcode='23505';end if;
 if o.lifecycle_status<>'open' then raise exception 'Open Order required.' using errcode='23505';end if;t:=clock_timestamp();
 if p_channel='code' and a.numeric_locked_until>t then return jsonb_build_object('verified',false,'errorCode','numeric_temporarily_locked','retryAt',a.numeric_locked_until);end if;
 if p_channel='qr' and digest=a.qr_digest and (a.qr_expires_at is null or a.qr_expires_at<=t) then return jsonb_build_object('verified',false,'errorCode','qr_expired');end if;
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
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketplace_handoff_credential(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;a marketplace_private.handoff_authorizations;key bytea;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified Buyer required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.buyer_id is distinct from auth.uid() then raise exception 'Buyer credential only.' using errcode='42501';end if;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 if a.order_id is null or o.lifecycle_status<>'open' or o.payment_status<>'paid' or a.redeemed_at is not null or not marketplace_private.order_progression_allowed(o) then
 return jsonb_build_object('available',false);end if;
 select secret into key from marketplace_private.handoff_key where singleton;
 if o.terms_snapshot->'terms'->>'delivery_method'='seller_delivery' and not exists(select 1 from marketplace_private.seller_delivery_starts where order_id=o.id) then return jsonb_build_object('available',false);end if;
 return jsonb_build_object('available',true,'code',(extensions.pgp_sym_decrypt(a.encrypted_credentials,encode(key,'hex'))::jsonb)->>'code');
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketplace_order_fulfillment(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders;p marketplace_private.order_protection;a marketplace_private.handoff_authorizations;c marketplace_private.protection_cases;
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified participant required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or o.order_protocol_version<>2 or(o.buyer_id is distinct from auth.uid() and o.seller_id is distinct from auth.uid()) then raise exception 'Order participant required.' using errcode='42501';end if;
 select * into p from marketplace_private.order_protection where order_id=o.id;
 select * into a from marketplace_private.handoff_authorizations where order_id=o.id;
 select * into c from marketplace_private.protection_cases where order_id=o.id;
 return jsonb_build_object('agreement',public.marketplace_order_agreement(o.id),'orderId',o.id,'handoffReady',a.order_id is not null and a.redeemed_at is null and o.lifecycle_status='open' and marketplace_private.order_progression_allowed(o),
 'deliveryStartedAt',(select started_at from marketplace_private.seller_delivery_starts where order_id=o.id),
 'cancellation',public.marketplace_order_cancellation_state(o.id),
 'handoffConfirmedAt',a.redeemed_at,'protectionStartedAt',p.started_at,'protectionExpiresAt',p.expires_at,
 'protectionCompletedAt',p.completed_at,'protectionHold',c.id is not null,'caseState',c.state,
 'payoutEligible',o.lifecycle_status='completed' and c.id is null and o.payout_status='eligible','serverTime',clock_timestamp());
end;$function$
;

commit;

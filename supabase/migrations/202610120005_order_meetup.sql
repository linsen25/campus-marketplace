-- V2-D1 On Campus only, staging pcaqxezdfxofysghssyo. No D2/payment/handoff.
begin;
create table public.order_meetup_revisions(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),revision bigint not null check(revision>=0),
 base_confirmed_id uuid references public.order_meetup_revisions(id),location text not null check(char_length(location) between 1 and 120 and location=btrim(location)),
 scheduled_at timestamptz not null check(isfinite(scheduled_at)),note text not null default '' check(char_length(note)<=1000),
 status text not null check(status in('pending','confirmed','declined','withdrawn','superseded','closed')),
 proposed_by uuid,proposed_at timestamptz not null,decided_by uuid,decided_at timestamptz,unique(order_id,revision),
 check((revision=0 and base_confirmed_id is null and status='confirmed' and proposed_by is null and decided_by is null and decided_at=proposed_at)
 or(revision>0 and base_confirmed_id is not null and proposed_by is not null and((status='pending' and decided_by is null and decided_at is null)
 or(status<>'pending' and decided_at is not null and decided_at>=proposed_at)))));
create unique index order_meetup_one_pending on public.order_meetup_revisions(order_id) where status='pending';
create index order_meetup_confirmed on public.order_meetup_revisions(order_id,revision desc) where status='confirmed';
alter table public.order_meetup_revisions enable row level security;
revoke all on public.order_meetup_revisions from public,anon,authenticated,service_role;
grant select on public.order_meetup_revisions to authenticated;
create policy order_meetup_participant_read on public.order_meetup_revisions for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
create table marketplace_private.meetup_commands(actor uuid not null,command uuid not null,order_id uuid not null references public.orders(id),
 action text not null check(action in('propose','confirm','decline','withdraw')),digest text not null,
 revision_id uuid not null references public.order_meetup_revisions(id) deferrable initially deferred,result jsonb,primary key(actor,command));
create table marketplace_private.meetup_expiries(order_id uuid primary key references public.orders(id),confirmed_id uuid not null references public.order_meetup_revisions(id),
 deadline timestamptz not null,settled_at timestamptz not null check(settled_at>=deadline));
alter table marketplace_private.meetup_commands enable row level security;
alter table marketplace_private.meetup_expiries enable row level security;
revoke all on marketplace_private.meetup_commands,marketplace_private.meetup_expiries from public,anon,authenticated,service_role;
create function marketplace_private.meetup_mutable(o public.orders) returns boolean language sql immutable set search_path='' as $$
 select o.order_protocol_version=2 and o.terms_snapshot->'terms'->>'fulfillment'='on_campus' and o.lifecycle_status='open'
 and o.holds_listing and o.payment_status in('pending','failed') and o.payment_paid_at is null and o.fulfillment_status='awaiting_payment';$$;
create function marketplace_private.validate_meetup(v jsonb,t timestamptz) returns void language plpgsql set search_path='' as $$
declare s timestamptz;local_time timestamp;begin
 if v is null or jsonb_typeof(v)<>'object' or(v-array['location','scheduled_at','note'])<>'{}'::jsonb
 or jsonb_typeof(v->'location') is distinct from 'string' or char_length(btrim(v->>'location')) not between 1 and 120
 or jsonb_typeof(v->'scheduled_at') is distinct from 'string' or(v->>'scheduled_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
 or(v ? 'note' and jsonb_typeof(v->'note') is distinct from 'string') or char_length(coalesce(v->>'note',''))>1000
 then raise exception 'Invalid meetup fields.' using errcode='23514';end if;
 s:=(v->>'scheduled_at')::timestamptz;local_time:=s at time zone 'America/Toronto';
 if not isfinite(s) or extract(minute from local_time)::integer%15<>0 or extract(second from local_time)<>0
 or s<t+interval '60 minutes' or s>((t at time zone 'America/Toronto')+interval '30 days') at time zone 'America/Toronto'
 then raise exception 'Choose a 15-minute time 60 minutes to 30 days ahead.' using errcode='23514';end if;
end;$$;
create function marketplace_private.protect_meetup_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders;begin
 if tg_op='DELETE' then raise exception 'Meetup history immutable.' using errcode='23514';end if;
 select * into o from public.orders where id=new.order_id;
 if o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'V2 On Campus required.' using errcode='23514';end if;
 if tg_op='INSERT' then
  if new.revision=0 then
   if new.location is distinct from btrim(o.terms_snapshot->'terms'->>'meetup_location') or new.scheduled_at is distinct from(o.terms_snapshot->'terms'->>'scheduled_at')::timestamptz
   or new.note is distinct from coalesce(o.terms_snapshot->'terms'->>'note','') or new.proposed_at is distinct from o.accepted_at
   then raise exception 'Initial schedule must equal accepted terms.' using errcode='23514';end if;
  elsif not marketplace_private.meetup_mutable(o) or new.status<>'pending' or new.proposed_by is distinct from auth.uid()
   or not exists(select 1 from marketplace_private.meetup_commands c where c.order_id=o.id and c.revision_id=new.id and c.actor=auth.uid() and c.action='propose')
   or new.base_confirmed_id is distinct from(select id from public.order_meetup_revisions where order_id=o.id and status='confirmed' order by revision desc limit 1)
   then raise exception 'Guarded proposal required.' using errcode='42501';end if;
  return new;
 end if;
 if old.status<>'pending' or(to_jsonb(new)-array['status','decided_by','decided_at']) is distinct from(to_jsonb(old)-array['status','decided_by','decided_at']) then raise exception 'Meetup history immutable.' using errcode='23514';end if;
 if new.status='closed' and o.lifecycle_status<>'open' and new.decided_by is null then return new;end if;
 if not marketplace_private.meetup_mutable(o) or new.decided_by is distinct from auth.uid()
 or not exists(select 1 from marketplace_private.meetup_commands c where c.order_id=o.id and c.actor=auth.uid()
 and((new.status='superseded' and c.action='propose') or(c.revision_id=new.id and c.action=case new.status when 'confirmed' then 'confirm' when 'declined' then 'decline' when 'withdrawn' then 'withdraw' end)))
 or(new.status in('confirmed','declined') and(new.decided_by=old.proposed_by or new.decided_by not in(o.buyer_id,o.seller_id)))
 or(new.status='withdrawn' and new.decided_by is distinct from old.proposed_by)
 then raise exception 'Guarded decision required.' using errcode='42501';end if;
 return new;
end;$$;
create trigger order_meetup_guard before insert or update or delete on public.order_meetup_revisions for each row execute function marketplace_private.protect_meetup_revision();
create function marketplace_private.seed_order_meetup() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.order_protocol_version=2 and new.terms_snapshot->'terms'->>'fulfillment'='on_campus' then
 insert into public.order_meetup_revisions(order_id,revision,location,scheduled_at,note,status,proposed_at,decided_at)
 values(new.id,0,btrim(new.terms_snapshot->'terms'->>'meetup_location'),(new.terms_snapshot->'terms'->>'scheduled_at')::timestamptz,
 coalesce(new.terms_snapshot->'terms'->>'note',''),'confirmed',new.accepted_at,new.accepted_at);end if;return new;end;$$;
create trigger orders_meetup_initial after insert on public.orders for each row execute function marketplace_private.seed_order_meetup();
insert into public.order_meetup_revisions(order_id,revision,location,scheduled_at,note,status,proposed_at,decided_at)
 select id,0,btrim(terms_snapshot->'terms'->>'meetup_location'),(terms_snapshot->'terms'->>'scheduled_at')::timestamptz,
 coalesce(terms_snapshot->'terms'->>'note',''),'confirmed',accepted_at,accepted_at from public.orders where order_protocol_version=2 and terms_snapshot->'terms'->>'fulfillment'='on_campus';
create function public.marketplace_order_meetup_action(p_order_id uuid,p_action text,p_revision_id uuid,p_terms jsonb,p_client_action_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();o public.orders;r public.order_meetup_revisions;cur public.order_meetup_revisions;cmd marketplace_private.meetup_commands;d text;t timestamptz;rid uuid;answer jsonb;begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 if p_client_action_id is null or p_action not in('propose','confirm','decline','withdraw') or p_action is null
 or(p_action='propose' and p_revision_id is not null) or(p_action<>'propose' and(p_revision_id is null or p_terms is not null)) then raise exception 'Invalid meetup action.' using errcode='23514';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or(actor is distinct from o.buyer_id and actor is distinct from o.seller_id) then raise exception 'Order not accessible.' using errcode='42501';end if;
 d:=encode(sha256(convert_to(jsonb_build_array(p_order_id,p_action,p_revision_id,p_terms)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'meetup'||p_client_action_id::text,0));
 select * into cmd from marketplace_private.meetup_commands c where c.actor=auth.uid() and c.command=p_client_action_id;
 if found then if cmd.digest<>d then raise exception 'Command reused for different input.' using errcode='23505';end if;return cmd.result;end if;
 perform 1 from public.listings where id=o.listing_id for update;
 select * into o from public.orders where id=p_order_id for update;
 if not marketplace_private.meetup_mutable(o) or(actor is distinct from o.buyer_id and actor is distinct from o.seller_id) then raise exception 'Order no longer reschedulable.' using errcode='23505';end if;
 t:=clock_timestamp();select * into cur from public.order_meetup_revisions where order_id=o.id and status='confirmed' order by revision desc limit 1;
 if cur.id is null then raise exception 'Confirmed schedule missing.' using errcode='23514';end if;
 if p_action='propose' then
 perform marketplace_private.validate_meetup(p_terms,t);rid:=gen_random_uuid();
 insert into marketplace_private.meetup_commands(actor,command,order_id,action,digest,revision_id) values(actor,p_client_action_id,o.id,p_action,d,rid);
 update public.order_meetup_revisions set status='superseded',decided_by=actor,decided_at=t where order_id=o.id and status='pending';
 insert into public.order_meetup_revisions(id,order_id,revision,base_confirmed_id,location,scheduled_at,note,status,proposed_by,proposed_at)
 select rid,o.id,coalesce(max(revision),0)+1,cur.id,btrim(p_terms->>'location'),(p_terms->>'scheduled_at')::timestamptz,coalesce(p_terms->>'note',''),'pending',actor,t
 from public.order_meetup_revisions where order_id=o.id returning * into r;
 else
 select * into r from public.order_meetup_revisions where id=p_revision_id and order_id=o.id for update;
 if r.id is null or r.status<>'pending' or r.base_confirmed_id<>cur.id then raise exception 'Proposal changed. Refresh.' using errcode='23505';end if;
 if(p_action in('confirm','decline') and r.proposed_by=actor) or(p_action='withdraw' and r.proposed_by<>actor) then raise exception 'Other participant decision or own withdrawal required.' using errcode='42501';end if;
 if p_action='confirm' and r.scheduled_at<=t then raise exception 'Proposed meetup is no longer future.' using errcode='23514';end if;
 insert into marketplace_private.meetup_commands(actor,command,order_id,action,digest,revision_id) values(actor,p_client_action_id,o.id,p_action,d,r.id);
 update public.order_meetup_revisions set status=case p_action when 'confirm' then 'confirmed' when 'decline' then 'declined' else 'withdrawn' end,decided_by=actor,decided_at=t where id=r.id returning * into r;
 end if;
 answer:=jsonb_build_object('revisionId',r.id,'status',r.status,'serverTime',t);update marketplace_private.meetup_commands c set result=answer where c.actor=auth.uid() and c.command=p_client_action_id;return answer;
end;$$;
create function marketplace_private.settle_order_meetup(p_listing uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;r public.order_meetup_revisions;t timestamptz;deadline timestamptz;begin
 perform 1 from public.listings where id=p_listing for update;select * into o from public.orders where listing_id=p_listing and holds_listing and order_protocol_version=2 for update;
 if o.id is null or not marketplace_private.meetup_mutable(o) then return;end if;
 select * into r from public.order_meetup_revisions where order_id=o.id and status='confirmed' order by revision desc limit 1;
 if r.id is null then raise exception 'Confirmed schedule missing.' using errcode='23514';end if;
 t:=clock_timestamp();deadline:=r.scheduled_at+interval '60 minutes';if t<deadline then return;end if;
 insert into marketplace_private.meetup_expiries(order_id,confirmed_id,deadline,settled_at) values(o.id,r.id,deadline,t);
 update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
 update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
end;$$;
alter table public.orders drop constraint orders_v2_foundation;
alter table public.orders add constraint orders_v2_foundation check((order_protocol_version=1 and listing_snapshot is null)
 or(order_protocol_version=2 and terms_schema_version=2 and jsonb_typeof(listing_snapshot)='object' and money_status='v2_pending' and service_fee_rule_version='not_finalized_v2'
 and service_fee_amount_cents is null and total_amount_cents is null and payment_status='pending' and payment_paid_at is null and payout_status='not_eligible'
 and fulfillment_status='awaiting_payment' and created_at=accepted_at and reservation_started_at is null and reservation_expires_at is null
 and((lifecycle_status='open' and holds_listing and reservation_ended_at is null and expired_at is null)
 or(lifecycle_status='cancelled' and not holds_listing and reservation_ended_at=cancelled_at and expired_at is null)
 or(lifecycle_status='expired' and terms_snapshot->'terms'->>'fulfillment'='on_campus' and not holds_listing and expired_at is not null and reservation_ended_at=expired_at and cancelled_at is null))));

create or replace function marketplace_private.protect_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;
begin
 if tg_op='UPDATE' and old.order_protocol_version=2 and new.lifecycle_status='expired' then
 if not marketplace_private.meetup_mutable(old) or new.holds_listing or new.expired_at is null or new.reservation_ended_at is distinct from new.expired_at
 or(to_jsonb(new)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at']) is distinct from(to_jsonb(old)-array['lifecycle_status','holds_listing','expired_at','reservation_ended_at','updated_at'])
 or not exists(select 1 from marketplace_private.meetup_expiries e join public.order_meetup_revisions r on r.id=e.confirmed_id where e.order_id=old.id
 and e.settled_at=new.expired_at and e.deadline=r.scheduled_at+interval '60 minutes' and e.deadline<=clock_timestamp()
 and r.id=(select id from public.order_meetup_revisions where order_id=old.id and status='confirmed' order by revision desc limit 1))
 then raise exception 'Authoritative no-show receipt required.' using errcode='23514';end if;return new;end if;

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
    and old.payment_status='pending' and new.cancelled_by=auth.uid()
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
create or replace function marketplace_private.settle_listing_reservation(p_listing uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; t timestamptz;
begin
 perform marketplace_private.settle_order_meetup(p_listing);
  perform 1 from public.listings where id=p_listing for update;
  select * into o from public.orders where listing_id=p_listing and holds_listing and order_protocol_version=1 for update;
  if not found then return; end if;
  t:=clock_timestamp();
  if o.payment_status<>'paid' and o.reservation_expires_at<=t then
    update public.orders set lifecycle_status='expired',holds_listing=false,expired_at=t,reservation_ended_at=t,updated_at=t where id=o.id;
    update public.listings set status='available',reserved_order_id=null where id=p_listing and reserved_order_id=o.id;
  end if;
end; $$;
create or replace function marketplace_private.order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; happened timestamptz;
begin
 if tg_op='UPDATE' and new.order_protocol_version=2 and new.lifecycle_status='expired' and old.lifecycle_status='open' then
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_role,event_type,created_at,transition_key,metadata)
 select new.conversation_id,new.request_id,new.id,'system','order_no_show_expired',new.expired_at,new.id::text||':order_no_show_expired',
 jsonb_build_object('orderId',new.id,'confirmedRevisionId',e.confirmed_id,'graceDeadline',e.deadline,'reason','Meetup was not completed within the allowed grace period.') from marketplace_private.meetup_expiries e where e.order_id=new.id;
 perform marketplace_private.notify_order_history(new.conversation_id);return new;end if;
  if tg_op='INSERT' then kind:='order_created'; happened:=new.created_at;
  elsif new.payment_status='paid' and old.payment_status<>'paid' then kind:='payment_paid'; happened:=new.payment_paid_at;
  elsif new.lifecycle_status is not distinct from old.lifecycle_status then return new;
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

alter table public.transaction_events drop constraint transaction_events_event_type_check;
alter table public.transaction_events add constraint transaction_events_event_type_check check(event_type in(
 'request_created','request_replaced','request_cancelled','request_expired','request_accepted','order_created','reservation_expired','payment_paid','order_cancelled',
 'offer_created','offer_replaced','offer_withdrawn','offer_accepted','offer_closed','listing_pending','meetup_initial_confirmed','meetup_proposed','meetup_confirmed','meetup_declined','meetup_withdrawn','meetup_superseded','meetup_closed','order_no_show_expired'));
create function marketplace_private.meetup_event() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders;kind text;actor uuid;begin
 select * into o from public.orders where id=new.order_id;
 kind:=case when new.revision=0 then 'meetup_initial_confirmed' when tg_op='INSERT' then 'meetup_proposed' else 'meetup_'||new.status end;
 actor:=case when new.revision=0 then auth.uid() when tg_op='INSERT' then new.proposed_by else new.decided_by end;
 insert into public.transaction_events(conversation_id,request_id,order_id,actor_id,actor_role,event_type,created_at,transition_key,metadata)
 values(o.conversation_id,o.request_id,o.id,actor,case when actor is null then 'system' when actor=o.buyer_id then 'buyer' else 'seller' end,kind,
 case when tg_op='INSERT' then new.proposed_at else new.decided_at end,new.id::text||':'||kind,jsonb_build_object('revisionId',new.id,'revision',new.revision,'status',new.status));
 perform marketplace_private.notify_order_history(o.conversation_id);return new;end;$$;
create trigger order_meetup_event after insert or update on public.order_meetup_revisions for each row execute function marketplace_private.meetup_event();
create function marketplace_private.close_terminal_meetup() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.order_protocol_version=2 and new.lifecycle_status<>old.lifecycle_status and new.lifecycle_status<>'open' then
 update public.order_meetup_revisions set status='closed',decided_by=null,decided_at=coalesce(new.expired_at,new.cancelled_at,clock_timestamp()) where order_id=new.id and status='pending';end if;return new;end;$$;
create trigger orders_meetup_terminal after update on public.orders for each row execute function marketplace_private.close_terminal_meetup();
create function public.marketplace_order_meetup_history(p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;actor uuid:=auth.uid();begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified account required.' using errcode='42501';end if;
 select * into o from public.orders where id=p_order_id;
 if o.id is null or(actor is distinct from o.buyer_id and actor is distinct from o.seller_id) then raise exception 'Order not accessible.' using errcode='42501';end if;
 if o.order_protocol_version<>2 or o.terms_snapshot->'terms'->>'fulfillment' is distinct from 'on_campus' then raise exception 'V2 On Campus required.' using errcode='42501';end if;
 return jsonb_build_object('serverTime',clock_timestamp(),'mutable',marketplace_private.meetup_mutable(o),'revisions',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'proposer_role',case when r.proposed_by is null then 'system' when r.proposed_by=o.buyer_origin_id then 'buyer' else 'seller' end,
 'decider_role',case when r.decided_by is null then 'system' when r.decided_by=o.buyer_origin_id then 'buyer' else 'seller' end) order by r.revision) from public.order_meetup_revisions r where r.order_id=o.id),'[]'::jsonb));end;$$;
revoke all on function marketplace_private.meetup_mutable(public.orders),marketplace_private.validate_meetup(jsonb,timestamptz),marketplace_private.protect_meetup_revision(),marketplace_private.seed_order_meetup(),marketplace_private.settle_order_meetup(uuid),marketplace_private.meetup_event(),marketplace_private.close_terminal_meetup() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_order_meetup_action(uuid,text,uuid,jsonb,uuid),public.marketplace_order_meetup_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_order_meetup_action(uuid,text,uuid,jsonb,uuid),public.marketplace_order_meetup_history(uuid) to authenticated;
create or replace function marketplace_private.verify_v2_order_commit() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.orders;begin
 select * into o from public.orders where id=new.id;
 if o.order_protocol_version=2 and (not exists(select 1 from public.order_requests where id=o.request_id and status='accepted' and protocol_version=2)
 or not exists(select 1 from marketplace_private.order_media_batches where order_id=o.id and state='bound')
 or(o.terms_snapshot->'terms'->>'fulfillment'='on_campus' and not exists(select 1 from public.order_meetup_revisions where order_id=o.id and revision=0 and status='confirmed'))
 or (o.holds_listing and not exists(select 1 from public.listings where id=o.listing_id and status='pending' and reserved_order_id=o.id)))
 then raise exception 'Incomplete V2 transaction.' using errcode='23514';end if;
 return null;
end;$$;
commit;

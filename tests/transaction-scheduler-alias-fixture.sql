-- Isolated LOCAL PostgreSQL fixture only. Never run against a Supabase project.
create schema marketplace_private;
create role anon;
create role authenticated;
create role service_role;
create table public.listings(id uuid primary key);
create table public.conversations(id uuid primary key, listing_id uuid);
create table public.order_requests(
  conversation_id uuid, protocol_version integer, status text, offer_terms jsonb
);
create table public.orders(
  id uuid primary key, listing_id uuid, order_protocol_version integer,
  lifecycle_status text, holds_listing boolean, payment_status text
);
create table public.order_meetup_revisions(
  id uuid primary key, order_id uuid, status text, scheduled_at timestamptz,
  revision integer
);
create table marketplace_private.notification_reminders(
  identity text primary key, order_id uuid, recipient uuid, kind text,
  confirmed_revision_id uuid, due_at timestamptz,
  delivered_at timestamptz, suppressed_at timestamptz
);
create table marketplace_private.delivery_checkouts(
  order_id uuid, checkout_started_at timestamptz,
  checkout_claim_deadline_at timestamptz, payment_deadline_at timestamptz
);
create table marketplace_private.order_protection(
  order_id uuid, expires_at timestamptz, completed_at timestamptz
);
create table marketplace_private.protection_cases(order_id uuid);
create table marketplace_private.notification_events(
  id uuid primary key default gen_random_uuid(), source_key text unique,
  event_type text, created_at timestamptz, destination jsonb
);
create table marketplace_private.test_calls(
  sequence bigint generated always as identity, operation text, target uuid
);
create table marketplace_private.test_external_started(order_id uuid primary key);

-- Only downstream domain effects are stubbed. The old/new scheduler bodies run
-- unchanged in real PL/pgSQL, including locks, reminder queries and event inserts.
create function marketplace_private.expire_conversation_offers(id uuid)
returns void language sql as $$
  insert into marketplace_private.test_calls(operation,target) values('expire',id);
$$;
create function marketplace_private.settle_delivery_checkout(id uuid)
returns void language sql as $$
  insert into marketplace_private.test_calls(operation,target) values('delivery',id);
$$;
create function marketplace_private.settle_order_meetup(id uuid)
returns void language sql as $$
  insert into marketplace_private.test_calls(operation,target) values('meetup',id);
$$;
create function marketplace_private.settle_order_protection(id uuid)
returns void language sql as $$
  insert into marketplace_private.test_calls(operation,target) values('protection',id);
$$;
create function marketplace_private.external_exchange_started(id uuid)
returns boolean language sql as $$
  select exists(select 1 from marketplace_private.test_external_started where order_id=id);
$$;
create function marketplace_private.deliver_notification(event_id uuid, recipient uuid, priority text)
returns void language plpgsql as $$
begin
  if priority<>'ACTION_REQUIRED' then raise exception 'Wrong priority';end if;
  insert into marketplace_private.test_calls(operation,target) values('notify',recipient);
end;$$;
create function marketplace_private.test_assert(ok boolean, label text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end;$$;

insert into public.listings values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002');
insert into public.conversations values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002');
insert into public.order_requests
select '10000000-0000-4000-8000-000000000001',2,'active',
 jsonb_build_object('fulfillment','on_campus','scheduled_at',now()-interval '1 hour');
-- A future active Offer must not be expired by this pass.
insert into public.order_requests
select '10000000-0000-4000-8000-000000000002',2,'active',
 jsonb_build_object('fulfillment','on_campus','scheduled_at',now()+interval '1 hour');
insert into public.orders values
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',2,'open',true,'pending'),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',2,'open',true,'processing'),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',2,'open',true,'pending'),
 ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',1,'open',true,'pending'),
 ('20000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002',2,'completed',false,'paid');
insert into marketplace_private.test_external_started values('20000000-0000-4000-8000-000000000003');
insert into marketplace_private.delivery_checkouts values
 ('20000000-0000-4000-8000-000000000001',null,now()+interval '1 hour',now()+interval '1 hour'),
 ('20000000-0000-4000-8000-000000000002',now(),now()+interval '1 hour',now()+interval '1 hour'),
 ('20000000-0000-4000-8000-000000000003',null,now()+interval '1 hour',now()+interval '1 hour');
insert into public.order_meetup_revisions values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','confirmed',now()+interval '2 hours',1),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','confirmed',now()+interval '3 hours',2);
insert into marketplace_private.notification_reminders(identity,order_id,recipient,kind,confirmed_revision_id,due_at) values
 ('meet-latest','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','meet-reminder','30000000-0000-4000-8000-000000000002',now()-interval '1 minute'),
 ('meet-stale','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','meet-reminder','30000000-0000-4000-8000-000000000001',now()-interval '1 minute'),
 ('claim-ok','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','delivery_claim_1h',null,now()-interval '1 minute'),
 ('claim-started','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','delivery_claim_1h',null,now()-interval '1 minute'),
 ('payment-processing','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','payment-reminder',null,now()-interval '1 minute'),
 ('external-started','20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','delivery_claim_1h',null,now()-interval '1 minute'),
 ('completed','20000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','payment-reminder',null,now()-interval '1 minute'),
 ('future','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','delivery_claim_1h',null,now()+interval '1 hour');

-- Staging-only extension of the existing notification domain. No history backfill.
begin;

create table marketplace_private.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid references public.notifications(id) on delete set null,
 notification_identity uuid not null,
 channel text not null default 'email' check(channel='email'),
 status text not null default 'pending' check(status in('pending','sending','sent','retryable','permanent_failure')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 5),
 next_attempt_at timestamptz not null default clock_timestamp(),
 first_attempt_at timestamptz, lease_id uuid, lease_until timestamptz,
 provider_message_id text, sent_at timestamptz, last_error_code text,
 provider_status text check(provider_status in('accepted','delivered','bounced','failed','complained')),
 -- Freeze the complete provider request on first send so retries are byte-stable.
 -- Private recipient snapshot is required because Auth email/settings may change.
 envelope jsonb, test_only boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(notification_identity,channel)
);
alter table marketplace_private.notification_deliveries enable row level security;
revoke all on marketplace_private.notification_deliveries from public,anon,authenticated,service_role;
create index notification_delivery_due on marketplace_private.notification_deliveries(next_attempt_at) where status in('pending','retryable','sending');

create function marketplace_private.notification_email_enabled(kind text) returns boolean
language sql immutable set search_path='' as $$
 select kind in('incoming_offer','incoming_counter_offer','offer_accepted','offer_declined','offer_closed',
 'agreement_confirmation_required','agreement_other_confirmed','agreement_complete','payment_required',
 'payment_paid','payment_failed','meetup_proposed','meetup_confirmed','meetup_declined','seller_delivery_started',
 'handoff_ready','handoff_confirmed','courier_shipped','courier_delivered','buyer_confirm_received',
 'protection_started','protection_case_opened','order_completed','order_cancelled','cancellation_requested',
 'order_no_show_expired','reservation_expired','delivery_claim_1h','delivery_payment_10m','meetup_24h','meetup_1h',
 'payout_needs_attention','payout_paid');
$$;

create function marketplace_private.notify_notification_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and marketplace_private.notification_email_enabled(new.event_type) then
  insert into marketplace_private.notification_deliveries(notification_id,notification_identity) values(new.id,new.id) on conflict do nothing;
 end if;
 -- Reuse the existing per-user private Broadcast namespace and its RLS fences.
 begin
  perform realtime.send(jsonb_build_object('changed',true),'notifications_changed','marketplace:messages:'||new.recipient_user_id,true);
 exception when others then
  -- Broadcast is only an invalidation hint; durable notification/outbox remains.
  null;
 end;
 return new;
end;$$;
create trigger notification_delivery_projector after insert or update on public.notifications
for each row execute function marketplace_private.notify_notification_delivery();

-- Disposable notification cleanup may remove unattempted work. Preserve attempted
-- provider audit (including uncertain sends) after the source notification is gone.
create function marketplace_private.retire_notification_delivery() returns trigger
language plpgsql security definer set search_path='' as $$begin
 delete from marketplace_private.notification_deliveries where notification_id=old.id and attempt_count=0;
 update marketplace_private.notification_deliveries set status='permanent_failure',last_error_code='notification_removed',lease_id=null,lease_until=null
 where notification_id=old.id and status<>'sent';
 return old;
end;$$;
create trigger notification_delivery_retire before delete on public.notifications
for each row execute function marketplace_private.retire_notification_delivery();

create function public.marketplace_mark_all_notifications_read() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified account required.' using errcode='42501';end if;
 update public.notifications set read_at=clock_timestamp() where recipient_user_id=auth.uid() and read_at is null;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.marketplace_mark_all_notifications_read() from public,anon,authenticated,service_role;
grant execute on function public.marketplace_mark_all_notifications_read() to authenticated;

-- Project only bounded identifiers; never copy event metadata, addresses or chat text.
create or replace function marketplace_private.project_transaction_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.order_requests;o public.orders;eid uuid;dest jsonb;kind text:=new.event_type;target uuid;priority text:='INFORMATIONAL';
begin
 select * into r from public.order_requests where id=new.request_id;
 if r.protocol_version is distinct from 2 then return new;end if;
 select * into o from public.orders where id=new.order_id or(request_id=r.id and kind='offer_accepted');
 dest:=case when o.id is not null then jsonb_build_object('section','orders','orderId',o.id)
 else jsonb_build_object('section','messages','conversationId',new.conversation_id,'offerId',r.id) end;
 if kind='offer_created' then
  kind:=case when new.metadata->>'previousOfferId' is not null and exists(select 1 from public.order_requests prev
   where prev.id=(new.metadata->>'previousOfferId')::uuid and prev.sender_user_id<>r.sender_user_id) then 'incoming_counter_offer' else 'incoming_offer' end;
  target:=r.recipient_user_id;priority:='ACTION_REQUIRED';
 elsif kind in('offer_declined','offer_accepted') then target:=r.sender_user_id;
 elsif kind='offer_withdrawn' then target:=r.recipient_user_id;
 elsif kind in('meetup_proposed','meetup_confirmed','meetup_declined','order_cancelled','cancellation_requested','protection_case_opened') and new.actor_id is not null then
  target:=case when new.actor_id=r.buyer_id then r.seller_id else r.buyer_id end;
  if kind in('meetup_proposed','cancellation_requested','protection_case_opened') then priority:='ACTION_REQUIRED';end if;
 elsif kind in('payment_paid','buyer_confirm_received') then target:=r.seller_id;
 elsif kind in('payment_failed','seller_delivery_started','courier_shipped') then target:=r.buyer_id;
 elsif kind in('offer_closed','order_no_show_expired','reservation_expired','order_cancelled','order_completed',
 'handoff_ready','handoff_confirmed','protection_started','courier_delivered','protection_case_opened') then target:=null;
 else return new;end if;
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values('transaction:'||new.id,kind,new.created_at,dest) on conflict(source_key) do nothing;
 select id into eid from marketplace_private.notification_events where source_key='transaction:'||new.id;
 if target is not null then
  if target is distinct from new.actor_id or kind='payment_failed' then perform marketplace_private.deliver_notification(eid,target,priority);end if;
 else
  if r.buyer_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.buyer_id,priority);end if;
  if r.seller_id is distinct from new.actor_id then perform marketplace_private.deliver_notification(eid,r.seller_id,priority);end if;
 end if;
 return new;
end;$$;

create function marketplace_private.project_agreement_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.orders;kind text;eid uuid;recipient uuid;dest jsonb;actor uuid;
begin
 if new.preserved_progress then return new;end if;
 select * into o from public.orders where id=new.order_id;
 if o.lifecycle_status<>'open' then return new;end if;
 dest:=jsonb_build_object('section','orders','orderId',o.id);
 if tg_op='INSERT' then kind:='agreement_confirmation_required';
 elsif new.buyer_confirmed_at is not null and new.seller_confirmed_at is not null then kind:='agreement_complete';
 else kind:='agreement_other_confirmed';end if;
 if tg_op='UPDATE' then
  if new.buyer_confirmed_at is not distinct from old.buyer_confirmed_at and new.seller_confirmed_at is not distinct from old.seller_confirmed_at then return new;end if;
  actor:=case when new.buyer_confirmed_at is distinct from old.buyer_confirmed_at then o.buyer_id else o.seller_id end;
 end if;
 insert into marketplace_private.notification_events(source_key,event_type,destination)
 values('agreement:'||o.id||':'||kind,kind,dest) on conflict(source_key) do nothing;
 select id into eid from marketplace_private.notification_events where source_key='agreement:'||o.id||':'||kind;
 foreach recipient in array array[o.buyer_id,o.seller_id] loop
  -- Completion is an actionable state for both; never describe it as their own confirmation.
  if kind='agreement_complete' or recipient is distinct from actor then
   perform marketplace_private.deliver_notification(eid,recipient,'ACTION_REQUIRED');
  end if;
 end loop;
end;$$;
create trigger agreement_notification_projector after insert or update on marketplace_private.order_agreements
for each row execute function marketplace_private.project_agreement_notification();

create function marketplace_private.project_message_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.conversations;eid uuid;
begin
 if new.type not in('TEXT','IMAGE') then return new;end if;
 select * into c from public.conversations where id=new.conversation_id;
 insert into marketplace_private.notification_events(source_key,event_type,destination)
 values('message:'||new.id,'new_message',jsonb_build_object('section','messages','conversationId',c.id)) on conflict(source_key) do nothing;
 select id into eid from marketplace_private.notification_events where source_key='message:'||new.id;
 perform marketplace_private.deliver_notification(eid,case when new.sender_id=c.buyer_id then c.seller_id else c.buyer_id end,'INFORMATIONAL');
 return new;
end;$$;
create trigger message_notification_projector after insert on public.messages
for each row execute function marketplace_private.project_message_notification();

create function marketplace_private.require_notification_worker() returns void
language plpgsql stable set search_path='' as $$begin
 if auth.jwt()->>'role' is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then
 raise exception 'Trusted staging worker required.' using errcode='42501';end if;
end;$$;

create function public.marketplace_claim_email_deliveries(p_limit integer default 10,p_test_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform marketplace_private.require_notification_worker();
 -- Never retry an uncertain send beyond Resend's 24-hour idempotency window.
 update marketplace_private.notification_deliveries set status='permanent_failure',last_error_code='retry_window_exhausted',lease_id=null,lease_until=null
 where status in('pending','retryable','sending') and (attempt_count>=5 or first_attempt_at<clock_timestamp()-interval '23 hours') and coalesce(lease_until,'-infinity')<=clock_timestamp();
 with picked as(select id from marketplace_private.notification_deliveries
 where status in('pending','retryable','sending') and next_attempt_at<=clock_timestamp() and notification_id is not null
 and ((p_test_id is null and not test_only) or (test_only and id=p_test_id))
 and coalesce(lease_until,'-infinity')<=clock_timestamp() and attempt_count<5
 order by next_attempt_at,id limit greatest(1,least(p_limit,10)) for update skip locked),
 claimed as(update marketplace_private.notification_deliveries d set status='sending',attempt_count=attempt_count+1,
 first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes'
 from picked where d.id=picked.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'leaseId',d.lease_id,'attempt',d.attempt_count,'testOnly',d.test_only,
 'envelope',d.envelope,'email',u.email,'type',n.event_type,'destination',n.destination)),'[]'::jsonb) into result
 from claimed d join public.notifications n on n.id=d.notification_id join auth.users u on u.id=n.recipient_user_id;
 return result;
end;$$;

create function public.marketplace_prepare_email(p_id uuid,p_lease uuid,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform marketplace_private.require_notification_worker();
 if jsonb_typeof(p_envelope)<>'object' or (select count(*) from jsonb_object_keys(p_envelope))<>5
 or not(p_envelope ?& array['from','to','subject','html','text']) or octet_length(p_envelope::text)>20000 then
 raise exception 'Invalid envelope.' using errcode='23514';end if;
 update marketplace_private.notification_deliveries set envelope=coalesce(envelope,p_envelope)
 where id=p_id and lease_id=p_lease and status='sending' and lease_until>clock_timestamp() returning envelope into result;
 if result is null then raise exception 'Lease lost.' using errcode='40001';end if;
 return result;
end;$$;

create function public.marketplace_finish_email(p_id uuid,p_lease uuid,p_provider_id text default null,p_error text default null,p_retry boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform marketplace_private.require_notification_worker();
 if p_error is not null and p_error not in('timeout','provider_unavailable','rate_limited','invalid_request','sender_restricted','configuration','retry_window_exhausted') then
 raise exception 'Invalid error class.' using errcode='23514';end if;
 if (p_provider_id is null)=(p_error is null) or char_length(p_provider_id)>200 then raise exception 'Invalid outcome.' using errcode='23514';end if;
 update marketplace_private.notification_deliveries set
 status=case when p_provider_id is not null then 'sent' when p_retry and attempt_count<5 then 'retryable' else 'permanent_failure' end,
 provider_message_id=p_provider_id,provider_status=case when p_provider_id is not null then 'accepted' else null end,sent_at=case when p_provider_id is not null then clock_timestamp() else null end,
 last_error_code=p_error,next_attempt_at=clock_timestamp()+make_interval(secs=>case attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end),
 lease_id=null,lease_until=null where id=p_id and lease_id=p_lease and status='sending' and lease_until>clock_timestamp();
 return found;
end;$$;

-- An opaque scheduler token is generated inside Vault, never exported to local files.
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='marketplace_notification_worker') then
 perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'marketplace_notification_worker');end if;
end;$$;
create function public.marketplace_authorize_email_worker(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$begin
 perform marketplace_private.require_notification_worker();
 return exists(select 1 from vault.decrypted_secrets where name='marketplace_notification_worker' and decrypted_secret=p_token);
end;$$;
create function marketplace_private.invoke_email_worker() returns void
language plpgsql security definer set search_path='' as $$begin
 perform net.http_post(url:='https://pcaqxezdfxofysghssyo.supabase.co/functions/v1/notification-email-worker',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='marketplace_notification_worker')),
 body:='{}'::jsonb,timeout_milliseconds:=5000);
end;$$;
select cron.schedule('marketplace-notification-email','* * * * *','select marketplace_private.invoke_email_worker();');

revoke all on function marketplace_private.notification_email_enabled(text),marketplace_private.notify_notification_delivery(),marketplace_private.retire_notification_delivery(),
 marketplace_private.project_agreement_notification(),marketplace_private.project_message_notification(),marketplace_private.require_notification_worker(),
 marketplace_private.invoke_email_worker(),public.marketplace_claim_email_deliveries(integer,uuid),public.marketplace_prepare_email(uuid,uuid,jsonb),
 public.marketplace_finish_email(uuid,uuid,text,text,boolean),public.marketplace_authorize_email_worker(text) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_claim_email_deliveries(integer,uuid),public.marketplace_prepare_email(uuid,uuid,jsonb),
 public.marketplace_finish_email(uuid,uuid,text,text,boolean),public.marketplace_authorize_email_worker(text) to service_role;
commit;

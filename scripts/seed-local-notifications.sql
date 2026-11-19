-- LOCAL-ONLY UI fixture. Never run this against a hosted Supabase project.
-- Usage (after confirming a local database and the account UUID):
--   psql "$LOCAL_SUPABASE_DB_URL" -v target_user_id='<verified uuid>' -v target_username='gmailTest' -f scripts/seed-local-notifications.sql
-- Cleanup only this fixture set:
--   psql "$LOCAL_SUPABASE_DB_URL" -v target_user_id='<same uuid>' -v target_username='gmailTest' -f scripts/seed-local-notifications.sql -v cleanup_only=1
-- The caller supplies both an account UUID and username; the database verifies the relationship
-- before any write. The script intentionally never guesses an ID from a display name.
\if :{?target_user_id}
\else
  \echo 'target_user_id is required; refusing to seed.'
  \quit
\endif
\if :{?target_username}
\else
  \echo 'target_username is required; refusing to seed.'
  \quit
\endif

begin;

-- Keep test data from invoking notification delivery/projector triggers. This is only valid
-- for the local postgres superuser; it must fail rather than be adapted for a hosted project.
set local session_replication_role = replica;

do $$
declare target uuid := :'target_user_id'::uuid;
begin
  if not exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
    where u.id = target and p.username = :'target_username'
  ) then
    raise exception 'Local fixture target does not match the requested profile.' using errcode = '42501';
  end if;
end $$;

delete from public.notifications n
using marketplace_private.notification_events e
where n.domain_event_id = e.id
  and n.recipient_user_id = :'target_user_id'::uuid
  and e.source_key like 'ui-seed:notifications:gmailTest:%';

delete from marketplace_private.notification_events
where source_key like 'ui-seed:notifications:gmailTest:%';

\if :{?cleanup_only}
  commit;
  \quit
\endif

with fixture(category, event_type, priority, is_read, offset_minutes, seq) as (
  values
    ('MESSAGE','new_message','INFORMATIONAL',false,  2,  1),
    ('MESSAGE','new_message','INFORMATIONAL',false,  9,  2),
    ('MESSAGE','new_message','ACTION_REQUIRED',false,54, 3),
    ('MESSAGE','new_message','INFORMATIONAL',false,185, 4),
    ('MESSAGE','new_message','INFORMATIONAL',true,  940, 5),
    ('MESSAGE','new_message','INFORMATIONAL',true,  2880,6),
    ('ORDER','incoming_offer','ACTION_REQUIRED',false,14, 7),
    ('ORDER','agreement_complete','INFORMATIONAL',false,76, 8),
    ('ORDER','payment_required','ACTION_REQUIRED',false,410,9),
    ('ORDER','handoff_ready','INFORMATIONAL',true,  1520,10),
    ('ORDER','order_completed','INFORMATIONAL',true,4320,11),
    ('LISTING','price_drop','INFORMATIONAL',false,  27,12),
    ('LISTING','price_drop','INFORMATIONAL',false,  220,13),
    ('LISTING','price_drop','INFORMATIONAL',false,  830,14),
    ('LISTING','price_drop','INFORMATIONAL',true,  1800,15),
    ('LISTING','price_drop','INFORMATIONAL',true,  5760,16),
    ('SYSTEM','notification_test','INFORMATIONAL',false,39,17),
    ('SYSTEM','notification_test','INFORMATIONAL',false,660,18),
    ('SYSTEM','notification_test','INFORMATIONAL',true, 2100,19),
    ('SYSTEM','notification_test','INFORMATIONAL',true, 7200,20)
), events as (
  insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
  select 'ui-seed:notifications:gmailTest:' || seq, event_type,
    clock_timestamp() - make_interval(mins => offset_minutes),
    jsonb_build_object('section','settings','fixture','local-ui-notification-seed','category',category,'sequence',seq)
  from fixture
  returning id, source_key, event_type, created_at, destination
)
insert into public.notifications(
  recipient_user_id, domain_event_id, event_type, priority, created_at, updated_at,
  read_at, destination, coalescing_key, original_price_cents, latest_price_cents
)
select :'target_user_id'::uuid, e.id, f.event_type, f.priority, e.created_at, e.created_at,
  case when f.is_read then e.created_at + interval '1 minute' else null end,
  e.destination,
  case when f.event_type = 'price_drop' then 'ui-seed:price-drop:' || f.seq else null end,
  case when f.event_type = 'price_drop' then 2500 else null end,
  case when f.event_type = 'price_drop' then 2000 else null end
from events e
join fixture f on e.source_key = 'ui-seed:notifications:gmailTest:' || f.seq;

commit;

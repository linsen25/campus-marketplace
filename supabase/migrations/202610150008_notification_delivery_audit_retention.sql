-- Keep safe original failure classification when disposable source notices are removed.
begin;
create or replace function marketplace_private.retire_notification_delivery() returns trigger
language plpgsql security definer set search_path='' as $$begin
 delete from marketplace_private.notification_deliveries where notification_id=old.id and attempt_count=0;
 update marketplace_private.notification_deliveries set status='permanent_failure',
 last_error_code=coalesce(last_error_code,'notification_removed'),lease_id=null,lease_until=null
 where notification_id=old.id and status in('pending','sending','retryable');
 return old;
end;$$;
revoke all on function marketplace_private.retire_notification_delivery() from public,anon,authenticated,service_role;
commit;

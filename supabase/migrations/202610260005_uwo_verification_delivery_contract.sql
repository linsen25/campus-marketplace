-- Make send admission explicit: rate-limited requests never look successful.
begin;
drop function if exists marketplace_private.begin_uwo_email_verification(uuid,text,text,timestamptz);
create function marketplace_private.begin_uwo_email_verification(
  p_user_id uuid,p_uwo_email text,p_code_hash text,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_user_id is null or p_uwo_email is null or lower(trim(p_uwo_email)) !~ '^[^[:space:]@]+@uwo[.]ca$'
  or p_code_hash is null or length(p_code_hash)<64 or p_expires_at<=now() or p_expires_at>now()+interval '30 minutes'
 then raise exception 'Invalid UWO verification request.' using errcode='22023'; end if;
 insert into marketplace_private.uwo_email_verifications(user_id,uwo_email,code_hash,expires_at,last_sent_at)
 values(p_user_id,lower(trim(p_uwo_email)),p_code_hash,p_expires_at,now())
 on conflict(user_id) do update set uwo_email=excluded.uwo_email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,last_sent_at=excluded.last_sent_at,updated_at=now()
 where marketplace_private.uwo_email_verifications.verified_at is null
  and (marketplace_private.uwo_email_verifications.last_sent_at is null or marketplace_private.uwo_email_verifications.last_sent_at<now()-interval '60 seconds');
 get diagnostics changed=row_count;
 return changed=1;
end;$$;
revoke all on function marketplace_private.begin_uwo_email_verification(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function marketplace_private.begin_uwo_email_verification(uuid,text,text,timestamptz) to service_role;
commit;

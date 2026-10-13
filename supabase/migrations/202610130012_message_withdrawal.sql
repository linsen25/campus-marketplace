-- Sender-only authoritative five-minute withdrawal, retaining audit and Storage objects.
begin;
alter table public.messages add column withdrawn_at timestamptz;
create table marketplace_private.message_withdrawals (
 message_id uuid primary key references public.messages(id) on delete cascade,
 sender_id uuid not null, original_content text, withdrawn_at timestamptz not null
);
alter table marketplace_private.message_withdrawals enable row level security;
revoke all on marketplace_private.message_withdrawals from public,anon,authenticated,service_role;
alter table public.messages drop constraint messages_payload;
alter table public.messages add constraint messages_payload check (
 (withdrawn_at is not null and content is null)
 or (withdrawn_at is null and (
 (type='TEXT' and content is not null and image_count is null and char_length(content) between 1 and 2000
 and content=marketplace_private.trim_message_text(content))
 or (type='IMAGE' and content is null and image_count between 1 and 4))));

create function marketplace_private.protect_message_withdrawal_insert() returns trigger
language plpgsql set search_path='' as $$
begin if new.withdrawn_at is not null then raise exception 'New messages cannot be withdrawn.' using errcode='23514';end if;return new;end;$$;
create trigger messages_withdrawal_insert_guard before insert on public.messages
for each row execute function marketplace_private.protect_message_withdrawal_insert();

create or replace function marketplace_private.protect_sent_message() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.conversations where id=old.conversation_id) then return old;end if;
 if tg_op='UPDATE' and old.withdrawn_at is null and new.content is null
 and old.sender_id=auth.uid() and coalesce(marketplace_private.is_western_user(),false)
 and clock_timestamp()<old.created_at+interval '5 minutes'
 and (to_jsonb(new)-array['withdrawn_at','content'])=(to_jsonb(old)-array['withdrawn_at','content'])
 and exists(select 1 from marketplace_private.message_withdrawals w where w.message_id=old.id
 and w.sender_id=auth.uid() and w.withdrawn_at=new.withdrawn_at and w.original_content is not distinct from old.content)
 then return new;end if;
 raise exception 'Sent messages are immutable except authorized withdrawal.' using errcode='23514';
end;$$;

create function public.marketplace_withdraw_message(p_message_id uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();m public.messages;t timestamptz;cid uuid;
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then raise exception 'Verified sender required.' using errcode='42501';end if;
 select conversation_id into cid from public.messages where id=p_message_id and sender_id=actor;
 if cid is null then raise exception 'Own message required.' using errcode='42501';end if;
 -- Match sends: parent first, then child. No inventory/Order lock is involved.
 perform 1 from public.conversations where id=cid and (buyer_id=actor or seller_id=actor) for update;
 if not found then raise exception 'Participant required.' using errcode='42501';end if;
 select * into m from public.messages where id=p_message_id for update;
 if m.sender_id is distinct from actor then raise exception 'Own message required.' using errcode='42501';end if;
 if m.withdrawn_at is not null then return m;end if;
 t:=clock_timestamp();
 if t>=m.created_at+interval '5 minutes' then raise exception 'Withdrawal deadline passed.' using errcode='23505';end if;
 insert into marketplace_private.message_withdrawals values(m.id,actor,m.content,t);
 update public.messages set content=null,withdrawn_at=t where id=m.id returning * into m;
 return m;
end;$$;
drop policy message_images_participant_read on public.message_images;
create policy message_images_participant_read on public.message_images for select to authenticated using (
 exists(select 1 from public.messages m where m.id=message_id and m.withdrawn_at is null));
create trigger messages_withdrawal_realtime after update of withdrawn_at on public.messages
for each row when(old.withdrawn_at is distinct from new.withdrawn_at)
execute function marketplace_private.notify_message_realtime();
revoke all on function marketplace_private.protect_message_withdrawal_insert(),public.marketplace_withdraw_message(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_withdraw_message(uuid) to authenticated;
commit;

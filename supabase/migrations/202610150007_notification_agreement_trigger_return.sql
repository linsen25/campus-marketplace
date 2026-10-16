-- Complete the notification-only trigger without changing Agreement authority.
begin;
create or replace function marketplace_private.project_agreement_notification() returns trigger
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
 return new;
end;$$;
commit;

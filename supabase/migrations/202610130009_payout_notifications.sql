-- Projection only; no new payout authority or provider execution.
begin;
create function marketplace_private.project_payout_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;recipient uuid;dest jsonb;eid uuid;source text;t timestamptz:=clock_timestamp();
begin
 if tg_table_name='financial_capabilities' then
 if new.capability<>'payout_account' or new.status<>'needs_attention' then return new;end if;
 if tg_op='UPDATE' and old.status=new.status then return new;end if;
 kind:='payout_needs_attention';recipient:=new.user_id;
 source:='payout-capability:'||new.user_id||':'||gen_random_uuid();
 dest:=jsonb_build_object('section','settings','panel','payments-payouts');
 else
 if new.order_protocol_version<>2 or new.payout_status=old.payout_status or new.payout_status not in('failed','paid') then return new;end if;
 kind:=case when new.payout_status='paid' then 'payout_paid' else 'payout_needs_attention' end;
 recipient:=new.seller_id;dest:=jsonb_build_object('section','orders','orderId',new.id);
 source:='payout-order:'||new.id||':'||gen_random_uuid();
 end if;
 -- A privileged async capability/outcome change materially matters to the Seller.
 insert into marketplace_private.notification_events(source_key,event_type,created_at,destination)
 values(source,kind,t,dest) returning id into eid;
 perform marketplace_private.deliver_notification(eid,recipient,case when kind='payout_needs_attention' then 'ACTION_REQUIRED' else 'INFORMATIONAL' end);
 return new;
end;$$;
create trigger financial_payout_notification after insert or update on marketplace_private.financial_capabilities
for each row execute function marketplace_private.project_payout_notification();
create trigger order_payout_notification after update of payout_status on public.orders
for each row execute function marketplace_private.project_payout_notification();
revoke all on function marketplace_private.project_payout_notification() from public,anon,authenticated,service_role;
commit;

-- B32 follow-up: NOT DEPLOYED. No existing order or attestation is rewritten.
-- Interac is participant-attested external payment, never bank/Stripe verified.
begin;

do $migration$
declare
  read_signature regprocedure := 'public.marketplace_interac_payment_state(uuid)'::regprocedure;
  exchange_signature regprocedure := 'public.marketplace_confirm_external_exchange(uuid,uuid)'::regprocedure;
  item record;
  read_owner oid; read_acl aclitem[];
  exchange_owner oid; exchange_acl aclitem[]; exchange_config text[];
  definition text;
  old_fragment text := 'perform marketplace_private.assert_order_progression(o);t:=clock_timestamp();';
  new_fragment text := $guard$if o.terms_snapshot->'terms'->>'payment_mode'='interac_etransfer'
    and not exists (
      select 1 from marketplace_private.interac_payment_confirmations p
       where p.order_id=o.id and p.buyer_reported_at is not null
         and p.seller_received_at is not null
    ) then
    raise exception 'Seller receipt confirmation required before Interac exchange.' using errcode='23514';
  end if;
  perform marketplace_private.assert_order_progression(o);t:=clock_timestamp();$guard$;
begin
  if pg_catalog.has_function_privilege('anon',read_signature,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',exchange_signature,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',read_signature,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',exchange_signature,'EXECUTE') then
    raise exception 'Interac reviewed caller ACL baseline drifted.';
  end if;
  select p.proowner,p.proacl into read_owner,read_acl from pg_catalog.pg_proc p where p.oid=read_signature;
  select p.proowner,p.proacl,p.proconfig into exchange_owner,exchange_acl,exchange_config
    from pg_catalog.pg_proc p where p.oid=exchange_signature;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=read_signature)
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=exchange_signature) then
    raise exception 'Interac function SECURITY DEFINER baseline drifted.';
  end if;
  definition:=pg_catalog.pg_get_functiondef(read_signature);
  if definition not like '%marketplace_private.interac_order_participant(p_order_id)%'
     or definition not like '%seller_received_at%' then
    raise exception 'Interac history projection baseline drifted.';
  end if;
  definition:=pg_catalog.pg_get_functiondef(exchange_signature);
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
     or definition not like '%marketplace_private.lock_order_participant(p_order_id)%'
     or definition not like '%marketplace_private.record_order_flow_command%'
     or definition not like '%marketplace_private.order_agreement_ready(o.id)%'
     or definition like '%Seller receipt confirmation required before Interac exchange.%' then
    raise exception 'External exchange reviewed baseline drifted.';
  end if;
  -- This function already holds Listing -> Order -> external exchange locks.
  -- Report and receipt RPCs also lock the Order before writing attestations.
  -- Thus receipt/completion/cancellation are serialized without new lock order.
  execute replace(definition,old_fragment,new_fragment);
  execute $ddl$
    create or replace function public.marketplace_interac_payment_state(p_order_id uuid)
    returns jsonb language plpgsql security definer set search_path='' as $body$
    declare o public.orders; p marketplace_private.interac_payment_confirmations;
    begin
      if auth.uid() is null or not coalesce(marketplace_private.is_verified_user(),false) then
        raise exception 'Interac order participant required.' using errcode='42501';
      end if;
      select * into o from public.orders where id=p_order_id;
      if o.id is null or o.order_protocol_version<>2
         or (auth.uid() is distinct from o.buyer_id and auth.uid() is distinct from o.seller_id)
         or (o.terms_snapshot->'terms'->>'payment_mode') is distinct from 'interac_etransfer' then
        raise exception 'Interac order participant required.' using errcode='42501';
      end if;
      -- Read authorization intentionally does not require an open order,
      -- holds_listing, or mutable payment eligibility. Those guards remain in
      -- both write RPCs. Historical missing receipts remain missing, not backfilled.
      select * into p from marketplace_private.interac_payment_confirmations where order_id=o.id;
      return pg_catalog.jsonb_build_object('orderId',o.id,'mode','interac_etransfer',
        'buyerReportedAt',p.buyer_reported_at,'buyerReference',p.buyer_reference,
        'sellerReceivedAt',p.seller_received_at,
        'status',case when p.seller_received_at is not null then 'receipt_confirmed'
          when p.buyer_reported_at is not null then 'payment_reported' else 'pending' end);
    end; $body$;
  $ddl$;
  -- CREATE OR REPLACE preserves existing grants. Explicitly assert no ACL,
  -- owner, SECURITY DEFINER or exchange search_path changes. History reader
  -- deliberately gets an empty fixed search_path; all objects are qualified.
  for item in select p.* from pg_catalog.pg_proc p where p.oid in (read_signature,exchange_signature)
  loop
    if not item.prosecdef
       or item.proowner is distinct from (case when item.oid=read_signature then read_owner else exchange_owner end)
       or item.proacl is distinct from (case when item.oid=read_signature then read_acl else exchange_acl end)
       or (item.oid=exchange_signature and item.proconfig is distinct from exchange_config)
       or (item.oid=read_signature and item.proconfig is distinct from array['search_path=""']::text[]) then
      raise exception 'Interac function metadata changed unexpectedly: %',item.oid::regprocedure;
    end if;
  end loop;
end;
$migration$;

-- Defense in depth: any path that attempts a NEW Interac completion must have
-- real participant attestations. Trigger does not change old completed rows.
create function marketplace_private.guard_interac_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.lifecycle_status='completed' and old.lifecycle_status is distinct from new.lifecycle_status
     and (old.terms_snapshot->'terms'->>'payment_mode'='interac_etransfer'
          or new.terms_snapshot->'terms'->>'payment_mode'='interac_etransfer') then
    if new.order_protocol_version<>2 or new.payment_status<>'pending'
       or new.payment_paid_at is not null or new.payout_status<>'not_eligible'
       or not exists(select 1 from marketplace_private.interac_payment_confirmations p
          where p.order_id=new.id and p.buyer_reported_at is not null and p.seller_received_at is not null) then
      raise exception 'Seller receipt confirmation required before Interac completion.' using errcode='23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function marketplace_private.guard_interac_completion() from public,anon,authenticated,service_role;
create trigger orders_interac_receipt_before_completion
before update of lifecycle_status on public.orders
for each row execute function marketplace_private.guard_interac_completion();

commit;

-- B32: ordinary confirmed-email accounts may complete Resale transactions.
-- Western/UWO identity remains a separate capability.  This migration only
-- changes the identity predicate on the explicitly enumerated transaction
-- entry points; ownership, participant, state, media, payout and financial
-- guards remain in the existing function bodies.
begin;

do $migration$
declare
  expected_function_count constant integer := 23;
  expected_replaced_function_count constant integer := 10;
  item record;
  definition text;
  legacy_count integer;
  enumerated_function_count integer := 0;
  replaced_function_count integer := 0;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  for item in
    select v.signature, v.expected_legacy_count, v.should_replace
    from (values
      -- Ordinary Resale and shared handoff/read paths: expected to retain one
      -- legacy Western predicate in the pre-009 deployment baseline.
      ('marketplace_private.lock_order_participant(uuid)',1,true),
      ('public.marketplace_external_exchange(uuid)',1,true),
      ('public.marketplace_confirm_external_exchange(uuid,uuid)',0,false),
      ('public.marketplace_dispute_external_exchange(uuid,text,uuid)',0,false),
      ('public.marketplace_order_agreement(uuid)',1,true),
      ('public.marketplace_confirm_order_agreement(uuid)',1,true),
      ('public.marketplace_generate_handoff_qr(uuid,uuid)',1,true),
      ('public.marketplace_handoff_credential(uuid)',1,true),
      ('public.marketplace_verify_handoff(uuid,text,text,uuid)',1,true),
      ('public.marketplace_order_fulfillment(uuid)',1,true),
      ('public.marketplace_start_order_payment(uuid,uuid)',1,true),
      ('public.marketplace_start_campus_payment(uuid,uuid)',0,false),
      ('public.marketplace_order_snapshot_media(uuid)',1,true),
      -- Historical Delivery/cancellation/courier and other financial paths are
      -- deliberately asserted unchanged. A baseline drift aborts the whole
      -- migration instead of silently widening these capabilities.
      ('public.marketplace_start_delivery_checkout(uuid)',1,false),
      ('public.marketplace_save_delivery_address(uuid,jsonb)',1,false),
      ('public.marketplace_delivery_checkout(uuid)',1,false),
      ('public.marketplace_order_cancellation_state(uuid)',1,false),
      ('public.marketplace_start_seller_delivery(uuid,uuid)',0,false),
      ('public.marketplace_request_delivery_full_refund(uuid,text,text,uuid)',0,false),
      ('public.marketplace_respond_delivery_cancellation(uuid,text,uuid)',0,false),
      ('public.marketplace_record_courier_shipment(uuid,text,text,uuid)',1,false),
      ('public.marketplace_record_trusted_courier_delivery(uuid,text)',0,false),
      ('public.marketplace_confirm_courier_received(uuid,uuid)',0,false)
    ) v(signature, expected_legacy_count, should_replace)
  loop
    enumerated_function_count := enumerated_function_count + 1;
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid);
    select p.proowner, p.prosecdef, p.proconfig, p.proacl
      into before_owner, before_security_definer, before_config, before_acl
      from pg_catalog.pg_proc p
     where p.oid = item.signature::regprocedure::oid;
    if not found then
      raise exception 'Transaction function % is absent from the deployment baseline.', item.signature
        using errcode='P0001';
    end if;
    legacy_count :=
      (length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
      / length('marketplace_private.is_western_user()');
    if legacy_count <> item.expected_legacy_count then
      raise exception 'Transaction function % baseline drifted: expected % Western predicates, found %.',
        item.signature, item.expected_legacy_count, legacy_count using errcode='P0001';
    end if;
    if item.should_replace then
      if legacy_count = 0 then
        raise exception 'Transaction function % was marked for replacement but has no Western predicate.', item.signature
          using errcode='P0001';
      end if;
      replaced_function_count := replaced_function_count + 1;
      execute replace(definition,
        'marketplace_private.is_western_user()',
        'marketplace_private.is_verified_user()');
    end if;
    if item.should_replace and pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid)
       like '%marketplace_private.is_western_user()%' then
      raise exception 'Transaction function % retained a Western-only guard.', item.signature
        using errcode='P0001';
    end if;
    select p.proowner, p.prosecdef, p.proconfig, p.proacl
      into after_owner, after_security_definer, after_config, after_acl
      from pg_catalog.pg_proc p
     where p.oid = item.signature::regprocedure::oid;
    if after_owner is distinct from before_owner
       or after_security_definer is distinct from before_security_definer
       or after_config is distinct from before_config
       or after_acl is distinct from before_acl then
      raise exception 'Transaction function % metadata changed while replacing its identity predicate.', item.signature
        using errcode='P0001';
    end if;
  end loop;
  if enumerated_function_count <> expected_function_count then
    raise exception 'Transaction access allowlist drifted: expected %, enumerated %.',
      expected_function_count, enumerated_function_count using errcode='P0001';
  end if;
  if replaced_function_count <> expected_replaced_function_count then
    raise exception 'Transaction access baseline drifted: expected exactly % Western-only functions, found %.',
      expected_replaced_function_count, replaced_function_count using errcode='P0001';
  end if;
end;
$migration$;

-- Order media preparation is service-role guarded, but its actor must still be
-- a confirmed Auth user.  The historical implementation additionally required
-- @uwo.ca, which blocked ordinary verified Resale users before Order creation.
do $migration$
declare
  signature text := 'public.marketplace_prepare_order_media(uuid,uuid,uuid)';
  definition text := pg_catalog.pg_get_functiondef(signature::regprocedure::oid);
  old_predicate text := $$email_confirmed_at is not null and lower(email)~'^[^[:space:]@]+@uwo[.]ca$'$$;
  before_owner oid;
  after_owner oid;
  before_security_definer boolean;
  after_security_definer boolean;
  before_config text[];
  after_config text[];
  before_acl aclitem[];
  after_acl aclitem[];
begin
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into before_owner, before_security_definer, before_config, before_acl
    from pg_catalog.pg_proc p
   where p.oid = signature::regprocedure::oid;
  if not found then
    raise exception 'Order media preparation function is absent from the deployment baseline.'
      using errcode='P0001';
  end if;
  if position(old_predicate in definition) = 0 then
    raise exception 'Order media preparation identity predicate differs from the reviewed baseline.'
      using errcode='P0001';
  end if;
  execute replace(definition,old_predicate,'email_confirmed_at is not null');
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure::oid);
  if definition like '%@uwo[.]ca%' or definition not like '%email_confirmed_at is not null%' then
    raise exception 'Order media preparation still has an unsafe identity predicate.' using errcode='P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl
    into after_owner, after_security_definer, after_config, after_acl
    from pg_catalog.pg_proc p
   where p.oid = signature::regprocedure::oid;
  if after_owner is distinct from before_owner
     or after_security_definer is distinct from before_security_definer
     or after_config is distinct from before_config
     or after_acl is distinct from before_acl then
    raise exception 'Order media preparation metadata changed while replacing its identity predicate.'
      using errcode='P0001';
  end if;
end;
$migration$;

commit;

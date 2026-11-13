-- B32 follow-up (not deployed in this round): ordinary confirmed-email Resale
-- participants must be able to read the order projections that the server
-- uses to render an Order workspace.  Mutation and payment entry points keep
-- their existing Western/Seller-Ready guards.
begin;

do $migration$
declare
  item record;
  definition text;
  legacy_count integer;
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
    select v.signature
    from (values
      ('public.marketplace_order_economics(uuid)'),
      ('public.marketplace_order_meetup_history(uuid)'),
      ('public.marketplace_campus_payment_state(uuid)')
    ) v(signature)
  loop
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid);
    select p.proowner, p.prosecdef, p.proconfig, p.proacl
      into before_owner, before_security_definer, before_config, before_acl
      from pg_catalog.pg_proc p
     where p.oid = item.signature::regprocedure::oid;
    if not found then
      raise exception 'Projection function % is absent from the reviewed baseline.', item.signature
        using errcode='P0001';
    end if;
    legacy_count :=
      (length(definition)-length(replace(definition,'marketplace_private.is_western_user()','')))
      / length('marketplace_private.is_western_user()');
    if legacy_count <> 1 then
      raise exception 'Projection function % baseline drifted: expected one Western predicate, found %.',
        item.signature, legacy_count using errcode='P0001';
    end if;
    execute replace(definition,
      'marketplace_private.is_western_user()',
      'marketplace_private.is_verified_user()');
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure::oid);
    if definition like '%marketplace_private.is_western_user()%' or
       definition not like '%marketplace_private.is_verified_user()%' then
      raise exception 'Projection function % did not receive the verified-user guard.', item.signature
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
      raise exception 'Projection function % metadata changed unexpectedly.', item.signature
        using errcode='P0001';
    end if;
  end loop;
end;
$migration$;

-- Meeting Location is intentionally optional for a Resale offer.  The initial
-- V2 order snapshot may therefore have no location yet, and the UI renders
-- that state as "To be arranged".  Once a participant proposes a replacement
-- meetup, marketplace_private.validate_meetup() still requires a real,
-- bounded location.  Keep the invariant in the database: NULL is allowed only
-- for the immutable revision-0 confirmed snapshot; every later revision must
-- contain a non-empty, trimmed location.  Existing rows are not rewritten.
do $migration$
declare
  old_definition text;
  old_not_null boolean;
begin
  select a.attnotnull
    into old_not_null
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.order_meetup_revisions'::regclass
     and a.attname = 'location'
     and not a.attisdropped;
  if old_not_null is distinct from true then
    raise exception 'Meetup location nullability baseline drifted.' using errcode='P0001';
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid)
    into old_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.order_meetup_revisions'::regclass
     and c.conname = 'order_meetup_revisions_location_check'
     and c.contype = 'c';
  if old_definition is null
     or old_definition not like '%char_length(location)%'
     or old_definition not like '%btrim(location)%' then
    raise exception 'Meetup location constraint baseline drifted.' using errcode='P0001';
  end if;
  if pg_catalog.pg_get_functiondef(
       'marketplace_private.validate_offer_terms(jsonb,timestamptz)'::regprocedure::oid
     ) not like '%Invalid optional meeting location or zoned time.%' then
    raise exception 'Offer validator baseline drifted: optional meeting location rule missing.'
      using errcode='P0001';
  end if;
  if pg_catalog.pg_get_functiondef(
       'marketplace_private.validate_meetup(jsonb,timestamptz)'::regprocedure::oid
     ) not like '%Invalid meetup fields.%' then
    raise exception 'Meetup proposal validator is absent from the reviewed baseline.'
      using errcode='P0001';
  end if;
  if pg_catalog.pg_get_functiondef(
       'marketplace_private.seed_order_meetup()'::regprocedure::oid
     ) not like '%order_meetup_revisions%meetup_location%' then
    raise exception 'Order meetup seed trigger baseline drifted.' using errcode='P0001';
  end if;
  if pg_catalog.pg_get_functiondef(
       'marketplace_private.protect_meetup_revision()'::regprocedure::oid
     ) not like '%new.location is distinct from btrim(o.terms_snapshot%' then
    raise exception 'Meetup revision protection baseline drifted.' using errcode='P0001';
  end if;
  execute 'alter table public.order_meetup_revisions alter column location drop not null';
  execute 'alter table public.order_meetup_revisions drop constraint order_meetup_revisions_location_check';
  execute $$alter table public.order_meetup_revisions
    add constraint order_meetup_revisions_location_check check (
      (location is null and revision = 0 and status = 'confirmed')
      or (location is not null
          and char_length(location) between 1 and 120
          and location = btrim(location))
    )$$;
end;
$migration$;

commit;

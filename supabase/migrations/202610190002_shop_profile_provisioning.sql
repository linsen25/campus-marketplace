-- Explicit owner provisioning only; never membership, trial or public activation.
begin;

create function public.marketplace_create_shop(p_input jsonb)
returns table (
  id uuid,
  owner_id uuid,
  name text,
  category text,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_category text;
  v_description text;
  v_trim_chars constant text :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if v_actor is null
     or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;

  -- Lock only the current caller's existing Profile against concurrent removal.
  perform 1 from public.profiles p where p.id = v_actor for key share;
  if not found then
    raise exception 'Eligible profile required.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Provide valid Shop profile fields.' using errcode = '23514';
  end if;
  if not (p_input ?& array['name', 'category', 'description'])
     or exists (
       select 1 from jsonb_object_keys(p_input) as fields(key)
       where fields.key not in ('name', 'category', 'description')
     ) then
    raise exception 'Provide only name, category, and description.'
      using errcode = '23514';
  end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'category') is distinct from 'string'
     or jsonb_typeof(p_input->'description') is distinct from 'string' then
    raise exception 'Shop profile fields must be text.' using errcode = '23514';
  end if;

  v_name := btrim(p_input->>'name', v_trim_chars);
  v_description := btrim(p_input->>'description', v_trim_chars);
  -- Creation requires an exact allowed category, not normalization of a new enum.
  v_category := p_input->>'category';
  if marketplace_private.shop_profile_text_length(v_name) not between 1 and 40
     or marketplace_private.shop_profile_text_length(v_description) not between 1 and 200
     or v_category not in (
       'Clothing & Accessories', 'Electronics', 'Collectibles', 'Home & Living'
     ) then
    raise exception 'Check the Shop profile fields.' using errcode = '23514';
  end if;

  return query
    insert into public.shops as created (owner_id, name, category, description)
    values (v_actor, v_name, v_category, v_description)
    on conflict on constraint shops_owner_id_key do nothing
    returning created.id, created.owner_id, created.name, created.category,
              created.description, created.created_at, created.updated_at;
  if not found then
    raise exception 'Shop already exists.' using errcode = '23505';
  end if;
end;
$function$;

revoke all on function public.marketplace_create_shop(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_create_shop(jsonb) to authenticated;

commit;

-- Product-scoped Shop contact for ordinary verified accounts.
-- Shop Offers, Orders and financial operations remain blocked by B14 guards.
begin;

create or replace function marketplace_private.protect_conversation_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare source public.listings;
begin
 if tg_op='INSERT' then
  if auth.uid() is null or not coalesce(marketplace_private.is_verified_user(),false)
   or new.buyer_id is distinct from auth.uid() or new.seller_id is null or new.listing_id is null
   or new.listing_origin_id is distinct from new.listing_id then
   raise exception 'Verified buyer and real listing participants required.' using errcode='42501'; end if;
  select * into source from public.listings l where l.id=new.listing_id for share;
  if not found or source.published_at is null or source.status<>'available'
   or source.seller_id is distinct from new.seller_id or new.buyer_id=source.seller_id then
   raise exception 'Only another seller''s published available listing can start a conversation.' using errcode='23514'; end if;
  new.listing_title_snapshot:=source.title; new.listing_price_cents_snapshot:=source.price_cents;
  new.listing_currency_snapshot:=source.currency; new.listing_category_snapshot:=source.category;
  new.listing_channel_snapshot:=source.listing_channel; new.shop_name_snapshot:=null;
  if source.listing_channel='shop' then
   select name into new.shop_name_snapshot from public.shops where owner_id=source.seller_id for share;
   if not found or marketplace_private.shop_profile_text_length(new.shop_name_snapshot) not between 1 and 40 then
    raise exception 'Shop profile required for Shop Conversation.' using errcode='23514'; end if;
  end if;
  new.created_at:=clock_timestamp(); new.updated_at:=now(); new.last_message_at:=null;
  new.last_message_sequence:=0; new.buyer_last_read_sequence:=0; new.seller_last_read_sequence:=0;
  return new;
 end if;
 if row(new.id,new.listing_origin_id,new.created_at,new.listing_title_snapshot,new.listing_price_cents_snapshot,new.listing_currency_snapshot,new.listing_category_snapshot,new.listing_channel_snapshot,new.shop_name_snapshot)
  is distinct from row(old.id,old.listing_origin_id,old.created_at,old.listing_title_snapshot,old.listing_price_cents_snapshot,old.listing_currency_snapshot,old.listing_category_snapshot,old.listing_channel_snapshot,old.shop_name_snapshot)
 then raise exception 'Conversation identity and listing snapshot are immutable.' using errcode='23514'; end if;
 if new.listing_id is distinct from old.listing_id and not (new.listing_id is null and not exists(select 1 from public.listings l where l.id=old.listing_id)) then
  raise exception 'The live listing reference cannot be reassigned.' using errcode='23514'; end if;
 if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles p where p.id=old.buyer_id)) then
  raise exception 'The buyer cannot be reassigned.' using errcode='23514'; end if;
 if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles p where p.id=old.seller_id)) then
  raise exception 'The seller cannot be reassigned.' using errcode='23514'; end if;
 if new.buyer_last_read_sequence<old.buyer_last_read_sequence or new.seller_last_read_sequence<old.seller_last_read_sequence then
  raise exception 'Read watermarks cannot move backwards.' using errcode='23514'; end if;
 return new;
end;$$;

create or replace function public.marketplace_find_or_create_conversation(p_listing_id uuid)
returns public.conversations language plpgsql security definer set search_path='' as $$
declare source public.listings; target public.conversations; actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
  raise exception 'Verified email required.' using errcode='42501'; end if;
 select * into target from public.conversations where listing_origin_id=p_listing_id and buyer_id=actor;
 if found then return target; end if;
 select * into source from public.listings l where l.id=p_listing_id for share;
 if not found or source.published_at is null or source.status<>'available' then
  raise exception 'A published available listing is required.' using errcode='23514'; end if;
 if source.seller_id=actor then raise exception 'You cannot start a conversation with yourself.' using errcode='23514'; end if;
 insert into public.conversations(listing_origin_id,listing_id,buyer_id,seller_id,listing_title_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot)
 values(source.id,source.id,actor,source.seller_id,source.title,source.price_cents,source.currency,source.category)
 on conflict on constraint conversations_identity do nothing returning * into target;
 if not found then
  select * into target from public.conversations c where c.listing_origin_id=source.id and c.buyer_id=actor and c.seller_id=source.seller_id;
  if not found then raise exception 'Retry conversation creation after concurrent change.' using errcode='40001'; end if;
 end if;
 return target;
end;$$;
revoke all on function public.marketplace_find_or_create_conversation(uuid) from public,anon,service_role;
grant execute on function public.marketplace_find_or_create_conversation(uuid) to authenticated;

commit;

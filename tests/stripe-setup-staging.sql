-- All fixtures are synthetic and rolled back by the caller.
create temporary table stripe_people as select gen_random_uuid() uid;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
 select uid,'stripe_'||uid||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','SP_'||left(replace(uid::text,'-',''),12)) from stripe_people;
create function pg_temp.stripe_assert(v boolean,label text) returns void language plpgsql as $$begin if v is not true then raise exception 'Stripe assertion: %',label;end if;end;$$;
do $$declare u uuid;b jsonb;c jsonb;ev jsonb;old_lease uuid;begin
 select uid into u from stripe_people;
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);
 b:=public.marketplace_stripe_binding('claim',u,'payment_method','acct_Synthetic');
 old_lease:=(b->>'lease')::uuid;
 perform pg_temp.stripe_assert(public.marketplace_stripe_binding('claim',u,'payment_method','acct_Synthetic') is null,'concurrent lease rejected');
 begin
  perform public.marketplace_stripe_binding('patch',u,'payment_method','acct_Synthetic',gen_random_uuid(),'{"status":"set"}');
  raise exception 'Stale writer accepted';
 exception when serialization_failure then null;end;
 b:=public.marketplace_stripe_binding('patch',u,'payment_method','acct_Synthetic',old_lease,'{"owner_ref":"cus_Synthetic"}');
 b:=public.marketplace_stripe_binding('prepare_setup',u,'payment_method','acct_Synthetic',old_lease);
 c:=public.marketplace_stripe_binding('prepare_setup',u,'payment_method','acct_Synthetic',old_lease);
 perform pg_temp.stripe_assert(b->>'setup_operation'=c->>'setup_operation','unknown-result operation reused');
 b:=public.marketplace_stripe_binding('patch',u,'payment_method','acct_Synthetic',old_lease,'{"setup_ref":"seti_Synthetic","instrument_ref":"pm_Synthetic","status":"set","label":"Test card","last4":"4242","project":true}');
 c:=public.marketplace_stripe_capabilities(u,'acct_Synthetic');
 perform pg_temp.stripe_assert(c#>>'{paymentMethod,status}'='set' and c#>>'{payoutAccount,status}'='unset','independent safe projections');
 perform pg_temp.stripe_assert(not(c::text~'cus_|pm_|seti_|acct_'),'no private references in DTO');
 begin
  perform public.marketplace_stripe_binding('patch',u,'payment_method','acct_Synthetic',old_lease,'{"owner_ref":"cus_Another"}');
  raise exception 'Owner replaced';
 exception when raise_exception then if sqlerrm='Owner replaced' then raise;end if;end;
 perform public.marketplace_stripe_binding('release',u,'payment_method','acct_Synthetic',old_lease);
 b:=public.marketplace_stripe_binding('claim',u,'payout_account','acct_Synthetic');
 perform pg_temp.stripe_assert(b->>'status'='unset','unfinished onboarding is independently retained');
 perform public.marketplace_stripe_binding('patch',u,'payout_account','acct_Synthetic',(b->>'lease')::uuid,'{"owner_ref":"acct_SellerSynthetic","status":"needs_attention","project":true}');
 perform public.marketplace_stripe_events('enqueue','acct_Synthetic','{"id":"evt_synthetic","type":"payment_method.detached","scope":"acct_Synthetic","owner":"pm_Synthetic"}');
 perform public.marketplace_stripe_events('enqueue','acct_Synthetic','{"id":"evt_synthetic","type":"payment_method.detached","scope":"acct_Synthetic","owner":"pm_Synthetic"}');
 perform pg_temp.stripe_assert((select count(*)=1 from marketplace_private.stripe_webhook_inbox where event_id='evt_synthetic'),'event deduplication');
 ev:=public.marketplace_stripe_events('claim','acct_Synthetic');
 perform pg_temp.stripe_assert(ev#>>'{binding,user_id}'=u::text,'detached PM resolves its private binding');
 perform pg_temp.stripe_assert(public.marketplace_stripe_events('claim','acct_Synthetic') is null,'worker claim exclusion');
 perform public.marketplace_stripe_events('done','acct_Synthetic',jsonb_build_object('id',ev->>'event_id','scope',ev->>'account_scope','lease',ev->>'lease'));
 perform pg_temp.stripe_assert(public.marketplace_stripe_events('claim','acct_Synthetic') is null,'completed event not replayed');
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  perform public.marketplace_stripe_capabilities(u,'acct_Synthetic');raise exception 'Untrusted service accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"role":"service_role","ref":"not-staging"}',true);
 begin
  perform public.marketplace_stripe_capabilities(u,'acct_Synthetic');raise exception 'Wrong target accepted';
 exception when insufficient_privilege then null;end;
 perform pg_temp.stripe_assert(not has_function_privilege('authenticated','public.marketplace_stripe_binding(text,uuid,text,text,uuid,jsonb)','execute'),'browser cannot write binding');
 perform pg_temp.stripe_assert(not has_table_privilege('service_role','marketplace_private.stripe_bindings','select'),'no direct binding table exposure');
end;$$;
select 'PASS Stripe private bindings, leases, stable operations, projections, inbox dedup/worker fencing, staging and privilege guards' result;

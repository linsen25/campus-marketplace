do $$declare seller uuid;n bigint;begin
select p.seller into seller from bc_people p;
perform public.marketplace_record_financial_capability(seller,'payout_account','needs_attention','staging_test','bc_fixture','bc_payout','Test Bank','6789');
perform public.marketplace_record_financial_capability(seller,'payout_account','needs_attention','staging_test','bc_fixture','bc_payout','Test Bank','6789');
perform pg_temp.bc_assert((select count(*)=1 from public.notifications where recipient_user_id=seller and event_type='payout_needs_attention' and priority='ACTION_REQUIRED' and destination->>'section'='settings'),'one attention notification on authoritative capability transition');
perform pg_temp.bc_assert(not has_function_privilege('authenticated','marketplace_private.project_payout_notification()','EXECUTE'),'private projection inaccessible');
end;$$;

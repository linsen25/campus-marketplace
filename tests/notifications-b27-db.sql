-- B27-A Shop/membership notification projection in the disposable B14/B26 DB.
select public.b14_assert(
 not has_function_privilege('anon','marketplace_private.emit_authoritative_notification(text,text,uuid,text,jsonb,timestamptz)','execute')
 and not has_function_privilege('authenticated','marketplace_private.project_shop_membership_notification()','execute')
 and not has_function_privilege('service_role','marketplace_private.project_shop_suspension_notification()','execute'),
 'B27 projectors have no client or service-role execution surface');

select public.b14_assert(
 (select count(*)=2 from marketplace_private.notification_events
  where source_key like 'shop-membership:'||public.b14_owner(90)::text||':purchase:%'
   and event_type='shop_membership_access_started')
 and (select count(*)=1 from marketplace_private.notification_events e
  join public.notifications n on n.domain_event_id=e.id
  where e.source_key like 'shop-suspension:%:suspended' and n.recipient_user_id=public.b14_owner(90)
   and e.event_type='shop_suspended' and n.priority='INFORMATIONAL'
   and n.destination=jsonb_build_object('section','shop','destination','my-shop'))
 and (select count(*)=1 from marketplace_private.notification_events e
  join public.notifications n on n.domain_event_id=e.id
  where e.source_key like 'shop-suspension:%:reopened' and n.recipient_user_id=public.b14_owner(90)
   and e.event_type='shop_reopened'),
 'authoritative entitlement effects and one suspension/reopen cycle notify the owner once');

select public.b14_assert(
 not exists(select 1 from marketplace_private.notification_events e
  join public.messages m on e.source_key='message:'||m.id::text
  where m.origin='marketplace_auto_reply'),
 'B26 UU System messages never create ordinary new-message notifications');

select public.b14_assert(
 (select count(*)=1 from marketplace_private.notification_events e
  join public.transaction_events t on e.source_key='transaction:'||t.id::text
  where t.event_type='offer_closed' and t.metadata->>'reason'='shop_membership_suspended')
 and (select count(*)=2 from public.notifications n join marketplace_private.notification_events e on e.id=n.domain_event_id
  join public.transaction_events t on e.source_key='transaction:'||t.id::text
  where t.event_type='offer_closed' and t.metadata->>'reason'='shop_membership_suspended'),
 'suspension Offer closure reuses one existing transaction event and participant fanout');

select public.b14_assert(
 not exists(select 1 from marketplace_private.notification_deliveries d
  join public.notifications n on n.id=d.notification_id
  where n.event_type in('shop_trial_activated','shop_membership_access_started',
   'shop_membership_access_upgraded','shop_suspended','shop_reopened')),
 'new B27 event types remain in-app only and do not enter the email outbox');

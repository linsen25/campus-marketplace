// Read-only B07 preflight. No Auth writes or business RPC execution.
const fs = require('node:fs'),
  crypto = require('node:crypto')
const { environment, query } = require('../scripts/v2-maintenance-staging.cjs')
const env = environment(),
  ref = 'pcaqxezdfxofysghssyo'
if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`)
  throw Error('Wrong project')
const names = [
  'marketplace_submit_offer',
  'marketplace_deny_offer',
  'marketplace_withdraw_offer',
  'mutate_offer_revision',
  'offer_accept_eligibility',
  'expire_conversation_offers',
  'marketplace_offer_accept_preflight',
  'marketplace_accept_offer',
  'marketplace_prepare_order_media',
  'marketplace_verify_order_media',
  'bind_order_media',
  'marketplace_claim_order_media_cleanup',
  'marketplace_order_media_delete_lease',
  'marketplace_finish_order_media_cleanup',
  'protect_order',
  'protect_order_request',
  'protect_transaction_event',
  'protect_v2_order_economics',
  'protect_listing_inventory',
  'run_transaction_due_work',
  'settle_delivery_checkout',
  'settle_order_meetup',
  'settle_order_protection',
  'external_exchange_started',
  'notify_notification_delivery',
  'notification_email_enabled',
  'deliver_notification',
  'project_transaction_notification',
  'require_seller_payout_ready',
  'create_profile',
  'enforce_western_email',
]
const literals = names.map((n) => "'" + n + "'").join(',')
const rows = query(`begin read only;select jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'body',p.prosrc,'acl',p.proacl,'securityDefiner',p.prosecdef)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','marketplace_private') and p.proname in (${literals})),
'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public)) from storage.buckets where id in('listing-images-private','order-snapshot-media')),
'jobs',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'commandHash',md5(command),'transactionWorker',command like '%marketplace_private.run_transaction_due_work()%','emailWorker',command like '%marketplace_private.invoke_email_worker()%')) from cron.job where jobname in('marketplace-v2-transaction-due-work','marketplace-notification-email')),
'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'type',contype,'definition',pg_get_constraintdef(oid))) from pg_constraint where conrelid in('public.order_requests'::regclass,'public.orders'::regclass,'public.transaction_events'::regclass,'marketplace_private.order_media_batches'::regclass,'marketplace_private.order_media_assets'::regclass,'marketplace_private.order_snapshot_media'::regclass,'marketplace_private.v2_order_economics'::regclass)),
'foreignKeys',(select jsonb_agg(jsonb_build_object('from',conrelid::regclass::text,'to',confrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where contype='f' and confrelid in('public.order_requests'::regclass,'public.orders'::regclass,'public.conversations'::regclass,'public.listings'::regclass,'public.profiles'::regclass,'marketplace_private.order_media_batches'::regclass,'marketplace_private.order_media_assets'::regclass)),
'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,'qual',qual,'check',with_check,'permissive',permissive)) from pg_policies where (schemaname='public' and tablename in('order_requests','orders','transaction_events')) or (schemaname='storage' and (coalesce(qual,'')||coalesce(with_check,'')) like '%order-snapshot-media%')),
'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and p.proname in ('protect_order_request','protect_order','protect_transaction_event','protect_v2_order_economics')),
'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as preflight;rollback;`)[0].preflight
const receipt = {
  projectRef: ref,
  checkedAt: new Date().toISOString(),
  ...rows,
}
fs.writeFileSync(
  'tests/artifacts/b07-strict-preflight.json',
  JSON.stringify(receipt, null, 2)
)
console.log(
  JSON.stringify(
    {
      projectRef: ref,
      functions: rows.functions.length,
      buckets: rows.buckets,
      jobs: rows.jobs,
      foreignKeys: rows.foreignKeys.length,
      policies: rows.policies.length,
      receiptHash: crypto
        .createHash('sha256')
        .update(JSON.stringify(receipt))
        .digest('hex'),
    },
    null,
    2
  )
)

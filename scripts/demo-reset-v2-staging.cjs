// Administrative TEST RESET only. No runtime API or domain retention changes.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const {
  environment,
  query,
  q,
  ids,
  hash,
  block,
} = require('./v2-maintenance-staging.cjs')
const allow = require('./canonical-demo-allowlist.cjs')
const orderTables = [
  'marketplace_private.notification_reminders',
  'marketplace_private.buyer_receipt_commands',
  'marketplace_private.courier_commands',
  'marketplace_private.courier_shipments',
  'marketplace_private.protection_cases',
  'marketplace_private.order_protection',
  'marketplace_private.handoff_authorizations',
  'marketplace_private.delivery_checkouts',
  'marketplace_private.v2_order_economics',
  'marketplace_private.campus_payment_attempts',
  'marketplace_private.campus_inspections',
  'marketplace_private.meetup_commands',
  'marketplace_private.meetup_expiries',
  'public.order_meetup_revisions',
  'marketplace_private.order_snapshot_media',
]
function validate(scope, targets) {
  assert(
    targets.every(
      (id) =>
        Object.hasOwn(allow.listings, id) &&
        !allow.protectedListings.includes(id)
    ),
    'Non-allowlisted/protected Listing'
  )
  assert.equal(
    scope.listings.length,
    targets.length,
    'Missing canonical Listing'
  )
  for (const l of scope.listings)
    assert.equal(l.seller_id, allow.listings[l.id], 'Listing owner mismatch')
  for (const c of scope.conversations)
    assert(
      targets.includes(c.listing_id) &&
        allow.buyers.includes(c.buyer_id) &&
        c.seller_id === allow.listings[c.listing_id],
      'Ambiguous conversation ownership'
    )
  for (const r of scope.offers) {
    const c = scope.conversations.find((c) => c.id === r.conversation_id)
    assert.equal(
      r.protocol_version,
      2,
      'V1 history protected: refuse whole scope'
    )
    assert(
      c &&
        c.listing_id === r.listing_id &&
        c.buyer_id === r.buyer_id &&
        c.seller_id === r.seller_id,
      'Ambiguous Offer relationship'
    )
    assert(!allow.protectedOffers.includes(r.id), 'Protected Offer')
    assert(
      [c.buyer_id, c.seller_id].includes(r.sender_user_id) &&
        [c.buyer_id, c.seller_id].includes(r.recipient_user_id) &&
        r.sender_user_id !== r.recipient_user_id,
      'Invalid Offer participants'
    )
  }
  for (const o of scope.orders) {
    assert.equal(o.order_protocol_version, 2, 'V1 Order protected')
    assert(!allow.protectedOrders.includes(o.id), 'Protected Order')
    const r = scope.offers.find((r) => r.id === o.request_id)
    assert(
      r &&
        r.listing_id === o.listing_id &&
        r.conversation_id === o.conversation_id &&
        r.buyer_id === o.buyer_id &&
        r.seller_id === o.seller_id,
      'Ambiguous Order relationship'
    )
  }
  for (const l of scope.listings)
    if (l.reserved_order_id)
      assert(
        scope.orders.some(
          (o) => o.id === l.reserved_order_id && o.holds_listing
        ),
        'Unrelated inventory hold'
      )
  for (const b of scope.batches)
    assert(
      scope.offers.some((r) => r.id === b.offer_id) &&
        (!b.order_id || scope.orders.some((o) => o.id === b.order_id)) &&
        targets.includes(b.listing_id) &&
        allow.buyers.includes(b.buyer_id) &&
        b.seller_id === allow.listings[b.listing_id] &&
        [b.buyer_id, b.seller_id].includes(b.actor_id),
      'Unrelated snapshot batch'
    )
  return scope
}
function inspectSQL(targets) {
  const ls = ids(targets)
  const rr = `select id from public.order_requests where listing_id in(${ls})`
  const oo = `select id from public.orders where listing_id in(${ls})`
  return `select jsonb_build_object(
 'listings',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.listings t where id in(${ls})),'[]'),
 'conversations',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.conversations t where listing_id in(${ls})),'[]'),
 'offers',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.order_requests t where listing_id in(${ls})),'[]'),
 'orders',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.orders t where listing_id in(${ls})),'[]'),
 'batches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'offer_id',offer_id,'order_id',order_id,'listing_id',listing_id,'actor_id',actor_id,'buyer_id',buyer_id,'seller_id',seller_id) order by id) from marketplace_private.order_media_batches where listing_id in(${ls})),'[]'),
 'dependencies',jsonb_build_object(${orderTables
   .map((t) => `${q(t)},(select count(*) from ${t} where order_id in(${oo}))`)
   .join(',')}),
 'events',(select count(*) from public.transaction_events where request_id in(${rr}) or order_id in(${oo})),
 'notifications',(select count(*) from public.notifications where destination->>'orderId' in(select id::text from public.orders where listing_id in(${ls})) or destination->>'offerId' in(select id::text from public.order_requests where listing_id in(${ls}))),
 'snapshotAssets',(select count(*) from marketplace_private.order_media_assets where batch_id in(select id from marketplace_private.order_media_batches where listing_id in(${ls})))) scope`
}
function retainedSQL(targets) {
  const ls = ids(targets)
  const tables = [
    'public.messages',
    'public.message_images',
    'public.conversations',
    'public.listing_images',
    'public.listing_favorites',
    'public.profiles',
    'marketplace_private.financial_capabilities',
  ]
  const hashTable = (t, where = '') =>
    `select ${q(
      t
    )} name,count(*) count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${t} t ${where}`
  return tables
    .map((t) => hashTable(t))
    .concat(
      hashTable('public.order_requests', `where listing_id not in(${ls})`),
      hashTable('public.orders', `where listing_id not in(${ls})`),
      hashTable(
        'public.transaction_events',
        `where request_id not in(select id from public.order_requests where listing_id in(${ls}))`
      ),
      ...orderTables.map((t) =>
        hashTable(
          t,
          `where order_id not in(select id from public.orders where listing_id in(${ls}))`
        )
      ),
      hashTable(
        'marketplace_private.order_media_batches',
        `where listing_id not in(${ls})`
      ),
      hashTable(
        'marketplace_private.order_media_assets',
        `where batch_id not in(select id from marketplace_private.order_media_batches where listing_id in(${ls}))`
      ),
      `select 'listing-content' name,count(*) count,md5(coalesce(string_agg(row::text,'' order by row::text),'')) hash from(select case when id in(${ls}) then to_jsonb(l)-array['status','reserved_order_id','updated_at'] else to_jsonb(l) end row from public.listings l)x`
    )
    .join(' union all ')
}
async function main(args = process.argv.slice(2)) {
  environment()
  const targets = [],
    explicitOffers = []
  let apply = false,
    expectedHash
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true
    else if (args[i] === '--listing') targets.push(args[++i])
    else if (args[i] === '--offer') explicitOffers.push(args[++i])
    else if (args[i] === '--plan-sha') expectedHash = args[++i]
    else throw Error('Unknown argument')
  }
  if (!targets.length) targets.push(...Object.keys(allow.listings))
  assert.equal(
    new Set(targets).size,
    targets.length,
    'Duplicate Listing target'
  )
  assert(
    targets.every((id) => Object.hasOwn(allow.listings, id)),
    'Non-allowlisted Listing: rejected before network'
  )
  const sql = inspectSQL(targets),
    scope = validate(
      query('begin read only;' + sql + ';rollback;')[0].scope,
      targets
    )
  const planHash = hash(scope)
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY RUN',
        project: 'pcaqxezdfxofysghssyo',
        planSha: planHash,
        listings: scope.listings.map((l) => ({
          id: l.id,
          title: l.title,
          status: l.status,
          owner: l.seller_id,
        })),
        conversations: scope.conversations.map((c) => ({
          id: c.id,
          buyer: c.buyer_id,
          seller: c.seller_id,
        })),
        offers: scope.offers.map((r) => ({
          id: r.id,
          status: r.status,
          conversation: r.conversation_id,
        })),
        orders: scope.orders.map((o) => ({
          id: o.id,
          status: o.lifecycle_status,
          payment: o.payment_status,
        })),
        dependencies: scope.dependencies,
        events: scope.events,
        notifications: scope.notifications,
        snapshotBatches: scope.batches,
        snapshotAssets: scope.snapshotAssets,
      },
      null,
      2
    )
  )
  if (!apply) return
  if (!scope.offers.length && !scope.orders.length && !scope.batches.length) {
    console.log('No disposable V2 transactions; zero writes.')
    return
  }
  assert.equal(
    expectedHash,
    planHash,
    'Use exact dry-run --plan-sha; stale plan rejected'
  )
  assert.deepEqual(
    [...new Set(explicitOffers)].sort(),
    scope.offers.map((r) => r.id).sort(),
    'Apply requires explicit --offer UUID for EVERY disposable Offer; no automatic history selection'
  )
  const allowedDependencies = new Set([
    ...orderTables,
    'public.listings',
    'public.orders',
    'public.order_requests',
    'public.transaction_events',
    'marketplace_private.offer_accept_commands',
    'marketplace_private.offer_commands',
    'marketplace_private.order_commands',
    'marketplace_private.order_media_batches',
    'marketplace_private.order_media_assets',
    'marketplace_private.order_media_commands',
  ])
  const graph = query(
    "begin read only;select conrelid::regclass::text child from pg_constraint where contype='f' and confrelid in('public.orders'::regclass,'public.order_requests'::regclass,'marketplace_private.order_media_batches'::regclass,'marketplace_private.order_media_assets'::regclass);rollback;"
  )
  assert(
    graph.every((r) =>
      allowedDependencies.has(
        r.child.includes('.') ? r.child : 'public.' + r.child
      )
    ),
    'Unknown dependency: review before reset'
  )
  const retained = retainedSQL(targets),
    beforeRetained = query('begin read only;' + retained + ';rollback;')
  const originalEnv = hash(fs.readFileSync('.env.local'))
  const rs = ids(scope.offers.map((r) => r.id)),
    os = ids(scope.orders.map((o) => o.id)),
    bs = ids(scope.batches.map((b) => b.id))
  const affected = new Set(
    [...scope.offers, ...scope.orders, ...scope.batches].map(
      (r) => r.listing_id
    )
  )
  const affectedIds = ids([...affected])
  const journal = path.resolve(
    'tests/artifacts/v2-maintenance/reset-journal.json'
  )
  assert(
    !fs.existsSync(journal),
    'Unfinished reset journal: inspect/reconcile first; never overwrite'
  )
  fs.mkdirSync(path.dirname(journal), { recursive: true })
  fs.writeFileSync(
    journal,
    JSON.stringify({
      targets,
      offers: scope.offers.map((r) => r.id),
      orders: scope.orders.map((o) => o.id),
      batches: scope.batches.map((b) => b.id),
      planHash,
      beforeRetained,
    }),
    { flag: 'wx' }
  )
  const fence =
    block(`begin if exists(select 1 from public.order_requests where id not in(${rs}) and replacement_request_id in(${rs})) or exists(select 1 from marketplace_private.offer_commands where offer_id not in(${rs}) and (previous_offer_id in(${rs}) or comparison_offer_id in(${rs}))) then raise exception 'External history reference';end if;
  if exists(select 1 from marketplace_private.order_snapshot_media where order_id not in(${os}) and asset_id in(select id from marketplace_private.order_media_assets where batch_id in(${bs}))) then raise exception 'Foreign snapshot binding';end if;
  if (select scope from (${sql}) x) is distinct from ${q(
      JSON.stringify(scope)
    )}::jsonb then raise exception 'Reset scope changed';end if;end;`)
  // Media deletion is a recoverable two-phase maintenance operation: first detach
  // exact bindings, then reuse the existing lease/manifest/object-verification RPCs.
  // Orders/Offers remain until every exact batch is safely cleaned. Never sweep globally.
  query(`begin;set local lock_timeout='10s';lock table public.listings,public.orders,public.order_requests,public.conversations,marketplace_private.order_media_batches,marketplace_private.order_snapshot_media in access exclusive mode;${fence}
 delete from marketplace_private.order_snapshot_media where order_id in(${os});
 update marketplace_private.order_media_batches set order_id=null,state='prepared',expires_at=clock_timestamp()-interval '1 second' where id in(${bs}) and state in('bound','prepared','preparing');commit;`)
  const env = environment()
  Object.assign(process.env, env)
  const ts = require('typescript'),
    Module = require('node:module'),
    resolve = Module._resolveFilename
  Module._resolveFilename = function (id, ...rest) {
    return resolve.call(
      this,
      id.startsWith('@/') ? path.resolve(id.slice(2)) : id,
      ...rest
    )
  }
  require.extensions['.ts'] = (m, f) =>
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      }).outputText,
      f
    )
  const media = require('../lib/server/order-snapshot-media.ts')
  for (const b of scope.batches)
    assert(
      await media.cleanupOrderSnapshotMedia(b.id),
      'Scoped snapshot cleanup lease unavailable: stop; journal retained'
    )
  const current = validate(
    query('begin read only;' + sql + ';rollback;')[0].scope,
    targets
  )
  for (const key of ['listings', 'conversations', 'offers', 'orders'])
    assert.deepEqual(
      current[key],
      scope[key],
      'Concurrent transaction mutation: stop'
    )
  const finalFence = block(
    `begin if (select scope from (${sql}) x) is distinct from ${q(
      JSON.stringify(current)
    )}::jsonb then raise exception 'Reset scope changed';end if;end;`
  )
  const notifications = `destination->>'orderId' in(select id::text from public.orders where id in(${os})) or destination->>'offerId' in(select id::text from public.order_requests where id in(${rs}))`
  query(`begin;set local lock_timeout='10s';lock table public.listings,public.orders,public.order_requests,public.conversations,public.transaction_events,marketplace_private.order_media_batches,marketplace_private.order_snapshot_media in access exclusive mode;${finalFence}
 do $$begin if exists(select 1 from public.order_requests where id not in(${rs}) and (replacement_request_id in(${rs}))) or exists(select 1 from marketplace_private.offer_commands where offer_id not in(${rs}) and (previous_offer_id in(${rs}) or comparison_offer_id in(${rs}))) then raise exception 'External history reference: stop';end if;
 if exists(select 1 from marketplace_private.order_media_batches b where b.id in(${bs}) and (b.state<>'deleted' or b.order_id is not null)) then raise exception 'Media cleanup incomplete';end if;end$$;
 delete from public.notifications where ${notifications} or domain_event_id in(select id from marketplace_private.notification_events where ${notifications} or source_key in(select 'transaction:'||id from public.transaction_events where request_id in(${rs}) or order_id in(${os})));
 delete from marketplace_private.notification_events where ${notifications} or source_key in(select 'transaction:'||id from public.transaction_events where request_id in(${rs}) or order_id in(${os}));
 alter table public.order_meetup_revisions disable trigger order_meetup_guard;
 alter table marketplace_private.v2_order_economics disable trigger v2_order_economics_immutable;
 ${orderTables
   .map((t) => `delete from ${t} where order_id in(${os});`)
   .join('\n')}
 delete from marketplace_private.order_media_commands where batch_id in(${bs});delete from marketplace_private.order_media_assets where batch_id in(${bs});delete from marketplace_private.order_media_batches where id in(${bs});
 alter table public.transaction_events disable trigger transaction_events_immutable;
 alter table public.orders disable trigger orders_immutable;
 alter table public.order_requests disable trigger order_request_immutable;
 alter table public.listings disable trigger listings_publication_boundary;
 alter table public.listings disable trigger listings_inventory_guard;
 delete from marketplace_private.offer_accept_commands where offer_id in(${rs});delete from marketplace_private.order_commands where request_id in(${rs}) or order_id in(${os});delete from marketplace_private.offer_commands where offer_id in(${rs});
 delete from public.transaction_events where request_id in(${rs}) or order_id in(${os});
 update public.listings set status='available',reserved_order_id=null where id in(${affectedIds}) and not exists(select 1 from public.orders o where o.listing_id=public.listings.id and o.id not in(${os}) and o.holds_listing);
 delete from public.orders where id in(${os});delete from public.order_requests where id in(${rs});set constraints all immediate;
 alter table marketplace_private.v2_order_economics enable trigger v2_order_economics_immutable;
 alter table public.order_meetup_revisions enable trigger order_meetup_guard;
 alter table public.listings enable trigger listings_inventory_guard;alter table public.listings enable trigger listings_publication_boundary;
 alter table public.order_requests enable trigger order_request_immutable;alter table public.orders enable trigger orders_immutable;alter table public.transaction_events enable trigger transaction_events_immutable;commit;`)
  const final = validate(
    query('begin read only;' + sql + ';rollback;')[0].scope,
    targets
  )
  assert.equal(
    final.offers.length + final.orders.length + final.batches.length,
    0
  )
  assert(
    final.listings.every(
      (l) =>
        !affected.has(l.id) ||
        (l.status === 'available' && !l.reserved_order_id)
    )
  )
  for (const l of final.listings.filter((l) => !affected.has(l.id)))
    assert.deepEqual(
      l,
      scope.listings.find((before) => before.id === l.id),
      'Unrelated Listing changed'
    )
  const orphans = query(
    'begin read only;select ' +
      orderTables
        .map(
          (t, i) =>
            `(select count(*) from ${t} where order_id in(${os})) as remaining_${i}`
        )
        .join(',') +
      ';rollback;'
  )[0]
  assert(
    Object.values(orphans).every((n) => Number(n) === 0),
    'Scoped dependent rows remain'
  )
  assert.deepEqual(
    query('begin read only;' + retained + ';rollback;'),
    beforeRetained,
    'Retained manual/Nike/D1/messages/images/favorites changed'
  )
  assert.equal(
    hash(fs.readFileSync('.env.local')),
    originalEnv,
    '.env.local changed'
  )
  fs.unlinkSync(journal)
  console.log(
    'Scoped V2 reset verified; Listings, users, Messages and Favorites retained.'
  )
}
module.exports = { validate, inspectSQL, retainedSQL, main }
if (require.main === module)
  main().catch(() => {
    console.error(
      'Canonical demo reset refused/failed. No secret diagnostics printed. Inspect ignored reset journal if present.'
    )
    process.exitCode = 1
  })

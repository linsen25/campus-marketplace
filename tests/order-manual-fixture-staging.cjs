// Explicit project ref on every DB operation; never use the repository's production link alone.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/order-accept')
const mode = process.argv[2]
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(env.APP_ENV, 'staging')
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
assert.equal(
  spawnSync('git', [
    'check-ignore',
    'tests/artifacts/order-requests-phase1/probe',
  ]).status,
  0
)
fs.mkdirSync(root, { recursive: true })
function cli(args) {
  const r = spawnSync(
    'cmd.exe',
    ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
  )
  if (r.status) {
    fs.writeFileSync(
      path.join(root, 'cli-diagnostic.txt'),
      r.stderr || r.stdout
    )
    throw Error(
      'Staging CLI failed; details saved only to ignored diagnostic artifact'
    )
  }
  return JSON.parse(
    r.stdout.slice(r.stdout.indexOf(args[0] === 'projects' ? '[' : '{'))
  )
}
const project = cli(['projects', 'list', '--output', 'json']).find(
  (p) => p.ref === ref
)
assert.equal(project.name, 'western-marketplace-staging')
let serial = 0
function query(sql) {
  const f = path.join(root, `operation-${serial++}.sql`)
  fs.writeFileSync(f, sql)
  try {
    return cli([
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--file',
      f,
      '--output',
      'json',
    ]).rows
  } finally {
    fs.unlinkSync(f)
  }
}

const auditSql = String.raw`
begin read only;
select jsonb_build_object(
 'canonical', (select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',p.display_name,'authExists',u.id is not null,'verified',u.email_confirmed_at is not null,'marker',u.raw_app_meta_data->>'demo_system','roleMarker',u.raw_app_meta_data->>'demo_role')) from public.profiles p left join auth.users u on u.id=p.id where p.username in('Demo_seller_a','Demo_seller_b','Demo_buyer_a','Demo_buyer_b')),
 'demoAuthCounts',(select jsonb_build_object('canonical',count(*) filter(where p.username in('Demo_seller_a','Demo_seller_b','Demo_buyer_a','Demo_buyer_b')),'marked',count(*) filter(where u.raw_app_meta_data::text like '%campus-marketplace-staging-demo-v1%'),'total',count(*)) from auth.users u left join public.profiles p on p.id=u.id),
 'duplicateProfileNames',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select username,count(*) from profiles group by username having count(*)>1)x),
 'listings',(select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'seller',p.username,'description',l.description,'status',l.status,'reservedOrderId',l.reserved_order_id,'messages',(select count(*) from messages m join conversations c on c.id=m.conversation_id where c.listing_origin_id=l.id))) from listings l join profiles p on p.id=l.seller_id where p.username like 'Demo_%' or l.title like 'Accept race %' or l.title='Accept rollback fixture'),
 'conversations',(select jsonb_agg(jsonb_build_object('id',c.id,'listingOriginId',c.listing_origin_id,'listingId',c.listing_id,'title',c.listing_title_snapshot,'buyerId',c.buyer_id,'sellerId',c.seller_id,'buyer',b.username,'seller',s.username,'messages',(select count(*) from messages where conversation_id=c.id),'images',(select count(*) from messages where conversation_id=c.id and type='IMAGE'),'requests',(select count(*) from order_requests where conversation_id=c.id),'events',(select count(*) from transaction_events where conversation_id=c.id),'orders',(select count(*) from orders where conversation_id=c.id))) from conversations c left join profiles b on b.id=c.buyer_id left join profiles s on s.id=c.seller_id where b.username like 'Demo_%' or s.username like 'Demo_%'),
 'duplicateScopes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select listing_origin_id,buyer_id,seller_id,count(*) from conversations group by 1,2,3 having count(*)>1)x),
 'requests',(select jsonb_agg(jsonb_build_object('id',r.id,'conversationId',r.conversation_id,'status',r.status,'listing',r.listing_title_snapshot,'buyer',b.username,'seller',s.username,'createdAt',r.created_at)) from order_requests r left join profiles b on b.id=r.buyer_id left join profiles s on s.id=r.seller_id),
 'orders',(select jsonb_agg(jsonb_build_object('id',o.id,'requestId',o.request_id,'listingId',o.listing_id,'status',o.lifecycle_status,'holds',o.holds_listing,'expiresAt',o.reservation_expires_at)) from orders o),
 'events',(select jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'conversationId',e.conversation_id,'orderId',e.order_id,'type',e.event_type)) from transaction_events e),
 'identityConstraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.conversations'::regclass and conname='conversations_identity')
) as audit;
rollback;
`
if (mode === 'audit') {
  const result = query(auditSql)[0].audit
  fs.writeFileSync(
    path.join(root, 'manual-fixture-audit.json'),
    JSON.stringify(result, null, 2)
  )
  console.log(JSON.stringify(result, null, 2))
} else if (mode === 'refresh-navigation') {
  const signals = query("select marketplace_private.notify_order_history(c.id) from public.conversations c join auth.users b on b.id=c.buyer_id join auth.users s on s.id=c.seller_id where b.raw_app_meta_data->>'demo_system'='campus-marketplace-staging-demo-v1' and s.raw_app_meta_data->>'demo_system'='campus-marketplace-staging-demo-v1'")
  console.log('Canonical staging navigation invalidations: ' + signals.length + '; no transaction rows changed.')
} else if (mode === 'prepare') {
  const state = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/state.json', 'utf8')
  )
  assert.equal(state.ref, ref)
  assert.equal(state.marker, 'campus-marketplace-staging-demo-v1')
  const before = query(auditSql)[0].audit
  const seller = before.canonical.find((p) => p.username === 'Demo_seller_b')
  const buyer = before.canonical.find((p) => p.username === 'Demo_buyer_a')
  assert.equal(before.canonical.length, 4)
  for (const p of [buyer, seller])
    assert(p.authExists && p.verified && p.marker === state.marker)
  const cid = state.conversations['monitor-a'],
    lid = state.listings.monitor
  const c = before.conversations.find((c) => c.id === cid)
  assert(
    c &&
      c.listingId === lid &&
      c.buyerId === buyer.id &&
      c.sellerId === seller.id
  )
  assert.equal(before.listings.find((l) => l.id === lid).status, 'available')
  assert(!before.orders.some((o) => o.listingId === lid && o.status === 'open'))
  const existing = before.requests.filter(
    (r) => r.conversationId === cid && r.status === 'active'
  )
  assert(existing.length <= 1)
  const journal = path.join(root, 'manual-active-fixture.json')
  if (fs.existsSync(journal)) {
    const prior = JSON.parse(fs.readFileSync(journal, 'utf8'))
    assert.equal(prior.project, ref)
    assert(existing.some((request) => request.id === prior.id),
      'The manual Request has changed state. Do not automatically replace or recreate it.')
  }
  const marker =
    'Manual Accept test: leave Active for Buyer A; automation must not accept.'
  if (existing.length) {
    assert.equal(
      query(
        "select seller_note from public.order_requests where id='" +
          existing[0].id +
          "'"
      )[0].seller_note,
      marker
    )
  }
  const claims = JSON.stringify({ sub: seller.id, role: 'authenticated' })
  const sql = existing.length
    ? "select id,status,conversation_id,listing_id,scheduled_at,seller_note from public.order_requests where id='" +
      existing[0].id +
      "'"
    : "begin;set local role authenticated;select set_config('request.jwt.claims','" +
      claims +
      "',true);select id,status,conversation_id,listing_id,scheduled_at,seller_note from public.marketplace_create_order_request('" +
      cid +
      "',jsonb_build_object('item_amount_cents',12000,'fulfillment_type','pickup','place_name','UCC main entrance','scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days','seller_note','" +
      marker +
      "'),gen_random_uuid());commit;"
  const fixture = query(sql)[0]
  assert.equal(fixture.status, 'active')
  fs.writeFileSync(
    path.join(root, 'manual-active-fixture.json'),
    JSON.stringify(
      {
        project: ref,
        seller: 'Demo_seller_b',
        buyer: 'Demo_buyer_a',
        listing: '[DEMO] 24-inch Monitor',
        ...fixture,
      },
      null,
      2
    )
  )
  console.log(JSON.stringify(fixture))
} else throw Error('Use audit/prepare')

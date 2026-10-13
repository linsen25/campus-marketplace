// Canonical demo transaction reset only; never deletes users, listings or messages.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/staging-demo')
const mode = process.argv[2]
assert(['audit', 'reset'].includes(mode), 'Use audit or reset')
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
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
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json')))
assert.equal(state.ref, ref)
assert.equal(state.marker, 'campus-marketplace-staging-demo-v1')
assert(state.complete)
const quote = (s) => "'" + String(s).replaceAll("'", "''") + "'"
const ids = (values) => {
  assert(values.every((v) => /^[a-f0-9-]{36}$/.test(v)))
  return values.map(quote).join(',')
}
const users = ids(Object.values(state.users)),
  listings = ids(Object.values(state.listings)),
  conversations = ids(Object.values(state.conversations))
function query(sql) {
  const file = path.join(root, 'transaction-reset.sql')
  fs.writeFileSync(file, sql)
  try {
    const r = spawnSync(
      'cmd.exe',
      [
        '/d',
        '/c',
        'npx.cmd',
        '--no-install',
        'supabase',
        'db',
        'query',
        '--linked',
        '--project-ref',
        ref,
        '--file',
        file,
        '--output',
        'json',
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
    )
    if (r.status !== 0)
      throw Error(
        'Explicit staging query failed; no credentials or provider details printed'
      )
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).rows
  } finally {
    fs.unlinkSync(file)
  }
}
const graphSQL = `select (select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'parent',confrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname) from pg_constraint where contype='f' and (connamespace in('public'::regnamespace,'marketplace_private'::regnamespace) or confrelid in('public.orders'::regclass,'public.order_requests'::regclass,'public.transaction_events'::regclass,'marketplace_private.order_commands'::regclass,'marketplace_private.financial_capabilities'::regclass))) fks,
 (select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal and tgrelid in('public.listings'::regclass,'public.orders'::regclass,'public.order_requests'::regclass,'public.transaction_events'::regclass,'marketplace_private.order_commands'::regclass,'marketplace_private.financial_capabilities'::regclass)) triggers,
 (select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name) order by table_schema,table_name,ordinal_position) from information_schema.columns where table_schema in('public','marketplace_private')) columns`
const scopeSQL = `select
 (select jsonb_agg(jsonb_build_object('id',u.id,'marker',u.raw_app_meta_data->>'demo_system','role',u.raw_app_meta_data->>'demo_role','username',p.username) order by u.id) from auth.users u join public.profiles p on p.id=u.id where u.id in(${users})) identities,
 (select jsonb_agg(to_jsonb(l) order by id) from public.listings l where id in(${listings})) listings,
 (select jsonb_agg(to_jsonb(c) order by id) from public.conversations c where id in(${conversations})) conversations,
 (select jsonb_agg(to_jsonb(r) order by id) from public.order_requests r where listing_id in(${listings}) or buyer_id in(${users}) or seller_id in(${users})) requests,
 (select jsonb_agg(to_jsonb(o) order by id) from public.orders o where listing_id in(${listings}) or buyer_id in(${users}) or seller_id in(${users})) orders,
 (select jsonb_agg(to_jsonb(e) order by id) from public.transaction_events e where conversation_id in(${conversations}) or request_id in(select id from public.order_requests where listing_id in(${listings}))) events,
 (select jsonb_agg(to_jsonb(c) order by request_id,action) from marketplace_private.order_commands c where actor_key in(${users}) or request_id in(select id from public.order_requests where listing_id in(${listings}))) commands,
 (select jsonb_agg(to_jsonb(f) order by user_id,capability) from marketplace_private.financial_capabilities f where user_id in(${users})) capabilities`
// Full-row hashes detect any changes to retained or unrelated data without saving secrets.
function fingerprintSQL() {
  const tables = query(
    `select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in('public','marketplace_private') order by table_schema,table_name`
  )
  return tables
    .map((t) => {
      const table = `${t.table_schema}.${t.table_name}`
      let where = ''
      if (table === 'public.listings') where = `where id not in(${listings})`
      if (table === 'public.order_requests' || table === 'public.orders')
        where = `where listing_id not in(${listings}) and (buyer_id is null or buyer_id not in(${users})) and (seller_id is null or seller_id not in(${users}))`
      if (table === 'public.transaction_events')
        where = `where conversation_id not in(${conversations})`
      if (table === 'marketplace_private.order_commands')
        where = `where actor_key not in(${users})`
      if (table === 'marketplace_private.financial_capabilities')
        where = `where user_id not in(${users})`
      return `select ${quote(
        table
      )} as name,count(*) as count,md5(coalesce(string_agg(row::text,'' order by row::text),'')) as hash from (select to_jsonb(t) row from ${table} t ${where}) x`
    })
    .join(' union all ')
}
const graph = query('begin read only;' + graphSQL + ';rollback;')[0]
const before = query('begin read only;' + scopeSQL + ';rollback;')[0]
fs.writeFileSync(
  path.join(root, 'transaction-reset-audit.json'),
  JSON.stringify({ ref, graph, before }, null, 2)
)
const count = (x) =>
  Object.fromEntries(
    ['requests', 'orders', 'events', 'commands', 'capabilities'].map((k) => [
      k,
      (x[k] || []).length,
    ])
  )
console.log(
  JSON.stringify({
    ref,
    before: count(before),
    audit: path.relative(
      process.cwd(),
      path.join(root, 'transaction-reset-audit.json')
    ),
  })
)
console.log(
  JSON.stringify({
    messageCounts: query(
      `select type,count(*) count from public.messages where conversation_id in(${conversations}) group by type order by type`
    ),
  })
)
if (mode === 'reset') {
  // Pin the deployed FK/column/trigger graph inspected before this reset. New dependencies STOP.
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
    'a8b9fe9c876c30826da7bb7dfca6649c652b2ad8d6d6ac7420713a785b93922a',
    'Deployed graph changed: audit before deletion'
  )
  assert.equal(before.identities.length, 4)
  for (const [role, id] of Object.entries(state.users)) {
    const u = before.identities.find((x) => x.id === id)
    assert(
      u &&
        u.marker === state.marker &&
        u.role === role &&
        u.username === 'Demo_' + role.replace('-', '_')
    )
  }
  assert.equal(before.listings.length, 6)
  for (const [key, id] of Object.entries(state.listings)) {
    const l = before.listings.find((x) => x.id === id)
    assert(
      l &&
        l.description.startsWith(`[${state.marker}:${key}]`) &&
        [state.users['seller-a'], state.users['seller-b']].includes(l.seller_id)
    )
  }
  assert.equal(before.conversations.length, 4)
  const requestIds = new Set((before.requests || []).map((r) => r.id))
  const orderIds = new Set((before.orders || []).map((o) => o.id))
  for (const r of [...(before.requests || []), ...(before.orders || [])]) {
    assert(
      Object.values(state.listings).includes(r.listing_id) &&
        Object.values(state.conversations).includes(r.conversation_id)
    )
    assert(
      Object.values(state.users).includes(r.buyer_id) &&
        Object.values(state.users).includes(r.seller_id)
    )
    if (r.replacement_request_id)
      assert(requestIds.has(r.replacement_request_id))
    if (r.request_id) assert(requestIds.has(r.request_id))
  }
  for (const r of [...(before.events || []), ...(before.commands || [])]) {
    assert(
      requestIds.has(r.request_id),
      'Unrelated transaction reference: STOP'
    )
    if (r.order_id) assert(orderIds.has(r.order_id))
  }
  for (const l of before.listings)
    if (l.reserved_order_id) assert(orderIds.has(l.reserved_order_id))
  const retained = fingerprintSQL()
  const outcome = query(`begin;
    set local lock_timeout='10s';
    lock table public.listings,public.orders,public.order_requests,public.transaction_events,marketplace_private.order_commands,marketplace_private.financial_capabilities,public.conversations in access exclusive mode;
    do $$ begin
      if (select to_jsonb(s) from (${scopeSQL}) s) is distinct from ${quote(
    JSON.stringify(before)
  )}::jsonb then raise exception 'Scope changed: STOP'; end if;
      if exists(select 1 from public.order_requests where listing_id not in(${listings}) and replacement_request_id in(select id from public.order_requests where listing_id in(${listings})))
        or exists(select 1 from public.listings where id not in(${listings}) and reserved_order_id in(select id from public.orders where listing_id in(${listings}))) then raise exception 'External dependency: STOP'; end if;
    end $$;
    create temporary table retained_before on commit drop as ${retained};
    create temporary table listing_content_before on commit drop as select id,to_jsonb(l)-array['status','reserved_order_id','updated_at'] content from public.listings l where id in(${listings});
    alter table public.transaction_events disable trigger transaction_events_immutable;
    alter table public.orders disable trigger orders_immutable;
    alter table public.order_requests disable trigger order_request_immutable;
    alter table public.listings disable trigger listings_inventory_guard;
    alter table public.listings disable trigger listings_publication_boundary;
    delete from public.transaction_events where request_id in(select id from public.order_requests where listing_id in(${listings}));
    delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${listings}));
    update public.listings set status='available',reserved_order_id=null where id in(${listings}) and (status<>'available' or reserved_order_id is not null);
    delete from public.orders where listing_id in(${listings});
    delete from public.order_requests where listing_id in(${listings});
    delete from marketplace_private.financial_capabilities where user_id in(${users});
    set constraints all immediate;
    alter table public.transaction_events enable trigger transaction_events_immutable;
    alter table public.orders enable trigger orders_immutable;
    alter table public.order_requests enable trigger order_request_immutable;
    alter table public.listings enable trigger listings_inventory_guard;
    alter table public.listings enable trigger listings_publication_boundary;
    create temporary table retained_after on commit drop as ${retained};
    do $$ begin
      if exists((select * from retained_before except select * from retained_after) union all (select * from retained_after except select * from retained_before)) then raise exception 'Retained data changed: rollback'; end if;
      if exists(select 1 from listing_content_before b join public.listings l using(id) where b.content is distinct from to_jsonb(l)-array['status','reserved_order_id','updated_at']) then raise exception 'Listing content changed: rollback'; end if;
      if exists(select 1 from public.listings where id in(${listings}) and (status<>'available' or reserved_order_id is not null)) then raise exception 'Inventory baseline failed'; end if;
    end $$;
    ${scopeSQL}; commit;`)[0]
  for (const value of Object.values(count(outcome))) assert.equal(value, 0)
  assert.deepEqual(
    query('begin read only;' + graphSQL + ';rollback;')[0],
    graph,
    'Trigger/schema restoration verification'
  )
  fs.writeFileSync(
    path.join(root, 'transaction-reset-result.json'),
    JSON.stringify(
      {
        ref,
        resetAt: new Date().toISOString(),
        before,
        after: outcome,
        preserved: query(retained),
        graphRestored: true,
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      ref,
      after: count(outcome),
      listingsAvailable: 6,
      retainedDataUnchanged: true,
      graphRestored: true,
    })
  )
}

// B29-B isolated PostgreSQL qualification. Loopback only; no Supabase network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')

const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const binary = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function execute(name, args, input, expected = 0) {
  const result = spawnSync(binary(name), args, {
    input,
    env: environment,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000,
  })
  assert.equal(result.status, expected, result.stderr || result.error?.message)
  return (result.stdout || '').trim()
}
function planSummary(plan) {
  const totals = { rows: 0, removed: 0, hits: 0, reads: 0 }
  const nodes = new Set()
  const indexes = new Set()
  const visit = (node) => {
    nodes.add(node['Node Type'])
    if (node['Index Name']) indexes.add(node['Index Name'])
    totals.rows +=
      Number(node['Actual Rows'] || 0) * Number(node['Actual Loops'] || 1)
    totals.removed +=
      Number(node['Rows Removed by Filter'] || 0) *
      Number(node['Actual Loops'] || 1)
    totals.hits += Number(node['Shared Hit Blocks'] || 0)
    totals.reads += Number(node['Shared Read Blocks'] || 0)
    ;(node.Plans || []).forEach(visit)
  }
  visit(plan.Plan)
  return {
    ms: Number(plan['Execution Time'].toFixed(3)),
    rowsVisited: totals.rows + totals.removed,
    sharedHits: totals.hits,
    sharedReads: totals.reads,
    nodes: [...nodes],
    indexes: [...indexes],
  }
}
function loadCategory() {
  const source = fs.readFileSync('lib/notification-category.ts', 'utf8')
  const module = { exports: {} }
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    require,
    module,
    module.exports
  )
  return module.exports.notificationCategory
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b29-notify-'))
  const data = path.join(folder, 'data')
  let started = false
  const args = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'b29_notify',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    execute('initdb', [
      '-D',
      data,
      '-U',
      'b29_notify',
      '--auth=trust',
      '--no-locale',
      '--encoding=UTF8',
    ])
    execute('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(folder, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ])
    started = true
    const sql = (input) => execute('psql', args, input)
    const fail = (input) => execute('psql', args, input, 3)
    sql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema marketplace_private;
      create function auth.uid() returns uuid language sql stable set search_path='' as $$
       select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function marketplace_private.is_western_user() returns boolean
       language sql stable set search_path='' as $$select auth.uid() is not null$$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create table public.notifications(
       id uuid primary key,recipient_user_id uuid not null,domain_event_id uuid not null,
       event_type text not null,priority text not null,created_at timestamptz not null,
       updated_at timestamptz not null,read_at timestamptz,destination jsonb not null,
       coalescing_key text,original_price_cents bigint,latest_price_cents bigint);
      create index notifications_recipient_newest
       on public.notifications(recipient_user_id,created_at desc,id desc);
      alter table public.notifications enable row level security;
      grant select on public.notifications to authenticated;
      create policy notifications_own_read on public.notifications for select to authenticated
       using(recipient_user_id=auth.uid() and created_at>=statement_timestamp()-interval '90 days');
      create function public.marketplace_notifications(p_before timestamptz default null,p_before_id uuid default null)
      returns jsonb language plpgsql security definer set search_path='' as $$
      declare actor uuid:=auth.uid();items jsonb;cutoff timestamptz:=statement_timestamp()-interval '90 days';
      begin
       if actor is null then raise exception 'Verified account required.' using errcode='42501';end if;
       select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc),'[]'::jsonb) into items from(
        select id,event_type,priority,created_at,updated_at,read_at,destination,original_price_cents,latest_price_cents
        from public.notifications where recipient_user_id=actor and created_at>=cutoff
         and(p_before is null or(created_at,id)<(p_before,p_before_id))
        order by created_at desc,id desc limit 50)v;
       return jsonb_build_object('notifications',items,'unreadCount',(
        select count(*) from public.notifications where recipient_user_id=actor and read_at is null and created_at>=cutoff));
      end;$$;
      revoke all on function public.marketplace_notifications(timestamptz,uuid) from public,anon,authenticated;
      grant execute on function public.marketplace_notifications(timestamptz,uuid) to authenticated;
      insert into public.notifications
      select md5(('n'||g)::text)::uuid,'11111111-1111-4111-8111-111111111111',md5(('e'||g)::text)::uuid,
       case when g%1000=0 then 'connected_bank_payout_failed'
        when g%19=0 then 'new_message' when g%17=0 then 'price_drop' else 'order_completed' end,
       'INFORMATIONAL',statement_timestamp()-(g||' seconds')::interval,
       statement_timestamp()-(g||' seconds')::interval,
       case when g%10=1 then statement_timestamp() else null end,
       case when g%19=0 then '{"section":"messages"}'::jsonb
        when g%17=0 then '{"section":"listing"}'::jsonb else '{"section":"orders"}'::jsonb end,
       null,null,null from generate_series(1,180000) g;
      insert into public.notifications
      select md5(('x'||g)::text)::uuid,'22222222-2222-4222-8222-222222222222',md5(('z'||g)::text)::uuid,
       'new_message','INFORMATIONAL',statement_timestamp()-(g||' seconds')::interval,
       statement_timestamp(),null,'{"section":"messages"}',null,null,null
      from generate_series(1,20000) g;
      analyze public.notifications;
    `)
    const explain = (query) =>
      planSummary(
        JSON.parse(sql(`explain(analyze,buffers,format json) ${query}`))[0]
      )
    const predicate = `recipient_user_id='11111111-1111-4111-8111-111111111111'
      and created_at>=statement_timestamp()-interval '90 days'`
    const baseline = {
      all: explain(
        `select id from public.notifications where ${predicate} order by created_at desc,id desc limit 51`
      ),
      systemUnread: explain(
        `select id from public.notifications where ${predicate}
         and event_type='connected_bank_payout_failed' and read_at is null
         order by created_at desc,id desc limit 51`
      ),
      read: explain(
        `select id from public.notifications where ${predicate} and read_at is not null
         order by created_at desc,id desc limit 51`
      ),
    }
    const estimatedLegacyCalls = Number(
      sql(`select ceil((select max(g)::numeric from(
       select g from generate_series(1,180000) g where g%1000=0 order by g limit 51)x)/50)`)
    )
    console.log(
      'B29_NOTIFICATION_BASELINE ' +
        JSON.stringify({ rows: 200000, estimatedLegacyCalls, baseline })
    )

    sql(
      fs.readFileSync(
        'supabase/migrations/20261024052628_notification_filtered_pagination.sql',
        'utf8'
      )
    )
    sql('analyze public.notifications;')
    const category = `marketplace_private.notification_category(event_type,destination)`
    const optimized = {
      all: explain(
        `select id from public.notifications where ${predicate} order by created_at desc,id desc limit 51`
      ),
      systemUnread: explain(
        `select id from public.notifications where ${predicate}
         and ${category}='system' and read_at is null order by created_at desc,id desc limit 51`
      ),
      read: explain(
        `select id from public.notifications where ${predicate} and read_at is not null
         order by created_at desc,id desc limit 51`
      ),
    }
    console.log(
      'B29_NOTIFICATION_OPTIMIZED ' +
        JSON.stringify({ rows: 200000, optimized })
    )
    assert(
      optimized.systemUnread.indexes.includes(
        'notifications_recipient_category_read_newest'
      )
    )
    assert(
      optimized.read.indexes.includes('notifications_recipient_newest'),
      'The existing newest index remains efficient for status-only reads.'
    )

    const actor = (user, query) =>
      sql(
        `set role authenticated;set request.jwt.claim.sub='${user}';${query};reset role;`
      )
        .split(/\r?\n/)
        .find((line) => line.startsWith('{'))
    const page = (user, before, beforeId, categoryName, status) =>
      JSON.parse(
        actor(
          user,
          `select public.marketplace_notifications_filtered(${
            before || 'null'
          },${beforeId ? `'${beforeId}'` : 'null'},${
            categoryName ? `'${categoryName}'` : 'null'
          },${status ? `'${status}'` : 'null'})`
        )
      )
    const first = page(
      '11111111-1111-4111-8111-111111111111',
      null,
      null,
      'system',
      'unread'
    )
    assert.equal(first.notifications.length, 50)
    assert.equal(first.hasMore, true)
    assert.equal(first.unreadCount, 162000)
    assert(first.nextCursor)
    const second = page(
      '11111111-1111-4111-8111-111111111111',
      `'${first.nextCursor.before}'::timestamptz`,
      first.nextCursor.beforeId,
      'system',
      'unread'
    )
    assert(
      !second.notifications.some((item) =>
        first.notifications.some((seen) => seen.id === item.id)
      )
    )
    assert.equal(
      page(
        '22222222-2222-4222-8222-222222222222',
        null,
        null,
        'system',
        'unread'
      ).notifications.length,
      0
    )

    const notificationCategory = loadCategory()
    const categoryFixtures = [
      ['new_message', { section: 'messages' }],
      ['incoming_offer', { section: 'messages' }],
      ['agreement_complete', { section: 'orders' }],
      ['payment_paid', { section: 'orders' }],
      ['order_refund_succeeded', { section: 'orders' }],
      ['order_refund_failed', { section: 'orders' }],
      ['order_refund_unresolved', { section: 'orders' }],
      ['seller_transfer_succeeded', { section: 'orders' }],
      ['seller_transfer_failed', { section: 'orders' }],
      ['seller_transfer_unresolved', { section: 'orders' }],
      ['seller_transfer_reversed', { section: 'orders' }],
      ['seller_transfer_partially_reversed', { section: 'orders' }],
      ['connected_bank_payout_paid', { section: 'settings' }],
      ['connected_bank_payout_failed', { section: 'settings' }],
      ['connected_bank_payout_canceled', { section: 'settings' }],
      ['shop_trial_activated', { section: 'shop' }],
      ['shop_membership_access_started', { section: 'shop' }],
      ['shop_membership_access_upgraded', { section: 'shop' }],
      ['shop_suspended', { section: 'shop' }],
      ['shop_reopened', { section: 'shop' }],
      ['price_drop', { section: 'listing' }],
      ['future_message', { section: 'messages' }],
      ['future_order', { section: 'orders' }],
      ['unknown_future_event', {}],
    ]
    for (const [eventType, destination] of categoryFixtures) {
      const escaped = JSON.stringify(destination).replaceAll("'", "''")
      const database = sql(
        `select marketplace_private.notification_category('${eventType}','${escaped}'::jsonb)`
      )
      assert.equal(
        database,
        notificationCategory({ event_type: eventType, destination })
      )
    }

    sql(`
      insert into public.notifications
      select md5(('f'||g)::text)::uuid,'33333333-3333-4333-8333-333333333333',md5(('q'||g)::text)::uuid,
       'new_message','INFORMATIONAL','2026-10-24 12:00:00+00','2026-10-24 12:00:00+00',null,
       '{"section":"messages"}',null,null,null from generate_series(1,50) g;
    `)
    const exact = page(
      '33333333-3333-4333-8333-333333333333',
      null,
      null,
      'message',
      'unread'
    )
    assert.equal(exact.notifications.length, 50)
    assert.equal(exact.hasMore, false)
    assert.equal(exact.nextCursor, null)
    sql(`insert into public.notifications values(
     'ffffffff-ffff-4fff-8fff-ffffffffffff','33333333-3333-4333-8333-333333333333',
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','new_message','INFORMATIONAL',
     '2026-10-24 12:00:01+00','2026-10-24 12:00:01+00',null,
     '{"section":"messages"}',null,null,null)`)
    const fiftyOne = page(
      '33333333-3333-4333-8333-333333333333',
      null,
      null,
      'message',
      'unread'
    )
    assert.equal(fiftyOne.notifications.length, 50)
    assert.equal(fiftyOne.hasMore, true)
    const beforeMutation = page(
      '33333333-3333-4333-8333-333333333333',
      `'${fiftyOne.nextCursor.before}'::timestamptz`,
      fiftyOne.nextCursor.beforeId,
      'message',
      'unread'
    )
    assert.equal(beforeMutation.notifications.length, 1)
    sql(
      `delete from public.notifications where id='${beforeMutation.notifications[0].id}'`
    )
    sql(`insert into public.notifications values(
     'ffffffff-ffff-4fff-8fff-fffffffffffe','33333333-3333-4333-8333-333333333333',
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef','new_message','INFORMATIONAL',
     '2026-10-24 12:00:02+00','2026-10-24 12:00:02+00',null,
     '{"section":"messages"}',null,null,null)`)
    sql(`insert into public.notifications values(
     'ffffffff-ffff-4fff-8fff-fffffffffffd','33333333-3333-4333-8333-333333333333',
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed','new_message','INFORMATIONAL',
     '2026-10-23 12:00:00+00','2026-10-23 12:00:00+00',null,
     '{"section":"messages"}',null,null,null)`)
    const continuation = page(
      '33333333-3333-4333-8333-333333333333',
      `'${fiftyOne.nextCursor.before}'::timestamptz`,
      fiftyOne.nextCursor.beforeId,
      'message',
      'unread'
    )
    assert(
      !continuation.notifications.some((item) =>
        fiftyOne.notifications.some((seen) => seen.id === item.id)
      )
    )
    assert(
      !continuation.notifications.some(
        (item) => item.id === 'ffffffff-ffff-4fff-8fff-fffffffffffe'
      ),
      'A newer concurrent insert stays before the frozen keyset cursor.'
    )
    assert.deepEqual(
      continuation.notifications.map((item) => item.id),
      ['ffffffff-ffff-4fff-8fff-fffffffffffd'],
      'Deletion removes the old row while an older insert remains eligible after the cursor.'
    )
    sql(
      "update public.notifications set read_at=statement_timestamp() where id='ffffffff-ffff-4fff-8fff-fffffffffffd'"
    )
    assert.equal(
      page(
        '33333333-3333-4333-8333-333333333333',
        `'${fiftyOne.nextCursor.before}'::timestamptz`,
        fiftyOne.nextCursor.beforeId,
        'message',
        'unread'
      ).notifications.length,
      0,
      'A read transition removes the row from a later unread page.'
    )

    assert.equal(
      sql(
        "select has_function_privilege('authenticated','public.marketplace_notifications_filtered(timestamptz,uuid,text,text)','execute')"
      ),
      't'
    )
    assert.equal(
      sql(
        "select has_function_privilege('anon','public.marketplace_notifications_filtered(timestamptz,uuid,text,text)','execute')"
      ),
      'f'
    )
    const crossUser = sql(
      "set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';" +
        "select count(*) from public.notifications where recipient_user_id='22222222-2222-4222-8222-222222222222';reset role;"
    )
      .split(/\r?\n/)
      .find((line) => /^\d+$/.test(line))
    assert.equal(crossUser, '0')
    fail(
      "set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';select public.marketplace_notifications_filtered(null,null,'invalid',null)"
    )
    fail(
      "set role authenticated;set request.jwt.claim.sub='';select public.marketplace_notifications_filtered(null,null,null,null)"
    )
    console.log(
      'PASS B29-B database: one bounded filtered page, exact 50/51 hasMore, stable cursor ties, concurrent insert/delete/read semantics, global unread, category parity, recipient RLS and ACL.'
    )
  } finally {
    if (started) execute('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

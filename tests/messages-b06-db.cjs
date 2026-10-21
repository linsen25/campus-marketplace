// Isolated native PostgreSQL, loopback only, no env files/Supabase CLI.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))
)
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function run(name, args, input) {
  const r = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(r.status, 0, `${name}: ${r.stderr || r.error?.message}`)
  return r.stdout
}
async function main() {
  const port = await new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
  const folder = fs.mkdtempSync(
    path.resolve('tests/artifacts/messages-b06-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'messages_test',
      '--auth=trust',
      '--no-locale',
      '--encoding=UTF8',
    ])
    run('pg_ctl', [
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
    const sql = (text) =>
      run(
        'psql',
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          '127.0.0.1',
          '-p',
          String(port),
          '-U',
          'messages_test',
          '-d',
          'postgres',
          '-At',
        ],
        text
      )
    const fixture = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    sql(
      fixture +
        '\ncreate role service_role bypassrls;alter table auth.users add column confirmation_token text;create table auth.one_time_tokens(user_id uuid,token_type text,token_hash text);'
    )
    sql(`create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
    create schema realtime;
    create table realtime.messages(id uuid default gen_random_uuid(),payload jsonb,event text,topic text,extension text default 'broadcast',private boolean);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon,authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql security definer as $$insert into realtime.messages(payload,event,topic,private) values($1,$2,$3,$4)$$;`)
    for (const file of [
      '202609290001_marketplace.sql',
      '202610040001_marketplace_taxonomy.sql',
      '202610050001_marketplace_publication_favorites.sql',
      '202610070001_messages_text.sql',
      '202610070002_messages_images.sql',
      '202610080001_messages_realtime.sql',
      '202610130012_message_withdrawal.sql',
      '202610150009_contact_seller_first_contact.sql',
      '202610160006_shop_profile_foundation.sql',
      '202610160007_listing_channel_authority.sql',
      '202610160009_message_shop_provenance.sql',
    ])
      sql(fs.readFileSync('supabase/migrations/' + file, 'utf8'))
    // Install only the current TEXT RPC body from the later Offer migration.
    // No Offer functions/tables or transaction implementation are introduced.
    const guards = fs.readFileSync(
      'supabase/migrations/202610130013_offer_revision_guards.sql',
      'utf8'
    )
    const start = guards.indexOf(
      'create or replace function public.marketplace_send_text('
    )
    sql(guards.slice(start, guards.indexOf('$$;', start) + 3))
    sql(fs.readFileSync('tests/messages-b06-seed.sql', 'utf8'))
    const cid = sql(
      "select id from public.conversations where listing_origin_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';"
    ).trim()
    assert(/^[0-9a-f-]{36}$/.test(cid))
    sql(
      fs
        .readFileSync('tests/messages-b06-db.sql', 'utf8')
        .replaceAll('__CID__', cid)
    )
    const args = [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'messages_test',
      '-d',
      'postgres',
      '-At',
    ]
    const auth =
      "set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';"
    const race = async (statement) => {
      const connection = () =>
        spawn(bin('psql'), args, {
          env,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      const first = connection()
      let output = '',
        errors = ''
      const firstDone = new Promise((resolve) => first.on('exit', resolve))
      const locked = new Promise((resolve, reject) => {
        first.on('error', reject)
        first.stdout.on('data', (d) => {
          output += d
          if (output.includes('B06_LOCKED')) resolve()
        })
        first.on('exit', () => {
          if (!output.includes('B06_LOCKED'))
            reject(Error('race fixture failed'))
        })
      })
      first.stderr.on('data', (d) => (errors += d))
      first.stdin.write('begin;' + auth + statement + '\n\\echo B06_LOCKED\n')
      await locked
      const second = connection(),
        secondDone = new Promise((resolve) => second.on('exit', resolve))
      second.stderr.on('data', (d) => (errors += d))
      second.stdout.resume()
      second.stdin.end(auth + statement)
      first.stdin.end('select pg_sleep(0.2);commit;\n\\q\n')
      assert.equal(await firstDone, 0, errors)
      assert.equal(await secondDone, 0, errors)
    }
    await race(
      "select (public.marketplace_contact_seller('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')).id;"
    )
    sql(
      "select public.b06_assert((select count(*)=1 from public.conversations where listing_origin_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'first contact one conversation');select public.b06_assert((select count(*)=2 from public.messages m join public.conversations c on c.id=m.conversation_id where c.listing_origin_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'first contact one intro/ack pair');"
    )
    const secondId = sql(
      "select id from public.conversations where listing_origin_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';"
    ).trim()
    await race(
      `select (public.marketplace_send_text('${secondId}','dddddddd-dddd-4ddd-8ddd-ddddddddddd9','same UUID after lost response')).id;`
    )
    sql(
      `select public.b06_assert((select count(*)=3 and max(sequence)=3 from public.messages where conversation_id='${secondId}'),'concurrent retry consumes one sequence');`
    )
    console.log(
      'PASS native PostgreSQL B06: actual current RPCs/RLS, first contact and same-UUID two-connection races, sequence/unread/late reads, authorization, persistent text/image manifest, verify/finalize retry, abandon queue, private topic policy; no remote'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

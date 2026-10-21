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
  const folder = fs.mkdtempSync(path.resolve('tests/artifacts/offers-b07-db-'))
  const data = path.join(folder, 'data')
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'offers_test',
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
          'offers_test',
          '-d',
          'postgres',
          '-At',
        ],
        text
      )
    const bootstrap = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    sql(
      bootstrap +
        '\ncreate role service_role bypassrls;alter table auth.users add column confirmation_token text;create table auth.one_time_tokens(user_id uuid,token_type text,token_hash text);'
    )
    sql(`create schema extensions;create extension pgcrypto with schema extensions;
    create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
    create schema realtime;
    create table realtime.messages(id uuid default gen_random_uuid(),payload jsonb,event text,topic text,extension text default 'broadcast',private boolean);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon,authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql security definer as $$insert into realtime.messages(payload,event,topic,private) values($1,$2,$3,$4)$$;`)

    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (
        [
          '202610130007_staging_due_work_schedule.sql',
          '202610150006_notification_scheduler_transport_privacy.sql',
        ].includes(file)
      )
        continue
      let body = fs.readFileSync('supabase/migrations/' + file, 'utf8')
      if (file === '202610150004_notification_delivery_foundation.sql')
        body =
          body.slice(0, body.indexOf('-- An opaque scheduler token')) +
          '\ncommit;'
      try {
        sql(body)
      } catch (e) {
        throw Error('Local migration prerequisite ' + file + ': ' + e.message)
      }
    }
    console.log(
      'PASS isolated current-schema prerequisites; scheduler/network integrations excluded'
    )
    sql(fs.readFileSync('tests/offers-b07-db.sql', 'utf8'))
    console.log('PASS B07 native sequential assertions')
    const seller = '11111111-1111-4111-8111-111111111111',
      buyer = '22222222-2222-4222-8222-222222222222'
    const as = (id) =>
      `set role authenticated;select public.b07_actor('${id}');`
    const scope = (label) =>
      JSON.parse(
        sql(
          `select row_to_json(s) from public.b07_scope s where label='${label}';`
        ).trim()
      )
    const fixture = (label, prepare = false) => {
      sql(`do $$declare cid uuid;r public.order_requests;media_batch_value uuid;cmd uuid:=gen_random_uuid();begin
        cid:=public.b07_fixture('${label}');
        ${
          prepare
            ? `select * into r from public.marketplace_submit_offer(cid,public.b07_terms(),gen_random_uuid());
          media_batch_value:=public.b07_prepare(r.id,'${seller}',cmd);`
            : ''
        }
        update public.b07_scope set offer=r.id,batch=media_batch_value,command=cmd where label='${label}';end;$$;`)
      return scope(label)
    }
    const args = [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'offers_test',
      '-d',
      'postgres',
      '-At',
    ]
    const race = async (one, two, error) => {
      const children = []
      const connection = (name) => {
        const p = spawn(bin('psql'), args, {
          env: { ...env, PGAPPNAME: name },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        children.push(p)
        const result = { p, out: '', err: '' }
        p.stdout.on('data', (d) => (result.out += d))
        p.stderr.on('data', (d) => (result.err += d))
        result.done = new Promise((resolve, reject) => {
          p.on('error', reject)
          p.on('exit', (code) => resolve(code))
        })
        return result
      }
      let timer
      try {
        const a = connection('b07_race_first')
        const locked = new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('B07 race lock deadline')),
            10000
          )
          a.p.stdout.on('data', () => {
            if (a.out.includes('B07_LOCKED')) resolve()
          })
          a.p.on('exit', () => {
            if (!a.out.includes('B07_LOCKED')) reject(Error(a.err))
          })
        })
        a.p.stdin.write('begin;' + one + '\n\\echo B07_LOCKED\n')
        await locked
        clearTimeout(timer)
        const b = connection('b07_race_second')
        b.p.stdin.end(two + '\n')
        // Prove overlap on the database server; process startup timing alone is
        // insufficient evidence that the competing statement actually waited.
        let blocked = false
        for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
          blocked =
            sql(
              "select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name='b07_race_second';"
            ).trim() === 't'
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert(
          blocked,
          'second native connection must be waiting on the held domain/command lock'
        )
        a.p.stdin.end('select pg_sleep(0.2);commit;\n\\q\n')
        assert.equal(await a.done, 0, a.err)
        const code = await b.done
        if (error) {
          assert.notEqual(code, 0)
          assert(b.err.includes(error), b.err)
        } else assert.equal(code, 0, b.err)
      } finally {
        clearTimeout(timer)
        for (const c of children) if (c.exitCode === null) c.kill()
      }
    }
    let f = fixture('same-uuid')
    const create =
      as(buyer) +
      `select (public.marketplace_submit_offer('${f.conversation}',public.b07_terms(),'${f.command}')).id;`
    await race(create, create)
    sql(
      `select public.b07_assert((select count(*)=1 from public.order_requests where conversation_id='${f.conversation}'),'two-connection UUID create one');`
    )
    f = fixture('same-sender-race')
    await race(
      as(buyer) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(8000),gen_random_uuid());`,
      as(buyer) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(8500),gen_random_uuid());`
    )
    sql(
      `select public.b07_assert((select count(*)=2 and count(*) filter(where status='active')=1 and count(*) filter(where status='superseded')=1 from public.order_requests where conversation_id='${f.conversation}'),'same sender serialized history');`
    )
    f = fixture('accept-replay', true)
    const accept =
      as(seller) +
      `select (public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}')).id;`
    await race(accept, accept)
    sql(
      `select public.b07_assert((select count(*)=1 from public.orders where request_id='${f.offer}'),'same UUID acceptance one Order');`
    )
    f = fixture('competing-buyers', true)
    sql(`do $$declare c uuid;r public.order_requests;b uuid;cmd uuid:=gen_random_uuid();begin
      perform public.b07_actor('33333333-3333-4333-8333-333333333333');c:=(public.marketplace_find_or_create_conversation('${f.listing}')).id;
      r:=public.marketplace_submit_offer(c,public.b07_terms(7500),gen_random_uuid());b:=public.b07_prepare(r.id,'${seller}',cmd);
      insert into public.b07_scope(label,listing,conversation,offer,batch,command,actor) values('competing-buyer-two','${f.listing}',c,r.id,b,cmd,'${seller}');end;$$;`)
    const loser = scope('competing-buyer-two')
    await race(
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      as(seller) +
        `select public.marketplace_accept_offer('${loser.offer}','${loser.command}','${loser.batch}');`,
      '23505'
    )
    sql(`select public.b07_assert((select count(*)=1 and bool_and(holds_listing) from public.orders where listing_id='${f.listing}'),'one inventory winner');
      select public.b07_assert((select status='closed' from public.order_requests where id='${loser.offer}'),'losing Offer Closed');
      select public.b07_assert((select status='available' and reserved_order_id is null from public.listings where id=(select listing from public.b07_scope where label='price-drop')),'unrelated inventory unaffected');`)
    f = fixture('revise-before-accept', true)
    await race(
      as(buyer) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(7000),gen_random_uuid(),'${f.offer}','revise');`,
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      '23505'
    )
    sql(
      `select public.b07_assert(not exists(select 1 from public.orders where listing_id='${f.listing}'),'stale revision cannot accept');`
    )
    f = fixture('accept-before-revise', true)
    await race(
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      as(buyer) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(7000),gen_random_uuid(),'${f.offer}','revise');`,
      '23514'
    )
    f = fixture('withdraw-before-accept', true)
    await race(
      as(buyer) +
        `select public.marketplace_withdraw_offer('${f.offer}',gen_random_uuid());`,
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      '23505'
    )
    sql(
      `select public.b07_assert(not exists(select 1 from public.orders where listing_id='${f.listing}'),'withdraw wins without Order');`
    )
    f = fixture('accept-before-withdraw', true)
    await race(
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      as(buyer) +
        `select public.marketplace_withdraw_offer('${f.offer}',gen_random_uuid());`,
      '23505'
    )
    f = fixture('counter-race', true)
    const opposing = sql(
      `select public.b07_actor('${seller}');select (public.marketplace_submit_offer('${f.conversation}',public.b07_terms(9000),gen_random_uuid(),'${f.offer}','counter')).id;`
    )
      .trim()
      .split(/\r?\n/)
      .at(-1)
    assert(/^[0-9a-f-]{36}$/.test(opposing))
    await race(
      as(buyer) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(7500),gen_random_uuid(),'${opposing}','counter');`,
      as(seller) +
        `select public.marketplace_submit_offer('${f.conversation}',public.b07_terms(8500),gen_random_uuid(),'${f.offer}','counter');`,
      '23505'
    )
    sql(
      `select public.b07_assert((select count(*) filter(where status='active')=2 from public.order_requests where conversation_id='${f.conversation}'),'counter race preserves both sides current versions');`
    )
    f = fixture('deny-before-accept', true)
    await race(
      as(seller) +
        `select public.marketplace_deny_offer('${f.offer}',gen_random_uuid());`,
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      '23505'
    )
    sql(
      `select public.b07_assert(not exists(select 1 from public.orders where listing_id='${f.listing}'),'deny wins without Order');`
    )
    f = fixture('accept-before-deny', true)
    await race(
      as(seller) +
        `select public.marketplace_accept_offer('${f.offer}','${f.command}','${f.batch}');`,
      as(seller) +
        `select public.marketplace_deny_offer('${f.offer}',gen_random_uuid());`,
      '23505'
    )
    console.log(
      'PASS B07 real two-connection races: idempotency, same-sender revisions, Counter stale comparison, accept replay, competing Buyers, revise/withdraw/deny vs Accept, one winner and unrelated inventory intact'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

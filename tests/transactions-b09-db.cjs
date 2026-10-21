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
    path.resolve('tests/artifacts/transactions-b09-db-')
  )
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

    // Reuse only B07 fixture definitions, never its mutation/time-warp tests.
    const fixtureSource = fs.readFileSync('tests/offers-b07-db.sql', 'utf8')
    sql(fixtureSource.slice(0, fixtureSource.indexOf('do $$<<b07>>')))

    sql(
      `create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`
    )
    sql(fs.readFileSync('tests/transactions-b09-db.sql', 'utf8'))
    console.log(
      'PASS B09 native external completion/dispute/cancel, private authority, local-only UU simulator, handoff lockouts and Buyer-only Protection'
    )
    const seller = '11111111-1111-4111-8111-111111111111',
      buyer = '22222222-2222-4222-8222-222222222222'
    const as = (id) =>
      `set role authenticated;select public.b07_actor('${id}');`
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
        const a = connection('b09_race_first')
        const locked = new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('B09 race lock deadline')),
            10000
          )
          a.p.stdout.on('data', () => {
            if (a.out.includes('B09_LOCKED')) resolve()
          })
          a.p.on('exit', () => {
            if (!a.out.includes('B09_LOCKED')) reject(Error(a.err))
          })
        })
        a.p.stdin.write('begin;' + one + '\n\\echo B09_LOCKED\n')
        await locked
        clearTimeout(timer)
        const b = connection('b09_race_second')
        b.p.stdin.end(two + '\n')
        // Prove overlap on the database server; process startup timing alone is
        // insufficient evidence that the competing statement actually waited.
        let blocked = false
        for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
          blocked =
            sql(
              "select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name='b09_race_second';"
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

    for (const name of [
      'dual',
      'same',
      'confirm-cancel',
      'cancel-confirm',
      'dispute-confirm',
      'confirm-dispute',
    ]) {
      const oid = sql(`select public.b09_make('race-${name}');`)
        .trim()
        .split('\n')
        .at(-1)
      const confirm = (id) =>
        as(id) +
        `select public.marketplace_confirm_external_exchange('${oid}',gen_random_uuid());`
      const cancel =
        as(seller) +
        `select public.marketplace_cancel_order('${oid}','seller_scheduling_issue','Local test',gen_random_uuid());`
      const dispute =
        as(seller) +
        `select public.marketplace_dispute_external_exchange('${oid}','No exchange',gen_random_uuid());`
      if (name.includes('dispute')) sql(confirm(buyer))
      let first, second, error
      if (name === 'dual') {
        first = confirm(buyer)
        second = confirm(seller)
      }
      if (name === 'same') {
        first = confirm(buyer)
        second = confirm(buyer)
      }
      if (name === 'confirm-cancel') {
        first = confirm(buyer)
        second = cancel
      }
      if (name === 'cancel-confirm') {
        first = cancel
        second = confirm(buyer)
        error = '23505'
      }
      if (name === 'dispute-confirm') {
        first = dispute
        second = confirm(seller)
        error = '23505'
      }
      if (name === 'confirm-dispute') {
        first = confirm(seller)
        second = dispute
        error = '23505'
      }
      await race(first, second, error)
      const expected = {
        dual: 'confirmed',
        same: 'buyer_confirmed',
        'confirm-cancel': 'buyer_confirmed',
        'cancel-confirm': 'awaiting_both',
        'dispute-confirm': 'disputed',
        'confirm-dispute': 'confirmed',
      }[name]
      sql(
        as(buyer) +
          `select public.b07_assert(public.marketplace_external_exchange('${oid}')->>'status'='${expected}','race ${name} canonical external state');`
      )
      const terminal = ['dual', 'confirm-dispute'].includes(name)
        ? 'completed'
        : name === 'cancel-confirm'
        ? 'cancelled'
        : 'open'
      sql(
        `select public.b07_assert((select lifecycle_status='${terminal}' and holds_listing=${
          terminal === 'open'
        } and payment_status='pending' and payout_status='not_eligible' from public.orders where id='${oid}'),'race ${name} lifecycle/hold/financial invariants');`
      )
    }
    console.log(
      'PASS B09 six lock-observed native races; no scheduler invocation or time rewrites'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

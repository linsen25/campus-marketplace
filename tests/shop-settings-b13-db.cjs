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
    path.resolve('tests/artifacts/shop-settings-b13-db-')
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

    // A deliberately ineligible fixture predates installed Auth triggers; no trigger bypass.
    sql(
      `insert into auth.users(id,email,email_confirmed_at) values('99999999-9999-4999-8999-999999999999','outside@example.com',now());`
    )
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (
        [
          '202610130007_staging_due_work_schedule.sql',
          '202610190003_shop_membership_authority.sql',
          '202610190005_public_shop_projection.sql',
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

    sql(
      fs.readFileSync(
        'supabase/migrations/202610190003_shop_membership_authority.sql',
        'utf8'
      )
    )
    // B15 reads depend on the B12 evaluator; apply only after its explicit stage.
    sql(
      fs.readFileSync(
        'supabase/migrations/202610190005_public_shop_projection.sql',
        'utf8'
      )
    )
    sql(fs.readFileSync('tests/shop-settings-b13-db.sql', 'utf8'))
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
    const race = async (one, two, error, inspect) => {
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
        const a = connection('b13_race_first')
        const locked = new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('B13 race lock deadline')),
            10000
          )
          a.p.stdout.on('data', () => {
            if (a.out.includes('B13_LOCKED')) resolve()
          })
          a.p.on('exit', () => {
            if (!a.out.includes('B13_LOCKED')) reject(Error(a.err))
          })
        })
        a.p.stdin.write('begin;' + one + '\n\\echo B13_LOCKED\n')
        await locked
        clearTimeout(timer)
        if (inspect) inspect()
        const b = connection('b13_race_second')
        b.p.stdin.end(two + '\n')
        // Prove overlap on the database server; process startup timing alone is
        // insufficient evidence that the competing statement actually waited.
        let blocked = false
        for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
          blocked =
            sql(
              "select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name='b13_race_second';"
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
        return { one: a.out, two: b.out }
      } finally {
        clearTimeout(timer)
        for (const c of children) if (c.exitCode === null) c.kill()
      }
    }

    const owner = '00000000-0000-4000-8000-000000000071'
    const auth =
      "set role authenticated;select set_config('request.jwt.claim.sub','" +
      owner +
      "',false);"
    const read = () =>
      JSON.parse(
        sql(
          "select row_to_json(s) from public.shops s where owner_id='" +
            owner +
            "';"
        ).trim()
      )
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
    const conditional = (base, name) =>
      auth +
      'with changed as (update public.shops set name=' +
      quote(name) +
      ' where ' +
      ['owner_id', 'id', 'updated_at', 'name', 'category', 'description']
        .map((k) => k + '=' + quote(base[k]))
        .join(' and ') +
      ' returning id) select count(*) from changed;'
    const base = read()
    assert(
      base.updated_at.includes('123456'),
      'native full microsecond version'
    )
    const output = await race(
      conditional(base, 'Concurrent winner'),
      conditional(base, 'Stale loser'),
      null
    )
    assert.match(output.one, /\b1\r?\nB13_LOCKED/, 'first UPDATE one row')
    assert(
      output.two.trim().endsWith('0'),
      'blocked stale UPDATE zero rows after commit'
    )
    assert.equal(read().name, 'Concurrent winner')
    assert.equal(read().category, base.category)
    const latest = read()
    sql(
      "begin;update public.shops set description='Intervening preimage' where owner_id='" +
        owner +
        "';commit;"
    )
    assert(sql(conditional(latest, 'Must not overwrite')).trim().endsWith('0'))
    sql(
      "select public.b13_assert((select count(*)=1 from marketplace_private.shop_membership_terms),'Settings created no membership');"
    )
    console.log(
      'PASS B13 actual PostgreSQL/RLS: microsecond version, blocked two-session CAS race, no stale overwrite, single-field persistence, Suspended owner, cross-user/anonymous/invalid fields; existing migrations only'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

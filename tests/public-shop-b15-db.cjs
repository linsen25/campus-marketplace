// Isolated native PostgreSQL, loopback only, no env files/Supabase CLI.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
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
    path.resolve('tests/artifacts/public-shop-b15-db-')
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
          '202610190004_shop_product_publication.sql',
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
        if (file === '202609290001_marketplace.sql')
          sql(
            "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('00000000-0000-4000-8000-000000000091','b15_legacy@uwo.ca',clock_timestamp(),'{\"display_name\":\"B15_Legacy\"}');"
          )
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
    sql(
      fs
        .readFileSync('tests/shop-products-b14-db.sql', 'utf8')
        .split('-- APPLY_B14')[0]
    )

    sql(
      fs.readFileSync(
        'supabase/migrations/202610190004_shop_product_publication.sql',
        'utf8'
      )
    )
    const helpers = fs
      .readFileSync('tests/shop-products-b14-db.sql', 'utf8')
      .split('-- APPLY_B14')[1]
      .split('do $$declare lid uuid;cmd')[0]
    sql(helpers)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610190005_public_shop_projection.sql',
        'utf8'
      )
    )
    const qualification = fs
      .readFileSync('tests/public-shop-b15-db.sql', 'utf8')
      .split('-- B15_REAL_EXPIRY')
    sql(qualification[0])
    sql('select pg_sleep(2.5);')
    sql(qualification[1])
    console.log(
      'PASS B15 actual local PostgreSQL public projection, entitlement, security and lifecycle qualification'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

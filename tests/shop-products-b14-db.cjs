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
    path.resolve('tests/artifacts/shop-products-b14-db-')
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
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
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
          '202610190004_shop_product_publication.sql',
          '20261023015435_shop_transaction_admission.sql',
          '20261023030000_shop_suspension_lifecycle.sql',
          '20261023173802_authoritative_shop_provider_notifications.sql',
          '20261023224905_worker_observability.sql',
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
    sql(
      fs
        .readFileSync('tests/shop-products-b14-db.sql', 'utf8')
        .split('-- APPLY_B14')[0]
    )

    let history = fs.readFileSync('tests/offers-b07-db.sql', 'utf8')
    history = history
      .slice(0, history.indexOf('do $$<<b07>>'))
      .replace(
        'select id,false from public.profiles;',
        'select id,false from public.profiles on conflict do nothing;'
      )
      .replace(
        'meeting_location,preferred_payment_mode)',
        'meeting_location,preferred_payment_mode,listing_channel)'
      )
      .replace(
        "'B07 test location','external')",
        "'B07 test location','external','shop')"
      )
      .replace(
        'perform public.marketplace_finalize_listing(lid);',
        'update public.listings set published_at=clock_timestamp() where id=lid;'
      )
    sql(history)
    sql(
      fs
        .readFileSync('tests/shop-products-b14-history.sql', 'utf8')
        .split('-- AFTER_B14')[0]
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610190004_shop_product_publication.sql',
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
    sql(
      fs.readFileSync(
        'supabase/migrations/20261023015435_shop_transaction_admission.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/20261023030000_shop_suspension_lifecycle.sql',
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/20261023173802_authoritative_shop_provider_notifications.sql',
        'utf8'
      )
    )
    sql(`create table cron.job(jobid bigint primary key,jobname text unique,active boolean not null default true);
      create table cron.job_run_details(jobid bigint,runid bigint,status text,start_time timestamptz,end_time timestamptz);`)
    sql(
      fs.readFileSync(
        'supabase/migrations/20261023224905_worker_observability.sql',
        'utf8'
      )
    )
    sql(
      fs
        .readFileSync('tests/shop-products-b14-history.sql', 'utf8')
        .split('-- AFTER_B14')[1]
    )

    sql(
      fs
        .readFileSync('tests/shop-products-b14-db.sql', 'utf8')
        .split('-- APPLY_B14')[1]
    )
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
    const race = async (one, two, error, inspect, releaseDelay = 0.2) => {
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
        const a = connection('b14_race_first')
        const locked = new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('B14 race lock deadline')),
            10000
          )
          a.p.stdout.on('data', () => {
            if (a.out.includes('B14_LOCKED')) resolve()
          })
          a.p.on('exit', () => {
            if (!a.out.includes('B14_LOCKED')) reject(Error(a.err))
          })
        })
        a.p.stdin.write('begin;' + one + '\n\\echo B14_LOCKED\n')
        await locked
        clearTimeout(timer)
        if (inspect) inspect()
        const b = connection('b14_race_second')
        b.p.stdin.end(two + '\n')
        // Prove overlap on the database server; process startup timing alone is
        // insufficient evidence that the competing statement actually waited.
        let blocked = false
        for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
          blocked =
            sql(
              "select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name='b14_race_second';"
            ).trim() === 't'
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert(
          blocked,
          'second native connection must be waiting on the held domain/command lock'
        )
        a.p.stdin.end(`select pg_sleep(${releaseDelay});commit;\n\\q\n`)
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

    const a = sql('select public.b14_draft(81)::text;').trim(),
      b = sql('select public.b14_draft(81)::text;').trim()
    const actor =
      "select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);"
    await race(
      actor + "select public.marketplace_finalize_listing('" + a + "');",
      actor + "select public.marketplace_finalize_listing('" + b + "');",
      '23514'
    )
    sql(
      "select public.b14_assert((select count(*)=40 from public.listings where seller_id=public.b14_owner(81) and published_at is not null and status in('available','pending','reserved')),'last-slot race stays at 40');"
    )
    await race(
      actor + "select public.marketplace_finalize_listing('" + a + "');",
      actor + "select public.marketplace_finalize_listing('" + a + "');",
      null
    )
    sql(
      "select public.b14_buy(88,'pro',clock_timestamp()-interval '1 month 2 days');select public.b14_fill(88,40);"
    )
    const downgradeDraft = sql('select public.b14_draft(88)::text;').trim()
    await race(
      "select public.b14_buy(88,'plus',clock_timestamp());",
      "select set_config('request.jwt.claim.sub',public.b14_owner(88)::text,false);select public.marketplace_finalize_listing('" +
        downgradeDraft +
        "');",
      '23514'
    )
    sql(
      "select public.b14_assert((select count(*)=40 from public.listings where seller_id=public.b14_owner(88) and published_at is not null),'concurrent downgrade preserves all 40');"
    )
    sql(
      "select public.b14_buy(89,'plus',(timezone('America/Toronto',clock_timestamp()-interval '432000 seconds'+interval '2 seconds')-interval '1 month') at time zone 'America/Toronto');"
    )
    const expiryDraft = sql('select public.b14_draft(89)::text;').trim()
    await race(
      'select 1 from marketplace_private.shop_memberships where owner_id=public.b14_owner(89) for update;',
      "select set_config('request.jwt.claim.sub',public.b14_owner(89)::text,false);select public.marketplace_finalize_listing('" +
        expiryDraft +
        "');",
      '42501',
      () =>
        assert.equal(
          sql(
            "select marketplace_private.shop_entitlements(public.b14_owner(89),clock_timestamp())->>'status';"
          ).trim(),
          'grace',
          'Grace is still active while the publication waits'
        ),
      2.5
    )
    sql(
      "select public.b14_assert((select published_at is null from public.listings where id='" +
        expiryDraft +
        "'),'expiry after lock wait leaves unpublished');"
    )
    sql(fs.readFileSync('tests/shop-transactions-b26-db.sql', 'utf8'))
    sql(
      "select public.b14_buy(86,'plus',(timezone('America/Toronto',clock_timestamp()-interval '432000 seconds'+interval '6 seconds')-interval '1 month') at time zone 'America/Toronto');"
    )
    const membershipRaceListing = sql(
      'select public.marketplace_finalize_listing(public.b14_draft(86))::text;'
    ).trim()
    sql(
      'update marketplace_private.shop_transaction_admission set enabled=true,updated_at=clock_timestamp() where singleton;'
    )
    await race(
      'select 1 from marketplace_private.shop_memberships where owner_id=public.b14_owner(86) for update;',
      "select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);select public.marketplace_contact_seller('" +
        membershipRaceListing +
        "');",
      '42501',
      () =>
        assert.equal(
          sql(
            "select marketplace_private.shop_entitlements(public.b14_owner(86),clock_timestamp())->>'status';"
          ).trim(),
          'grace',
          'Shop Grace is active while new contact waits on the membership lock'
        ),
      6.5
    )
    sql(
      "select public.b14_assert(not exists(select 1 from public.conversations where listing_origin_id='" +
        membershipRaceListing +
        "' and buyer_id='44444444-4444-4444-8444-444444444444'),'membership expiry while waiting cannot leak a Shop Conversation');"
    )
    const admissionRaceListing = sql(
      "select id from public.listings where seller_id=public.b14_owner(82) and listing_channel='shop' and published_at is not null and status='available' order by id limit 1;"
    ).trim()
    sql(
      'update marketplace_private.shop_transaction_admission set enabled=true,updated_at=clock_timestamp() where singleton;'
    )
    await race(
      'update marketplace_private.shop_transaction_admission set enabled=false,updated_at=clock_timestamp() where singleton;',
      "select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);select public.marketplace_contact_seller('" +
        admissionRaceListing +
        "');",
      '42501'
    )
    sql(
      "select public.b14_assert(not exists(select 1 from public.conversations where listing_origin_id='" +
        admissionRaceListing +
        "' and buyer_id='44444444-4444-4444-8444-444444444444'),'concurrent admission close cannot leak a Shop Conversation');"
    )
    sql(fs.readFileSync('tests/shop-suspension-b26-db.sql', 'utf8'))
    sql(fs.readFileSync('tests/notifications-b27-db.sql', 'utf8'))
    sql(fs.readFileSync('tests/worker-observability-b28-db.sql', 'utf8'))
    sql(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(public.b14_owner(91),'b26_race_91@uwo.ca',clock_timestamp(),jsonb_build_object('username','B26_Race_91'));" +
        'insert into public.notification_preferences(user_id,email_notifications) values(public.b14_owner(91),false) on conflict(user_id) do nothing;' +
        "insert into public.shops(owner_id,name,category,description) values(public.b14_owner(91),'B26 race Shop','Electronics','Suspension race');" +
        "select public.b14_buy(91,'plus',(timezone('America/Toronto',clock_timestamp()-interval '432000 seconds'+interval '6 seconds')-interval '1 month') at time zone 'America/Toronto');" +
        'update marketplace_private.shop_transaction_admission set enabled=true,updated_at=clock_timestamp() where singleton;'
    )
    const acceptRaceListing = sql(
      'select public.marketplace_finalize_listing(public.b14_draft(91))::text;'
    ).trim()
    const acceptRaceConversation = sql(
      "select public.b07_actor('33333333-3333-4333-8333-333333333333');select id from public.marketplace_contact_seller('" +
        acceptRaceListing +
        "');"
    ).trim()
    const acceptRaceOffer = sql(
      "select public.b07_actor('33333333-3333-4333-8333-333333333333');select id from public.marketplace_submit_offer('" +
        acceptRaceConversation +
        "',public.b07_terms(800,'external'),gen_random_uuid());"
    ).trim()
    const acceptRaceCommand = sql('select gen_random_uuid();').trim()
    const acceptRaceBatch = sql(
      'select public.b07_actor(public.b14_owner(91));select public.b07_prepare(' +
        "'" +
        acceptRaceOffer +
        "',auth.uid(),'" +
        acceptRaceCommand +
        "')::text;"
    ).trim()
    await race(
      'select 1 from marketplace_private.shop_memberships where owner_id=public.b14_owner(91) for update;',
      'select public.b07_actor(public.b14_owner(91));select public.marketplace_accept_offer(' +
        "'" +
        acceptRaceOffer +
        "','" +
        acceptRaceCommand +
        "','" +
        acceptRaceBatch +
        "');",
      '42501',
      () =>
        assert.equal(
          sql(
            "select marketplace_private.shop_entitlements(public.b14_owner(91),clock_timestamp())->>'status';"
          ).trim(),
          'grace',
          'Shop Grace is active while Offer Accept waits on the membership lock'
        ),
      6.5
    )
    sql(
      "select public.b14_assert(not exists(select 1 from public.orders where request_id='" +
        acceptRaceOffer +
        "'),'Suspension wins the Accept race without creating an Order');" +
        "select set_config('request.jwt.claim.role','service_role',false);select public.marketplace_shop_membership_lifecycle('process_due',50);select set_config('request.jwt.claim.role','',false);" +
        "select public.b14_assert((select status='closed' from public.order_requests where id='" +
        acceptRaceOffer +
        "'),'compensation scan closes the raced Offer once');" +
        'update marketplace_private.shop_transaction_admission set enabled=false,updated_at=clock_timestamp() where singleton;'
    )
    console.log(
      'PASS B14/B26 actual PostgreSQL: default-closed admission; shared transactions; suspension Offer closure; Buyer/Seller/Order/Resale message rules; idempotent system notices/reopen; concurrent membership expiry, Accept and admission-close races; B14 history preserved'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

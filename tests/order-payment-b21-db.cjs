// Isolated native PostgreSQL, loopback only. No env files or remote Supabase.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function run(name, args, input) {
  if (process.env.B21_DB_TRACE === '1')
    console.error('B21 DB:', name, args[0] || '')
  const result = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}),
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return (result.stdout || '').trim()
}

function psqlAsync(args, input) {
  const child = spawn(bin('psql'), args, {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (value) => (stdout += value))
  child.stderr.on('data', (value) => (stderr += value))
  child.stdin.end(input)
  return new Promise((resolve, reject) =>
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr))
    )
  )
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b21-db-'))
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
    'b21_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'b21_test',
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
    const sql = (text) => run('psql', args, text)
    sql(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema marketplace_private; create extension pgcrypto;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
      create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
      create table public.profiles(id uuid primary key);
      create table public.listings(id uuid primary key,status text,reserved_order_id uuid);
      create table public.orders(id uuid primary key,request_id uuid,conversation_id uuid,listing_id uuid references public.listings(id),buyer_id uuid,seller_id uuid,order_protocol_version int,terms_snapshot jsonb,lifecycle_status text,holds_listing boolean,payment_status text,updated_at timestamptz default now());
      create table marketplace_private.campus_payment_attempts(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),buyer_id uuid not null,command uuid not null,status text not null,started_at timestamptz not null,finished_at timestamptz,unique(buyer_id,command));
      create unique index campus_one_processing on marketplace_private.campus_payment_attempts(order_id) where status='processing';
      create table marketplace_private.financial_capabilities(user_id uuid,capability text,status text,primary key(user_id,capability));
      create table marketplace_private.delivery_checkouts(order_id uuid primary key,checkout_started_at timestamptz,payment_deadline_at timestamptz,address_snapshot jsonb,address_frozen_at timestamptz);
      create table marketplace_private.stripe_bindings(id uuid primary key default gen_random_uuid(),user_id uuid,kind text,platform text,mode text,status text,owner_ref text,instrument_ref text);
      create table public.transaction_events(conversation_id uuid,request_id uuid,order_id uuid,actor_id uuid,actor_role text,event_type text,created_at timestamptz,transition_key text,metadata jsonb);
      create function marketplace_private.require_stripe_staging() returns void language plpgsql security definer set search_path='' as $$begin if auth.role() is distinct from 'service_role' or auth.jwt()->>'ref' is distinct from 'pcaqxezdfxofysghssyo' then raise exception 'Trusted staging service required.' using errcode='42501';end if;end$$;
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
      create function marketplace_private.lock_financial_capability(uuid,text) returns void language sql as $$select$$;
      create function marketplace_private.order_agreement_ready(uuid) returns boolean language sql stable as $$select true$$;
      create function marketplace_private.payment_mode(jsonb) returns text language sql immutable as $$select $1->>'payment_mode'$$;
      create function marketplace_private.assert_order_progression(public.orders) returns void language sql as $$select$$;
      create function marketplace_private.v2_order_money(uuid) returns jsonb language sql stable as $$select '{"item":10000,"delivery":0,"fee":825,"total":10825,"sellerFee":0,"sellerGross":10000,"feeRule":"b21"}'::jsonb$$;
      create function marketplace_private.notify_order_history(uuid) returns void language sql as $$select$$;
      grant usage on schema public to anon,authenticated,service_role;
    `)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610200002_order_payment_intent_start.sql',
        'utf8'
      )
    )
    const buyer = '21333333-3333-4333-8333-333333333333'
    const other = '21666666-6666-4666-8666-666666666666'
    const seller = '21777777-7777-4777-8777-777777777777'
    const order = '21222222-2222-4222-8222-222222222222'
    const listing = '21888888-8888-4888-8888-888888888888'
    const attempt = '21111111-1111-4111-8111-111111111111'
    sql(`
      insert into public.profiles values('${buyer}'),('${other}'),('${seller}');
      insert into public.listings values('${listing}','pending','${order}');
      insert into public.orders(id,request_id,conversation_id,listing_id,buyer_id,seller_id,order_protocol_version,terms_snapshot,lifecycle_status,holds_listing,payment_status)
       values('${order}',gen_random_uuid(),gen_random_uuid(),'${listing}','${buyer}','${seller}',2,'{"terms":{"payment_mode":"uu_pay","fulfillment":"on_campus"}}','open',true,'processing');
      insert into marketplace_private.campus_payment_attempts(id,order_id,buyer_id,command,status,started_at) values('${attempt}','${order}','${buyer}',gen_random_uuid(),'processing',now());
      insert into marketplace_private.stripe_bindings(user_id,kind,platform,mode,status,owner_ref,instrument_ref) values
       ('${buyer}','payment_method','acct_TestPlatform','test','set','cus_Buyer','pm_Card'),
       ('${seller}','payout_account','acct_TestPlatform','test','ready','acct_Seller','ba_Bank');
    `)
    const claims = (sub) =>
      `select set_config('request.jwt.claims','{"sub":"${sub}","role":"service_role","ref":"pcaqxezdfxofysghssyo"}',false);`
    const call = `select public.marketplace_order_payment_provider('claim','${attempt}','${buyer}','acct_TestPlatform')->>'claimState';`
    assert.equal(
      sql(claims(buyer) + call)
        .split('\n')
        .at(-1),
      'create'
    )
    const identity = sql(
      `select provider_operation_id||'|'||provider_idempotency_key||'|'||provider_amount_cents||'|'||provider_currency from marketplace_private.campus_payment_attempts where id='${attempt}';`
    )
    assert(identity.includes('|10825|CAD'))
    assert.equal(
      sql(claims(buyer) + call)
        .split('\n')
        .at(-1),
      'in_progress'
    )
    assert.throws(() =>
      sql(
        claims(other) +
          `select public.marketplace_order_payment_provider('read','${attempt}','${other}','acct_TestPlatform');`
      )
    )
    assert.equal(
      sql(
        `select has_function_privilege('authenticated','public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb)','execute');`
      ),
      'f'
    )
    sql(
      `update marketplace_private.campus_payment_attempts set provider_lease_until=now()-interval '1 second' where id='${attempt}';`
    )
    const tag = 'b21_claim_race'
    const first = psqlAsync(
      args,
      `begin;set local application_name='${tag}';${claims(
        buyer
      )}${call}select pg_sleep(2);commit;`
    )
    let sleeping = false
    for (let index = 0; index < 20; index++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (
        sql(
          `select coalesce(wait_event,'') from pg_stat_activity where application_name='${tag}';`
        ).includes('PgSleep')
      ) {
        sleeping = true
        break
      }
    }
    assert(sleeping, 'first claim must hold the real row lock')
    const second = psqlAsync(args, claims(buyer) + call)
    const [firstOutput, secondOutput] = await Promise.all([first, second])
    assert(firstOutput.includes('create'))
    assert(secondOutput.includes('in_progress'))
    assert.equal(
      sql(
        `select provider_operation_id||'|'||provider_idempotency_key from marketplace_private.campus_payment_attempts where id='${attempt}';`
      ),
      identity.split('|').slice(0, 2).join('|')
    )
    const token = sql(
      `select provider_lease from marketplace_private.campus_payment_attempts where id='${attempt}';`
    )
    assert.equal(
      sql(
        claims(buyer) +
          `select public.marketplace_order_payment_provider('bind','${attempt}','${buyer}','acct_TestPlatform','${token}','{"providerReference":"pi_Order"}')->>'provider_reference';`
      )
        .split('\n')
        .at(-1),
      'pi_Order'
    )
    assert.throws(() =>
      sql(
        claims(buyer) +
          `select public.marketplace_order_payment_provider('bind','${attempt}','${buyer}','acct_TestPlatform','${token}','{"providerReference":"pi_Other"}');`
      )
    )
    assert(
      sql(
        `insert into marketplace_private.campus_payment_attempts(order_id,buyer_id,command,status,started_at,finished_at) values('${order}','${other}',gen_random_uuid(),'failed',now(),now()) returning provider is null;`
      ).startsWith('t')
    )
    console.log(
      'PASS B21 isolated PostgreSQL migration, legacy compatibility, owner isolation, stable retry identity, lease fencing, one-time provider binding, grants and constraints'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

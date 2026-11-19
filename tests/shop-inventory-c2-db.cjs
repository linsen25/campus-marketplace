// Disposable native PostgreSQL verification for C2.  It creates a loopback
// cluster under tests/artifacts, never reads environment credentials, and
// removes the cluster afterward.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
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
  const result = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(
    result.status,
    0,
    `${name}: ${result.stderr || result.error?.message}`
  )
  return result.stdout
}
function tryPsql(args, input) {
  return (
    spawnSync(bin('psql'), args, {
      input,
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 2000,
    }).status === 0
  )
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(
    path.resolve('tests/artifacts/shop-inventory-c2-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  const psqlArgs = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'inventory_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'inventory_test',
      '--auth=trust',
      '--no-locale',
      '--encoding=UTF8',
    ])
    // PostgreSQL 17 on this Windows runner can keep pg_ctl -w waiting even
    // after the server is accepting loopback connections. Start without -w,
    // then prove readiness through the same local psql transport the test uses.
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(folder, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      'start',
    ])
    started = true
    const sql = (text) => run('psql', psqlArgs, text)
    let ready = false
    for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
      ready = tryPsql(psqlArgs, 'select 1;')
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(
      ready,
      true,
      'temporary PostgreSQL did not accept loopback psql connections'
    )
    sql(`
      create schema auth;
      create schema marketplace_private;
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.profiles(id uuid primary key);
      create table public.shops(id uuid primary key, owner_id uuid not null unique references public.profiles(id));
      create table public.listings(
        id uuid primary key,
        seller_id uuid not null references public.profiles(id),
        listing_channel text not null check(listing_channel in ('resale','shop')),
        status text not null check(status in ('available','pending','reserved','sold')),
        reserved_order_id uuid
      );
      create function marketplace_private.is_verified_user() returns boolean language sql stable security definer set search_path='' as $$
        select auth.uid() is not null
      $$;
      create function marketplace_private.is_shop_operator(p_owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.shops where owner_id=p_owner_id and p_owner_id=auth.uid())
      $$;
      insert into public.profiles values
        ('10000000-0000-4000-8000-000000000001'),
        ('20000000-0000-4000-8000-000000000002');
      insert into public.shops values
        ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001'),
        ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002');
      insert into public.listings values
        ('50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','shop','available'),
        ('60000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','shop','sold'),
        ('70000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','shop','pending'),
        ('80000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','resale','available'),
        ('90000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000002','shop','available');
    `)
    sql(
      fs.readFileSync(
        'supabase/migrations/20261116102654_shop_inventory_security_foundation.sql',
        'utf8'
      )
    )
    sql(`
      create function public.c2_assert(ok boolean, label text) returns void language plpgsql as $$
      begin if ok is distinct from true then raise exception 'C2: %', label; end if; end $$;
      create function public.c2_reject(statement text, code text) returns void language plpgsql as $$
      begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end;
      raise exception 'C2 unexpected success: %', statement; end $$;
      select public.c2_assert((select on_hand_quantity=1 and reserved_quantity=0 and available_quantity=1 and low_stock_threshold=0
        from marketplace_private.shop_inventory where listing_id='50000000-0000-4000-8000-000000000005'),'available Shop backfill');
      select public.c2_assert((select on_hand_quantity=0 and available_quantity=0
        from marketplace_private.shop_inventory where listing_id='60000000-0000-4000-8000-000000000006'),'sold Shop backfill');
      select public.c2_assert(not exists(select 1 from marketplace_private.shop_inventory where listing_id in
        ('70000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000008')),'pending and resale omitted');
      select public.c2_reject($q$select marketplace_private.initialize_shop_inventory('70000000-0000-4000-8000-000000000007')$q$,'23514');
      select public.c2_assert((select count(*)=1 from marketplace_private.shop_inventory_adjustments
        where listing_id='50000000-0000-4000-8000-000000000005' and reason='initial_backfill'),'backfill audit');
      select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
      set role authenticated;
      select public.c2_assert((public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005')->>'availableQuantity')::integer=1,'owner read');
      select public.c2_assert((public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005',
        '{"actionId":"a0000000-0000-4000-8000-000000000010","delta":2,"expectedRevision":1}'::jsonb)->>'onHandQuantity')::integer=3,'owner increase');
      select public.c2_assert((public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005',
        '{"actionId":"a0000000-0000-4000-8000-000000000010","delta":2,"expectedRevision":1}'::jsonb)->>'idempotent')::boolean,'lost-response idempotency');
      select public.c2_reject($q$select public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005',
        '{"actionId":"b0000000-0000-4000-8000-000000000011","delta":-4,"expectedRevision":2}'::jsonb)$q$,'23514');
      select public.c2_reject($q$select * from marketplace_private.shop_inventory$q$,'42501');
      select public.c2_reject($q$insert into marketplace_private.shop_inventory_adjustments(
        inventory_listing_id,listing_id,shop_id,action_id,reason,delta,before_on_hand_quantity,after_on_hand_quantity)
        values('50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000014','manual_adjustment',1,3,4)$q$,'42501');
      select public.c2_reject($q$select public.marketplace_shop_inventory('90000000-0000-4000-8000-000000000009')$q$,'42501');
      reset role;
      update marketplace_private.shop_inventory set reserved_quantity=2 where listing_id='50000000-0000-4000-8000-000000000005';
      set role authenticated;
      select public.c2_reject($q$select public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005',
        '{"actionId":"c0000000-0000-4000-8000-000000000012","delta":-2,"expectedRevision":2}'::jsonb)$q$,'23514');
      reset role;
    `)
    const locker = spawn(bin('psql'), psqlArgs, {
      env,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    const lockerDone = new Promise((resolve, reject) =>
      locker.on('close', (code) =>
        code === 0 ? resolve() : reject(Error('locker failed'))
      )
    )
    locker.stdin.end(
      `begin; select * from marketplace_private.shop_inventory where listing_id='50000000-0000-4000-8000-000000000005' for update; select pg_sleep(0.7); commit;`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const race =
      sql(`select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); set role authenticated;
      select public.c2_reject($q$select public.marketplace_shop_inventory('50000000-0000-4000-8000-000000000005',
        '{"actionId":"d0000000-0000-4000-8000-000000000013","delta":1,"expectedRevision":1}'::jsonb)$q$,'40001'); reset role;`)
    assert.ok(typeof race === 'string')
    await lockerDone
    console.log(
      'PASS isolated C2 PostgreSQL: Shop-only backfill, owner authorization, atomic adjustment/audit, idempotency, reservation floor, private-table denial, and locked stale-write rejection'
    )
  } finally {
    if (started)
      spawnSync(
        bin('pg_ctl'),
        ['-D', data, '-m', 'immediate', '-w', '-t', '5', 'stop'],
        {
          env,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 7000,
        }
      )
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

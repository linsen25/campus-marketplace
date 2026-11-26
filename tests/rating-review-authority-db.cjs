const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
function run(name, args, input) {
  const result = spawnSync(bin(name), args, {
    input,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  assert.equal(
    result.status,
    0,
    `${name}: ${result.stderr || result.error?.message}`
  )
  return result.stdout
}
function runAsync(name, args, input) {
  return new Promise((resolve, reject) => {
    const process = spawn(bin(name), args, { env, windowsHide: true })
    let stderr = ''
    process.stderr.on('data', (chunk) => (stderr += chunk))
    process.on('error', reject)
    process.on('close', (status) => resolve({ status, stderr }))
    process.stdin.end(input)
  })
}
async function port() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
}

async function main() {
  const dbPort = await port()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-rating-review-db-'))
  const data = path.join(folder, 'data')
  let started = false
  const args = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-h',
    '127.0.0.1',
    '-p',
    String(dbPort),
    '-U',
    'review_test',
    '-d',
    'postgres',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'review_test',
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
      `-h 127.0.0.1 -p ${dbPort}`,
      'start',
    ])
    started = true
    const sql = (text) => run('psql', args, text)
    const migration = fs.readFileSync(
      path.join(
        root,
        'supabase/migrations/20261126100728_rating_review_authority_foundation.sql'
      ),
      'utf8'
    )
    const buyer = '10000000-0000-4000-8000-000000000001'
    const seller = '20000000-0000-4000-8000-000000000002'
    const other = '30000000-0000-4000-8000-000000000003'
    const shop = '40000000-0000-4000-8000-000000000004'
    const resale = '50000000-0000-4000-8000-000000000005'
    const product = '60000000-0000-4000-8000-000000000006'
    const selfListing = '60000000-0000-4000-8000-000000000014'
    const completed = '70000000-0000-4000-8000-000000000007'
    const shopOrder = '70000000-0000-4000-8000-000000000008'
    const expired = '70000000-0000-4000-8000-000000000009'
    const refunded = '70000000-0000-4000-8000-000000000010'
    const open = '70000000-0000-4000-8000-000000000011'
    const noEvent = '70000000-0000-4000-8000-000000000012'
    const concurrent = '70000000-0000-4000-8000-000000000013'
    const selfOrder = '70000000-0000-4000-8000-000000000014'
    const cancelled = '70000000-0000-4000-8000-000000000015'
    sql(`
      create extension if not exists pgcrypto;
      create schema auth; create schema marketplace_private;
      create role anon noinherit; create role authenticated noinherit; create role service_role noinherit;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.profiles(id uuid primary key);
      create table public.shops(id uuid primary key,owner_id uuid not null unique references public.profiles(id));
      create table public.listings(id uuid primary key,seller_id uuid not null references public.profiles(id),listing_channel text not null);
      create table public.orders(id uuid primary key,buyer_id uuid references public.profiles(id),seller_id uuid references public.profiles(id),listing_id uuid references public.listings(id),lifecycle_status text not null,payment_status text not null);
      create table public.transaction_events(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),event_type text not null,created_at timestamptz not null);
      create table marketplace_private.external_exchanges(order_id uuid primary key,disputed_at timestamptz);
      create table marketplace_private.protection_cases(order_id uuid primary key,state text not null);
      create function marketplace_private.is_verified_user() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and coalesce(current_setting('test.verified',true),'true')='true' $$;
      insert into public.profiles values('${buyer}'),('${seller}'),('${other}');
      insert into public.shops values('${shop}','${seller}');
      insert into public.listings values('${resale}','${seller}','resale'),('${product}','${seller}','shop'),('${selfListing}','${buyer}','resale');
      insert into public.orders values
        ('${completed}','${buyer}','${seller}','${resale}','completed','paid'),
        ('${shopOrder}','${buyer}','${seller}','${product}','completed','paid'),
        ('${expired}','${buyer}','${seller}','${resale}','completed','paid'),
        ('${refunded}','${buyer}','${seller}','${resale}','completed','refunded'),
        ('${open}','${buyer}','${seller}','${resale}','open','pending'),
        ('${noEvent}','${buyer}','${seller}','${resale}','completed','paid'),
        ('${concurrent}','${buyer}','${seller}','${resale}','completed','paid'),
        ('${selfOrder}','${buyer}','${buyer}','${selfListing}','completed','paid'),
        ('${cancelled}','${buyer}','${seller}','${resale}','cancelled','refunded');
      insert into public.transaction_events(order_id,event_type,created_at) values
        ('${completed}','order_completed',clock_timestamp()-interval '1 day'),
        ('${shopOrder}','order_completed',clock_timestamp()-interval '1 day'),
        ('${expired}','order_completed',clock_timestamp()-interval '15 days'),
        ('${refunded}','order_completed',clock_timestamp()-interval '1 day'),
        ('${open}','order_completed',clock_timestamp()-interval '1 day'),
        ('${concurrent}','order_completed',clock_timestamp()-interval '1 day'),
        ('${selfOrder}','order_completed',clock_timestamp()-interval '1 day');
    `)
    sql(migration)
    const asBuyer = `perform set_config('request.jwt.claim.sub','${buyer}',false); set role authenticated;`
    const call = (order, subject, action, rating = 10) =>
      `select public.marketplace_submit_order_review('${order}'::uuid,'${subject}',${rating},'good experience','["reliable"]'::jsonb,'${action}'::uuid);`
    sql(`do $$ begin
      ${asBuyer}
      if not ((public.marketplace_review_eligibility('${completed}'::uuid,'resale_seller')->>'eligible')::boolean) then raise exception 'completed buyer should be eligible'; end if;
      perform public.marketplace_submit_order_review('${completed}'::uuid,'resale_seller',10,'great','["reliable","friendly"]'::jsonb,'80000000-0000-4000-8000-000000000001');
      begin perform public.marketplace_submit_order_review('${completed}'::uuid,'resale_seller',10,'great','["reliable","friendly"]'::jsonb,'80000000-0000-4000-8000-000000000002'); raise exception 'duplicate should reject'; exception when sqlstate '23505' then null; end;
      if not ((public.marketplace_submit_order_review('${completed}'::uuid,'resale_seller',10,'great','["reliable","friendly"]'::jsonb,'80000000-0000-4000-8000-000000000001')->>'idempotent')::boolean) then raise exception 'same action retry must be idempotent'; end if;
      if not ((public.marketplace_review_eligibility('${shopOrder}'::uuid,'shop')->>'eligible')::boolean)
         or not ((public.marketplace_review_eligibility('${shopOrder}'::uuid,'shop_product')->>'eligible')::boolean) then raise exception 'shop and product must be independently eligible'; end if;
      perform public.marketplace_submit_order_review('${shopOrder}'::uuid,'shop',9,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000003');
      perform public.marketplace_submit_order_review('${shopOrder}'::uuid,'shop_product',8,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000004');
      begin perform public.marketplace_submit_order_review('${open}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000005'); raise exception 'open should reject'; exception when sqlstate '23514' then null; end;
      begin perform public.marketplace_submit_order_review('${cancelled}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000013'); raise exception 'cancelled should reject'; exception when sqlstate '23514' then null; end;
      begin perform public.marketplace_submit_order_review('${expired}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000006'); raise exception 'expired window should reject'; exception when sqlstate '23514' then null; end;
      begin perform public.marketplace_submit_order_review('${refunded}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000007'); raise exception 'refunded should reject'; exception when sqlstate '23514' then null; end;
      begin perform public.marketplace_submit_order_review('${noEvent}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000008'); raise exception 'missing event should reject'; exception when sqlstate '23514' then null; end;
      begin perform public.marketplace_submit_order_review('${selfOrder}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000012'); raise exception 'self purchase should reject'; exception when sqlstate '23514' then null; end;
      reset role;
    end $$;`)
    assert.equal(
      sql(
        `select count(*)::text from marketplace_private.reviews where order_id='${completed}'::uuid`
      ).trim(),
      '1'
    )
    assert.equal(
      sql(
        `select count(*)::text from marketplace_private.reviews where order_id='${shopOrder}'::uuid`
      ).trim(),
      '2'
    )
    sql(`do $$ begin
      perform set_config('request.jwt.claim.sub','${seller}',false); set role authenticated;
      begin perform public.marketplace_submit_order_review('${completed}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000009'); raise exception 'seller should reject'; exception when sqlstate '23514' then null; end;
      reset role;
      perform set_config('request.jwt.claim.sub','${other}',false); set role authenticated;
      begin perform public.marketplace_submit_order_review('${completed}'::uuid,'resale_seller',10,null,'[]'::jsonb,'80000000-0000-4000-8000-000000000010'); raise exception 'third party should reject'; exception when sqlstate '23514' then null; end;
      begin update marketplace_private.reviews set rating_units=1; raise exception 'direct update should reject'; exception when sqlstate '42501' then null; end;
      begin delete from marketplace_private.reviews; raise exception 'direct delete should reject'; exception when sqlstate '42501' then null; end;
      reset role;
    end $$;`)
    const concurrencySql = `select set_config('request.jwt.claim.sub','${buyer}',false); set role authenticated; begin; select pg_sleep(0.15); ${call(
      concurrent,
      'resale_seller',
      '80000000-0000-4000-8000-000000000011'
    )} commit;`
    const concurrentResult = await Promise.all([
      runAsync('psql', args, concurrencySql),
      runAsync('psql', args, concurrencySql),
    ])
    assert.equal(
      concurrentResult.filter((result) => result.status === 0).length,
      2,
      concurrentResult.map((result) => result.stderr).join('\n')
    )
    assert.equal(
      sql(
        `select count(*)::text from marketplace_private.reviews where order_id='${concurrent}'::uuid`
      ).trim(),
      '1'
    )
    assert.equal(
      sql(
        `select set_config('request.jwt.claim.sub','${buyer}',false); set role authenticated; select set_config('test.verified','false',false); select public.marketplace_review_eligibility('${concurrent}'::uuid,'resale_seller')->>'reason';`
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .at(-1),
      'verified_account_required'
    )
    console.log('PASS rating/review authority database contract')
  } finally {
    if (started) run('pg_ctl', ['-D', data, 'stop', '-m', 'fast'])
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})

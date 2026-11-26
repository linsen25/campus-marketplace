const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const bin = (name) =>
  path.join(process.env.PG_BIN || 'C:/pgsql/bin', `${name}.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const run = (name, args, input) => {
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
const port = () =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })

async function main() {
  const dbPort = await port()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-rating-r3-db-'))
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
    'review_r3',
    '-d',
    'postgres',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'review_r3',
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
    const sql = (source) => run('psql', args, source)
    const buyer = '10000000-0000-4000-8000-000000000001'
    const seller = '20000000-0000-4000-8000-000000000002'
    const other = '30000000-0000-4000-8000-000000000003'
    const shop = '40000000-0000-4000-8000-000000000004'
    const resale = '50000000-0000-4000-8000-000000000005'
    const product = '60000000-0000-4000-8000-000000000006'
    const resaleOrder = '70000000-0000-4000-8000-000000000007'
    const shopOrder = '70000000-0000-4000-8000-000000000008'
    sql(`create extension if not exists pgcrypto; create schema auth; create schema marketplace_private;
      create role anon noinherit; create role authenticated noinherit; create role service_role noinherit;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.profiles(id uuid primary key,display_name text); create table public.shops(id uuid primary key,owner_id uuid unique references public.profiles(id));
      create table public.listings(id uuid primary key,seller_id uuid references public.profiles(id),listing_channel text); create table public.orders(id uuid primary key,buyer_id uuid references public.profiles(id),seller_id uuid references public.profiles(id),listing_id uuid references public.listings(id),lifecycle_status text,payment_status text);
      create table public.transaction_events(id uuid primary key default gen_random_uuid(),order_id uuid,event_type text,created_at timestamptz); create table marketplace_private.external_exchanges(order_id uuid primary key,disputed_at timestamptz); create table marketplace_private.protection_cases(order_id uuid primary key,state text);
      create function marketplace_private.is_verified_user() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null$$;
      insert into public.profiles values('${buyer}','Buyer'),('${seller}','Seller'),('${other}','Other'); insert into public.shops values('${shop}','${seller}'); insert into public.listings values('${resale}','${seller}','resale'),('${product}','${seller}','shop'); insert into public.orders values('${resaleOrder}','${buyer}','${seller}','${resale}','completed','paid'),('${shopOrder}','${buyer}','${seller}','${product}','completed','paid'); insert into public.transaction_events(order_id,event_type,created_at) values('${resaleOrder}','order_completed',clock_timestamp()),('${shopOrder}','order_completed',clock_timestamp());`)
    for (const file of [
      '20261126100728_rating_review_authority_foundation.sql',
      '20261126204612_rating_review_public_read_and_replies.sql',
    ])
      sql(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'))
    const asBuyer = `select set_config('request.jwt.claim.sub','${buyer}',false); set role authenticated;`
    sql(
      `${asBuyer} select public.marketplace_submit_order_review('${resaleOrder}','resale_seller',9,'Great','["reliable"]','80000000-0000-4000-8000-000000000001'); select public.marketplace_submit_order_review('${shopOrder}','shop',8,null,'[]','80000000-0000-4000-8000-000000000002'); select public.marketplace_submit_order_review('${shopOrder}','shop_product',10,null,'[]','80000000-0000-4000-8000-000000000003'); reset role;`
    )
    const privateRead = sql(
      `${asBuyer} select public.marketplace_get_order_reviews('${resaleOrder}'); reset role;`
    )
    assert.match(privateRead, /Great/)
    sql(
      `do $$ begin perform set_config('request.jwt.claim.sub','${other}',false); set role authenticated; begin perform public.marketplace_get_order_reviews('${resaleOrder}'); raise exception 'expected private denial'; exception when sqlstate '42501' then null; end; reset role; end $$;`
    )
    const shopSummary = sql(
      `select public.marketplace_get_review_summary('shop','${shop}');`
    )
    assert.match(shopSummary, /4\.0/)
    const productSummary = sql(
      `select public.marketplace_get_review_summary('shop_product','${product}');`
    )
    assert.match(productSummary, /5\.0/)
    assert.match(
      sql(
        `select public.marketplace_get_review_summary('resale_seller','${seller}');`
      ),
      /4\.5/
    )
    assert.match(
      sql(`select public.marketplace_get_public_reviews('shop','${shop}',10);`),
      /Buyer/
    )
    const resaleReviewId = sql(
      `select id from marketplace_private.reviews where order_id='${resaleOrder}'::uuid`
    ).trim()
    const shopReviewId = sql(
      `select id from marketplace_private.reviews where order_id='${shopOrder}'::uuid and subject_type='shop'`
    ).trim()
    sql(
      `do $$ begin perform set_config('request.jwt.claim.sub','${seller}',false); set role authenticated; perform public.marketplace_submit_review_reply('${resaleReviewId}'::uuid,'Thank you'); begin perform public.marketplace_submit_review_reply('${resaleReviewId}'::uuid,'Again'); raise exception 'expected duplicate reply denial'; exception when sqlstate '23505' then null; end; reset role; end $$;`
    )
    sql(
      `do $$ begin perform set_config('request.jwt.claim.sub','${other}',false); set role authenticated; begin perform public.marketplace_submit_review_reply('${shopReviewId}'::uuid,'No'); raise exception 'expected owner denial'; exception when sqlstate '42501' then null; end; reset role; end $$;`
    )
    assert.match(
      sql(
        `select public.marketplace_get_public_reviews('resale_seller','${seller}',10);`
      ),
      /Thank you/
    )
    console.log('PASS rating/review R3 isolated PostgreSQL contract')
  } finally {
    if (started) run('pg_ctl', ['-D', data, 'stop', '-m', 'fast'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})

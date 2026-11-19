// Isolated PostgreSQL execution test for the new projection only. It creates
// a disposable loopback cluster and does not contact Supabase.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const bin = (name) =>
  path.join('C:/pgsql/bin', name + (process.platform === 'win32' ? '.exe' : ''))
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
function run(name, args, input) {
  const result = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.error}`)
  return result.stdout
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-shop-favorites-'))
  const data = path.join(root, 'data')
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'offers_test',
      '--auth=trust',
      '--no-locale',
    ])
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(root, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ])
    started = true
    const sql = (input) =>
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
        input
      )
    sql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema marketplace_private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function marketplace_private.is_verified_user() returns boolean
      language sql stable as $$select auth.uid() is not null$$;
      create table public.profiles(id uuid primary key, username text);
      create table public.shops(id uuid primary key, owner_id uuid not null, name text not null);
      create table public.listings(
        id uuid primary key, seller_id uuid not null, listing_channel text not null,
        published_at timestamptz, status text not null, created_at timestamptz not null default now()
      );
      create table public.listing_favorites(user_id uuid not null, listing_id uuid not null);
      create function marketplace_private.public_shop_eligibility(owner uuid) returns jsonb
      language sql stable as $$
        select case when owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
          then null else jsonb_build_object('refreshAfterMs', 30000) end
      $$;
      create function marketplace_private.public_shop_product(target public.listings) returns jsonb
      language sql stable as $$select jsonb_build_object('id', target.id, 'title', 'public')$$;
    `)
    sql(
      fs.readFileSync(
        'supabase/migrations/20261115000000_favorite_shop_products.sql',
        'utf8'
      )
    )
    sql(`
      insert into public.profiles values
        ('11111111-1111-4111-8111-111111111111', 'buyer'),
        ('22222222-2222-4222-8222-222222222222', 'shop_one'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hidden_shop');
      insert into public.shops values
        ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'Shop One'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hidden Shop');
      insert into public.listings values
        ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'shop', now(), 'available', now()),
        ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'shop', now(), 'available', now() - interval '1 second'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'shop', now(), 'available', now());
      insert into public.listing_favorites values
        ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444'),
        ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555'),
        ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
    `)
    const first = JSON.parse(
      sql(`
        select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)
        \\gset
        select public.marketplace_favorite_shop_products('{"pageSize":1}');
      `).trim()
    )
    assert.equal(first.items.length, 1)
    assert.equal(first.hasNextPage, true)
    assert.equal(first.shops.length, 1, 'ineligible Shop must not be projected')
    assert.equal(first.shops[0].id, '33333333-3333-4333-8333-333333333333')
    const selected = JSON.parse(
      sql(`
        select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)
        \\gset
        select public.marketplace_favorite_shop_products('{"shopId":"33333333-3333-4333-8333-333333333333"}');
      `).trim()
    )
    assert.equal(
      selected.items.length,
      2,
      'Shop filter occurs before pagination'
    )
    const denied = spawnSync(
      bin('psql'),
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
      {
        input: `
          select set_config('request.jwt.claim.sub', '', false);
          select public.marketplace_favorite_shop_products('{}');
        `,
        env,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 30000,
      }
    )

    assert.notEqual(denied.status, 0, 'Unauthenticated request must fail')
    assert.match(denied.stderr, /Verified account required/)
    console.log('PASS isolated PostgreSQL Shop favorite-products projection')
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

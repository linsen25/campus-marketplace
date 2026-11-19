// Disposable, loopback-only C3 verification. It never reads PG_* credentials
// and removes its temporary cluster whether assertions pass or fail.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const run = (name, args, input) => {
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

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(
    path.join(root, 'tests/artifacts/shop-inventory-c3-db-')
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
    sql(`
      create extension if not exists pgcrypto;
      create schema auth; create schema marketplace_private;
      create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.profiles(id uuid primary key, username text, display_name text);
      create table public.shops(id uuid primary key, owner_id uuid not null unique references public.profiles(id), name text not null);
      create table public.listings(
        id uuid primary key, seller_id uuid not null references public.profiles(id), listing_channel text not null check(listing_channel in ('resale','shop')),
        status text not null default 'available' check(status in ('available','pending','reserved','sold')), reserved_order_id uuid,
        title text, description text, price_cents bigint, currency text, category text, subcategory text, condition text, pickup_area text,
        expected_image_count integer, preferred_payment_mode text, preferred_fulfillment text, meeting_area text, meeting_location text,
        meeting_location_provider text, meeting_place_id text, meeting_location_detail text, estimated_delivery_fee_cents bigint,
        created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), published_at timestamptz default clock_timestamp()
      );
      create table public.listing_images(id uuid primary key default gen_random_uuid(), listing_id uuid, owner_id uuid, path text, slot integer, ready boolean);
      create function marketplace_private.is_verified_user() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null $$;
      create function marketplace_private.is_shop_operator(p_owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.shops where owner_id=p_owner_id and p_owner_id=auth.uid()) $$;
      create function marketplace_private.shop_profile_text_length(value text) returns integer language sql immutable as $$ select char_length(value) $$;
      create function marketplace_private.valid_meeting_reference(provider text, place_id text) returns boolean language sql immutable as $$ select provider='google' and place_id is not null $$;
      create function marketplace_private.is_uwo_email_verified(uuid) returns boolean language sql immutable as $$ select false $$;
      insert into public.profiles values ('10000000-0000-4000-8000-000000000001','owner','Owner'),('20000000-0000-4000-8000-000000000002','other','Other');
      insert into public.shops values ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Owner Shop');
      insert into public.listings(id,seller_id,listing_channel,status) values ('50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','shop','available');
    `)
    sql(
      fs.readFileSync(
        path.join(
          root,
          'supabase/migrations/20261116102654_shop_inventory_security_foundation.sql'
        ),
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        path.join(
          root,
          'supabase/migrations/20261116114008_shop_inventory_integration.sql'
        ),
        'utf8'
      )
    )
    const output = sql(`
      select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); set role authenticated;
      select public.marketplace_create_shop_listing(
        '{"title":"C3 product","description":"test","price_cents":100,"currency":"CAD","category":"Books","expected_image_count":1,"preferred_payment_mode":"in_person","preferred_fulfillment":"ON_CAMPUS","meeting_area":"OTHER","meeting_location":"Library","meeting_location_provider":"google","meeting_place_id":"place-c3","estimated_delivery_fee_cents":0}'::jsonb,
        '60000000-0000-4000-8000-000000000006');
      select (public.marketplace_shop_inventory('60000000-0000-4000-8000-000000000006')->>'onHandQuantity')::integer;
      select public.marketplace_create_shop_listing(
        '{"title":"C3 product","description":"test","price_cents":100,"currency":"CAD","category":"Books","expected_image_count":1,"preferred_payment_mode":"in_person","preferred_fulfillment":"ON_CAMPUS","meeting_area":"OTHER","meeting_location":"Library","meeting_location_provider":"google","meeting_place_id":"place-c3","estimated_delivery_fee_cents":0}'::jsonb,
        '60000000-0000-4000-8000-000000000006');
      select (public.marketplace_shop_inventory('60000000-0000-4000-8000-000000000006')->>'onHandQuantity')::integer;
      reset role;
    `)
    assert.match(output, /60000000-0000-4000-8000-000000000006/)
    assert.equal(
      (output.match(/^1$/gm) || []).length,
      2,
      'creation retry must preserve the existing quantity'
    )
    console.log(
      'PASS isolated C3 PostgreSQL: Shop creation initializes one idempotent private inventory row.'
    )
  } finally {
    if (started)
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '5', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

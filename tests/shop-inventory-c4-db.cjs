/* Disposable, loopback-only C4 archive test. It never reads PG_* credentials. */
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
    path.join(root, 'tests/artifacts/shop-inventory-c4-db-')
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
      create table public.profiles(id uuid primary key, username text, username_normalized text, display_name text, avatar_path text);
      create table public.shops(id uuid primary key, owner_id uuid not null unique references public.profiles(id), name text not null, category text, description text);
      create table public.listings(
        id uuid primary key, seller_id uuid not null references public.profiles(id), listing_channel text not null check(listing_channel in ('resale','shop')),
        status text not null default 'available' check(status in ('available','pending','reserved','sold')), reserved_order_id uuid,
        title text, description text, price_cents bigint, currency text, category text, subcategory text, condition text, pickup_area text,
        expected_image_count integer, preferred_payment_mode text, preferred_fulfillment text, meeting_area text, meeting_location text,
        meeting_location_provider text, meeting_place_id text, meeting_location_detail text, estimated_delivery_fee_cents bigint,
        created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), published_at timestamptz default clock_timestamp()
      );
      create table public.listing_images(id uuid primary key default gen_random_uuid(), listing_id uuid, owner_id uuid, path text, storage_bucket text, slot integer, ready boolean);
      create table public.listing_favorites(user_id uuid, listing_id uuid);
      create table public.conversations(
        id uuid primary key default gen_random_uuid(), listing_origin_id uuid not null, listing_id uuid, buyer_id uuid, seller_id uuid,
        listing_title_snapshot text, listing_price_cents_snapshot bigint, listing_currency_snapshot text, listing_category_snapshot text,
        listing_channel_snapshot text, shop_name_snapshot text, created_at timestamptz, updated_at timestamptz, last_message_at timestamptz,
        last_message_sequence bigint default 0, buyer_last_read_sequence bigint default 0, seller_last_read_sequence bigint default 0,
        constraint conversations_identity unique(listing_origin_id,buyer_id,seller_id)
      );
      create table public.order_requests(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id));
      create table public.orders(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id));
      create function marketplace_private.is_verified_user() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null $$;
      create function marketplace_private.is_shop_operator(p_owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.shops where owner_id=p_owner_id and p_owner_id=auth.uid()) $$;
      create function marketplace_private.shop_profile_text_length(value text) returns integer language sql immutable as $$ select char_length(value) $$;
      create function marketplace_private.valid_meeting_reference(provider text, place_id text) returns boolean language sql immutable as $$ select provider='google' and place_id is not null $$;
      create function marketplace_private.is_uwo_email_verified(uuid) returns boolean language sql immutable as $$ select false $$;
      create function marketplace_private.public_shop_eligibility(uuid) returns jsonb language sql stable as $$ select jsonb_build_object('canOperateShop',true,'refreshAfterMs',30000,'badgeTier','plus') $$;
      create function marketplace_private.public_shop_query(p_query jsonb,p_keys text[]) returns jsonb language sql immutable as $$ select jsonb_build_object('page',1,'pageSize',20,'sort','newest')||p_query $$;
      insert into public.profiles values
        ('10000000-0000-4000-8000-000000000001','owner','owner','Owner',null),
        ('20000000-0000-4000-8000-000000000002','other','other','Other',null);
      insert into public.shops values ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Owner Shop','Other','test');
      insert into public.listings(id,seller_id,listing_channel,status,title,description,price_cents,currency,category,expected_image_count,preferred_payment_mode,preferred_fulfillment,meeting_area,meeting_location,meeting_location_provider,meeting_place_id,estimated_delivery_fee_cents)
      values ('50000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','shop','available','Archive fixture','test',100,'CAD','Books',1,'in_person','ON_CAMPUS','OTHER','Library','google','place-c4',0),
             ('70000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','resale','available','Resale fixture','test',100,'CAD','Books',1,'in_person','ON_CAMPUS','OTHER','Library','google','place-resale',0);
    `)
    for (const migration of [
      '20261116102654_shop_inventory_security_foundation.sql',
      '20261116114008_shop_inventory_integration.sql',
      '20261116213724_shop_listing_archive_lifecycle.sql',
    ])
      sql(
        fs.readFileSync(
          path.join(root, 'supabase/migrations', migration),
          'utf8'
        )
      )
    const output = sql(`
      select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); set role authenticated;
      select public.marketplace_archive_shop_listing('50000000-0000-4000-8000-000000000005');
      select public.marketplace_archive_shop_listing('50000000-0000-4000-8000-000000000005');
      reset role;
      select (select archived_at is not null from public.listings where id='50000000-0000-4000-8000-000000000005');
      select (select count(*) from marketplace_private.shop_inventory where listing_id='50000000-0000-4000-8000-000000000005');
      select (select count(*) from marketplace_private.shop_inventory_adjustments where listing_id='50000000-0000-4000-8000-000000000005');
      select public.marketplace_public_shop_products('{"id":"50000000-0000-4000-8000-000000000005"}'::jsonb);
      do $$ begin
        begin insert into public.order_requests(listing_id) values('50000000-0000-4000-8000-000000000005'); raise exception 'expected reject';
        exception when sqlstate '23514' then null; end;
        begin perform public.marketplace_archive_shop_listing('70000000-0000-4000-8000-000000000007'); raise exception 'expected resale reject';
        exception when sqlstate '42501' then null; end;
      end $$;
      select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false); set role authenticated;
      do $$ begin
        begin perform public.marketplace_archive_shop_listing('50000000-0000-4000-8000-000000000005'); raise exception 'expected owner reject';
        exception when sqlstate '42501' then null; end;
      end $$;
      reset role;
    `)
    assert.match(output, /"idempotent"\s*:\s*false/)
    assert.match(output, /"idempotent"\s*:\s*true/)
    assert.equal((output.match(/^t$/gm) || []).length, 1)
    assert.equal((output.match(/^1$/gm) || []).length, 2)
    assert.match(output, /"state"\s*:\s*"not_found"/)
    console.log(
      'PASS isolated C4 PostgreSQL: Shop archive is owner-only/idempotent, retains private inventory/audit, blocks resale and new transactions.'
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

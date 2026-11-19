// Local-only disposable PostgreSQL test for the new Favorites Search/Category/Sort migration.
// Requires C:/pgsql/bin/{initdb,pg_ctl,psql}. Never connects to Supabase or any existing DB.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const BIN = 'C:/pgsql/bin'
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))
)
const buyer = '11111111-1111-4111-8111-111111111111'
const outsider = '99999999-9999-4999-8999-999999999999'
const sellerA = '22222222-2222-4222-8222-222222222222'
const sellerB = '66666666-6666-4666-8666-666666666666'
const hiddenOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const shopA = '33333333-3333-4333-8333-333333333333'
const shopB = '77777777-7777-4777-8777-777777777777'
const hiddenShop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const product1 = '44444444-4444-4444-8444-444444444444' // Alpha, 1000
const product2 = '55555555-5555-4555-8555-555555555555' // Zeta, 3000
const product3 = '88888888-8888-4888-8888-888888888888' // Beta, 2000
const productArchived = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const productHidden = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function exec(name, args, input, allowFailure = false) {
  const result = spawnSync(path.join(BIN, name + '.exe'), args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    env,
    timeout: 30000,
  })
  if (!allowFailure)
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.error}`)
  return result
}
function getPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.on('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port
      socket.close(() => resolve(port))
    })
  })
}
async function main() {
  const migrationPath = path.resolve(
    'supabase/migrations/20261117223000_shop_favorites_query_filters.sql'
  )
  assert.ok(
    fs.existsSync(migrationPath),
    'Run from UU-V1 project root; new Favorites migration missing'
  )
  for (const b of ['initdb', 'pg_ctl', 'psql'])
    assert.ok(
      fs.existsSync(path.join(BIN, b + '.exe')),
      `Missing ${BIN}/${b}.exe`
    )
  const port = await getPort()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-favorites-filters-'))
  const data = path.join(root, 'data')
  let started = false
  try {
    exec('initdb', [
      '-D',
      data,
      '-U',
      'favorites_test',
      '--auth=trust',
      '--no-locale',
    ])
    exec('pg_ctl', [
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
    const args = [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'favorites_test',
      '-d',
      'postgres',
      '-At',
    ]
    const sql = (statement, allowFailure = false) =>
      exec('psql', args, statement, allowFailure)
    sql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema marketplace_private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function marketplace_private.is_verified_user() returns boolean
      language sql stable as $$select auth.uid() is not null$$;
      create function marketplace_private.public_shop_query(q jsonb, allowed text[]) returns jsonb
      language plpgsql stable as $$
      begin
        if jsonb_typeof(q) <> 'object' or exists (
          select 1 from jsonb_object_keys(q) x where x <> all(allowed)
        ) then raise exception 'Bad pagination' using errcode='23514'; end if;
        if coalesce((q->>'page')::integer,1) < 1 or
           coalesce((q->>'pageSize')::integer,20) not between 1 and 100
        then raise exception 'Bad pagination' using errcode='23514'; end if;
        return jsonb_build_object('page',coalesce((q->>'page')::integer,1),
          'pageSize',coalesce((q->>'pageSize')::integer,20));
      end; $$;
      create table public.profiles(id uuid primary key, username text);
      create table public.shops(id uuid primary key, owner_id uuid not null, name text not null, category text not null);
      create table public.shop_favorites(user_id uuid not null, shop_id uuid not null, created_at timestamptz not null default now());
      create table public.listings(id uuid primary key, seller_id uuid not null,
        listing_channel text not null, published_at timestamptz, status text not null,
        created_at timestamptz not null, title text not null, category text not null,
        price_cents integer not null, archived_at timestamptz);
      create table public.listing_favorites(user_id uuid not null, listing_id uuid not null);
      create function marketplace_private.public_shop_eligibility(owner uuid) returns jsonb
      language sql stable as $$
        select case when owner='${hiddenOwner}'::uuid then null
          else jsonb_build_object('refreshAfterMs',30000) end
      $$;
      create function marketplace_private.public_shop_profile(s public.shops) returns jsonb
      language sql stable as $$select jsonb_build_object('id',s.id,'shopName',s.name,'category',s.category)$$;
      create function marketplace_private.public_shop_product(l public.listings) returns jsonb
      language sql stable as $$select jsonb_build_object('id',l.id,'title',l.title,'category',l.category,'price',l.price_cents)$$;
    `)
    sql(fs.readFileSync(migrationPath, 'utf8'))
    sql(`
      insert into public.profiles values
        ('${buyer}','buyer'),('${sellerA}','seller_a'),('${sellerB}','seller_b'),('${hiddenOwner}','hidden');
      insert into public.shops values
        ('${shopA}','${sellerA}','Zeta Shop','Clothing & Accessories'),
        ('${shopB}','${sellerB}','Alpha Shop','Electronics'),
        ('${hiddenShop}','${hiddenOwner}','Secret Shop','Electronics');
      insert into public.shop_favorites(user_id,shop_id,created_at) values
        ('${buyer}','${shopA}',now()-interval '2 days'),
        ('${buyer}','${shopB}',now()-interval '1 day'),
        ('${buyer}','${hiddenShop}',now()),
        ('${outsider}','${shopA}',now());
      insert into public.listings values
        ('${product1}','${sellerA}','shop',now(),'available',now()-interval '3 days','Alpha Shirt','Clothing',1000,null),
        ('${product2}','${sellerA}','shop',now(),'available',now()-interval '2 days','Zeta Shirt','Clothing',3000,null),
        ('${product3}','${sellerB}','shop',now(),'available',now()-interval '1 day','Beta Gadget','Electronics',2000,null),
        ('${productArchived}','${sellerA}','shop',now(),'available',now(),'Archived Shirt','Clothing',4000,now()),
        ('${productHidden}','${hiddenOwner}','shop',now(),'available',now(),'Secret Item','Electronics',5000,null);
      insert into public.listing_favorites values
        ('${buyer}','${product1}'),('${buyer}','${product2}'),('${buyer}','${product3}'),
        ('${buyer}','${productArchived}'),('${buyer}','${productHidden}'),
        ('${outsider}','${product1}');
    `)
    const runRPC = (name, query, actor = buyer) => {
      const jwt = actor
        ? `select set_config('request.jwt.claim.sub','${actor}',false) \\gset`
        : ''
      const q = JSON.stringify(query).replace(/'/g, "''")
      const statement = `${jwt}\nselect public.${name}('${q}'::jsonb);`
      const result = sql(statement)
      return JSON.parse(result.stdout.trim())
    }
    const denied = (name, query) => {
      const q = JSON.stringify(query).replace(/'/g, "''")
      const r = sql(`select public.${name}('${q}'::jsonb);`, true)
      assert.notEqual(r.status, 0, 'Unauthenticated call must fail')
      assert.match(r.stderr, /Verified account required/)
    }
    const shops = 'marketplace_favorite_shops'
    const products = 'marketplace_favorite_shop_products'
    const ids = (items, field = 'id') => items.map((x) => x[field])
    const list = runRPC(shops, { pageSize: 1 })
    assert.deepEqual(ids(list.shops), [shopB], 'newest eligible shop first')
    assert.equal(list.hasNextPage, true)
    assert.deepEqual(ids(runRPC(shops, { page: 2, pageSize: 1 }).shops), [
      shopA,
    ])
    assert.equal(runRPC(shops, { page: 2, pageSize: 1 }).hasNextPage, false)
    assert.deepEqual(ids(runRPC(shops, { sort: 'name' }).shops), [shopB, shopA])
    assert.deepEqual(ids(runRPC(shops, { search: 'zEtA' }).shops), [shopA])
    assert.deepEqual(
      ids(runRPC(shops, { category: 'Fashion & Accessories' }).shops),
      [shopA],
      'legacy category translation'
    )
    assert.deepEqual(
      ids(runRPC(shops, { category: 'Tech & Electronics' }).shops),
      [shopB]
    )
    assert.deepEqual(
      ids(runRPC(shops, {}, outsider).shops),
      [shopA],
      'account isolation shops'
    )
    denied(shops, {})
    let p = runRPC(products, { pageSize: 1 })
    assert.deepEqual(ids(p.items.map((x) => x.listing)), [product3])
    assert.equal(p.hasNextPage, true)
    assert.deepEqual(
      ids(
        runRPC(products, { page: 2, pageSize: 1 }).items.map((x) => x.listing)
      ),
      [product2]
    )
    assert.deepEqual(
      ids(
        runRPC(products, { search: 'shirt', sort: 'name' }).items.map(
          (x) => x.listing
        )
      ),
      [product1, product2]
    )
    assert.deepEqual(
      ids(
        runRPC(products, { category: 'Electronics' }).items.map(
          (x) => x.listing
        )
      ),
      [product3]
    )
    assert.deepEqual(
      ids(runRPC(products, { sort: 'price-asc' }).items.map((x) => x.listing)),
      [product1, product3, product2]
    )
    assert.deepEqual(
      ids(runRPC(products, { sort: 'price-desc' }).items.map((x) => x.listing)),
      [product2, product3, product1]
    )
    assert.deepEqual(
      ids(
        runRPC(products, {
          shopId: shopA,
          search: 'shirt',
          pageSize: 1,
        }).items.map((x) => x.listing)
      ),
      [product2]
    )
    assert.equal(
      runRPC(products, { shopId: shopA, search: 'shirt', pageSize: 1 })
        .hasNextPage,
      true
    )
    assert.deepEqual(
      ids(
        runRPC(products, {
          page: 2,
          pageSize: 1,
          shopId: shopA,
          search: 'shirt',
        }).items.map((x) => x.listing)
      ),
      [product1]
    )
    assert.equal(
      runRPC(products, {}).shops.length,
      2,
      'filter Shop options exclude hidden'
    )
    assert.deepEqual(
      ids(runRPC(products, {}, outsider).items.map((x) => x.listing)),
      [product1],
      'account isolation products'
    )
    denied(products, {})
    for (const [name, query] of [
      [shops, { sort: 'invalid' }],
      [shops, { search: 42 }],
      [products, { sort: 'invalid' }],
      [products, { shopId: 'invalid' }],
    ]) {
      const q = JSON.stringify(query).replace(/'/g, "''")
      const r = sql(
        `select set_config('request.jwt.claim.sub','${buyer}',false) \\gset\nselect public.${name}('${q}'::jsonb);`,
        true
      )
      assert.notEqual(
        r.status,
        0,
        `${name} must reject ${JSON.stringify(query)}`
      )
    }
    console.log(
      'PASS isolated Favorites filters: Shops + Products, search/category/sort, paging, user isolation, hidden/archived protection'
    )
  } finally {
    if (started) exec('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

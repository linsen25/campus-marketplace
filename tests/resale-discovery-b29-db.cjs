// B29-A isolated PostgreSQL qualification. Loopback only; no Supabase network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const binary = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function run(name, args, input) {
  const result = spawnSync(binary(name), args, {
    input,
    env: environment,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000,
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}),
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return (result.stdout || '').trim()
}
function planSummary(plan) {
  const totals = { rows: 0, removed: 0, hits: 0, reads: 0 }
  const nodes = new Set()
  const indexes = new Set()
  const visit = (node) => {
    nodes.add(node['Node Type'])
    if (node['Index Name']) indexes.add(node['Index Name'])
    totals.rows +=
      Number(node['Actual Rows'] || 0) * Number(node['Actual Loops'] || 1)
    totals.removed +=
      Number(node['Rows Removed by Filter'] || 0) *
      Number(node['Actual Loops'] || 1)
    totals.hits += Number(node['Shared Hit Blocks'] || 0)
    totals.reads += Number(node['Shared Read Blocks'] || 0)
    ;(node.Plans || []).forEach(visit)
  }
  visit(plan.Plan)
  return {
    ms: Number(plan['Execution Time'].toFixed(3)),
    root: plan.Plan['Node Type'],
    rowsVisited: totals.rows + totals.removed,
    sharedHits: totals.hits,
    sharedReads: totals.reads,
    nodes: [...nodes],
    indexes: [...indexes],
  }
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-b29-db-'))
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
    'b29_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'b29_test',
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
      create role anon; create role authenticated;
      create schema extensions; create extension pgcrypto;
      grant usage on schema public to anon,authenticated;
      create table public.listings(
        id uuid primary key, seller_id uuid not null, title text not null,
        description text not null, price_cents bigint not null, currency text not null default 'CAD',
        category text not null, subcategory text not null, condition text,
        pickup_area text, status text not null, created_at timestamptz not null,
        updated_at timestamptz not null, published_at timestamptz,
        listing_channel text not null,
        search_text text generated always as
          (title||' '||description||' '||coalesce(pickup_area,'')||' '||category||' '||subcategory) stored
      );
      create table public.listing_favorites(
        user_id uuid not null, listing_id uuid not null references public.listings(id),
        created_at timestamptz not null default now(), primary key(user_id,listing_id)
      );
      alter table public.listings enable row level security;
      revoke all on public.listings from anon,authenticated;
      grant select on public.listings to anon,authenticated;
      create policy listings_public_read on public.listings for select using(
       listing_channel='resale' and published_at is not null and status='available');
      create index listings_public_channel_newest
        on public.listings(listing_channel,created_at desc,id)
        where published_at is not null and status='available';
      insert into public.listings
      select md5(g::text)::uuid,
        md5(('seller'||(g%1000))::text)::uuid,
        case when g%997=0 then '百分比 100% monitor_'||g when g%43=0 then 'Gaming monitor '||g else 'Campus item '||g end,
        case when g%149=0 then 'Wireless monitor for study' else 'Useful student listing '||g end,
        (g%50000)::bigint,'CAD',
        (array['Electronics','Home & Dorm','Textbooks & School','Clothing & Accessories','Sports & Outdoors','Bikes & Mobility','Games & Hobbies','Other'])[(g%8)+1],
        (array['Monitors','Furniture','Textbooks','Shoes','Fitness','Bikes','Games','Other'])[(g%8)+1],
        (array['new','like-new','good','fair'])[(g%4)+1],
        (array['Campus','North London','Downtown','West London',null])[(g%5)+1],
        case when g%19=0 then 'sold' when g%23=0 then 'reserved' else 'available' end,
        timestamptz '2026-01-01 00:00:00+00'+((g%30000)||' seconds')::interval,
        now(),case when g%17=0 then null else now() end,
        case when g%7=0 then 'shop' else 'resale' end
      from generate_series(1,120000) g;
      insert into public.listing_favorites(user_id,listing_id)
      select '11111111-1111-4111-8111-111111111111',id from public.listings
      where listing_channel='resale' and published_at is not null and status='available' and price_cents%31=0;
      analyze public.listings; analyze public.listing_favorites;
    `)
    const explain = (query) =>
      planSummary(
        JSON.parse(sql(`explain(analyze,buffers,format json) ${query}`))[0]
      )
    const predicate =
      "published_at is not null and status='available' and listing_channel='resale'"
    const baseline = {
      newest: explain(
        `select id from listings where ${predicate} order by created_at desc,id limit 20`
      ),
      priceLow: explain(
        `select id from listings where ${predicate} order by price_cents,created_at desc,id limit 20`
      ),
      priceHigh: explain(
        `select id from listings where ${predicate} order by price_cents desc,created_at desc,id limit 20`
      ),
      category: explain(
        `select id from listings where ${predicate} and category='Electronics' and subcategory='Monitors' order by created_at desc,id limit 20`
      ),
      conditionPickup: explain(
        `select id from listings where ${predicate} and condition='good' and pickup_area='Downtown' order by created_at desc,id limit 20`
      ),
      priceRange: explain(
        `select id from listings where ${predicate} and price_cents between 12000 and 12100 order by created_at desc,id limit 20`
      ),
      search: explain(
        `select id from listings where ${predicate} and search_text ilike '%monitor%' order by created_at desc,id limit 20`
      ),
      combined: explain(
        `select id from listings where ${predicate} and category='Electronics' and condition='new' and pickup_area='Campus' and price_cents between 1000 and 30000 and search_text ilike '%monitor%' order by price_cents,created_at desc,id limit 20`
      ),
      deep: explain(
        `select id from listings where ${predicate} order by created_at desc,id offset 50000 limit 20`
      ),
      empty: explain(
        `select id from listings where ${predicate} and category='Missing' order by created_at desc,id limit 20`
      ),
      sparse: explain(
        `select id from listings where ${predicate} and search_text ilike '%100\\% monitor\\_%' escape '\\' order by created_at desc,id limit 20`
      ),
      favorites: explain(
        `select l.id from listing_favorites f join listings l on l.id=f.listing_id where f.user_id='11111111-1111-4111-8111-111111111111' and ${predicate
          .replaceAll('published_at', 'l.published_at')
          .replaceAll('status=', 'l.status=')
          .replaceAll(
            'listing_channel=',
            'l.listing_channel='
          )} order by l.created_at desc,l.id limit 20`
      ),
    }
    console.log('B29_BASELINE ' + JSON.stringify({ rows: 120000, baseline }))
    if (process.env.B29_BASELINE_ONLY === '1') return
    const migration = fs.readFileSync(
      'supabase/migrations/20261024012808_resale_discovery_query.sql',
      'utf8'
    )
    sql(migration)
    sql('analyze public.listings;')
    const optimized = {
      newest: explain(
        `select id from listings where ${predicate} order by created_at desc,id limit 20`
      ),
      priceLow: explain(
        `select id from listings where ${predicate} order by price_cents,created_at desc,id limit 20`
      ),
      priceHigh: explain(
        `select id from listings where ${predicate} order by price_cents desc,created_at desc,id limit 20`
      ),
      search: explain(
        `select id from listings where ${predicate} and search_text ilike '%monitor%' order by created_at desc,id limit 20`
      ),
      category: explain(
        `select id from listings where ${predicate} and category='Electronics' and subcategory='Monitors' order by created_at desc,id limit 20`
      ),
      empty: explain(
        `select id from listings where ${predicate} and category='Missing' order by created_at desc,id limit 20`
      ),
      sparse: explain(
        `select id from listings where ${predicate} and search_text ilike '%100\\% monitor\\_%' escape '\\' order by created_at desc,id limit 20`
      ),
      combined: explain(
        `select id from listings where ${predicate} and category='Electronics' and condition='new' and pickup_area='Campus' and price_cents between 1000 and 30000 and search_text ilike '%monitor%' order by price_cents,created_at desc,id limit 20`
      ),
      deep: explain(
        `select id from listings where ${predicate} order by created_at desc,id offset 50000 limit 20`
      ),
    }
    assert(optimized.priceLow.indexes.includes('listings_resale_price_low'))
    assert(optimized.priceHigh.indexes.includes('listings_resale_price_high'))
    assert(
      optimized.category.indexes.includes('listings_resale_category_newest')
    )
    assert(optimized.empty.indexes.includes('listings_resale_category_newest'))
    assert(optimized.sparse.indexes.includes('listings_resale_search_trgm'))
    const browse = (values) =>
      JSON.parse(
        sql(
          `set role anon; select public.marketplace_browse_resale(${values}); reset role;`
        )
          .split('\n')
          .find((line) => line.startsWith('{'))
      )
    const first = browse(
      "' monitor ',null,null,null,null,null,null,'newest',0,20"
    )
    assert.equal(first.ids.length, 20)
    assert(first.total > first.ids.length)
    assert.equal(new Set(first.ids).size, first.ids.length)
    const second = browse(
      "' monitor ',null,null,null,null,null,null,'newest',20,20"
    )
    assert.equal(
      new Set([...first.ids, ...second.ids]).size,
      first.ids.length + second.ids.length,
      'Stable ID tie-breaks must keep unchanged adjacent pages disjoint.'
    )
    sql(`
      insert into public.listings(
       id,seller_id,title,description,price_cents,category,subcategory,condition,
       pickup_area,status,created_at,updated_at,published_at,listing_channel)
      values(
       '29999999-1111-4111-8111-111111111111','29999999-9999-4999-8999-999999999999',
       'Monitor concurrent insert','Bounded mutation fixture',1200,'Electronics','Monitors','good',
       'Campus','available','2030-01-01',now(),now(),'resale');
    `)
    const afterInsert = browse(
      "' monitor ',null,null,null,null,null,null,'newest',0,20"
    )
    assert.equal(afterInsert.total, first.total + 1)
    assert.equal(afterInsert.ids[0], '29999999-1111-4111-8111-111111111111')
    assert.equal(new Set(afterInsert.ids).size, afterInsert.ids.length)
    sql(
      "delete from public.listings where id='29999999-1111-4111-8111-111111111111'"
    )
    const afterDelete = browse(
      "' monitor ',null,null,null,null,null,null,'newest',0,20"
    )
    assert.equal(afterDelete.total, first.total)
    assert.deepEqual(afterDelete.ids, first.ids)
    assert.equal(
      sql(
        "select public.marketplace_resale_search_rank('Demonitorized','','','','monitor') is null"
      ),
      't'
    )
    assert.equal(
      sql(
        "select public.marketplace_resale_search_rank('Monitor stand','','','','MON')"
      ),
      '1'
    )
    const literal = browse(
      "'100% monitor_',null,null,null,null,null,null,'newest',0,20"
    )
    assert(literal.total > 0)
    sql(`
      insert into public.listings(
       id,seller_id,title,description,price_cents,category,subcategory,condition,
       pickup_area,status,created_at,updated_at,published_at,listing_channel)
      values(
       '29999999-2222-4222-8222-222222222222','29999999-9999-4999-8999-999999999999',
       '校园书桌','Unicode and path \\ fixture',2500,'Home & Dorm','Furniture','good',
       'Campus','available','2029-01-01',now(),now(),'resale');
    `)
    const unicode = browse("'书桌',null,null,null,null,null,null,'newest',0,20")
    assert.deepEqual(unicode.ids, ['29999999-2222-4222-8222-222222222222'])
    const backslash = browse(
      "E'path \\\\',null,null,null,null,null,null,'newest',0,20"
    )
    assert.deepEqual(backslash.ids, ['29999999-2222-4222-8222-222222222222'])
    const emptyPage = browse(
      "null,'Electronics','Monitors',null,null,null,null,'newest',999999,20"
    )
    assert.equal(emptyPage.ids.length, 0)
    assert(emptyPage.total > 0)
    assert.equal(
      sql(
        "set role anon; select count(*) from public.listings where listing_channel='shop' or published_at is null or status<>'available'; reset role;"
      )
        .split(/\r?\n/)
        .find((line) => /^\d+$/.test(line)),
      '0'
    )
    assert.equal(
      sql(
        "select has_function_privilege('anon','public.marketplace_browse_resale(text,text,text,text,text,bigint,bigint,text,bigint,integer)','execute')"
      ),
      't'
    )
    assert.equal(
      sql("select has_table_privilege('anon','public.listings','insert')"),
      'f'
    )
    assert.equal(
      sql(
        "select has_table_privilege('anon','public.listing_favorites','select')"
      ),
      'f'
    )
    console.log('B29_OPTIMIZED ' + JSON.stringify({ rows: 120000, optimized }))
    console.log(
      `PASS B29 database: ${first.total} ranked monitor matches; literal wildcard escaping; ` +
        'public RLS isolation; stable bounded page; price/category/trigram indexes; empty deep page total.'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

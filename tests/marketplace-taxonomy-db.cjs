/* In-memory PostgreSQL only. Never connects to Supabase. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const source = fs.readFileSync('tests/marketplace-security.cjs', 'utf8')
const bootstrap = source.match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
const base = fs.readFileSync(
  'supabase/migrations/202609290001_marketplace.sql',
  'utf8'
)
const usernames = fs.readFileSync(
  'supabase/migrations/202610030001_marketplace_usernames.sql',
  'utf8'
)
const migration = fs.readFileSync(
  'supabase/migrations/202610040001_marketplace_taxonomy.sql',
  'utf8'
)
const moduleOutput = { exports: {} }
new Function(
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/market-taxonomy.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(moduleOutput, moduleOutput.exports)
const { marketTaxonomy } = moduleOutput.exports
const sqlPairs = Object.fromEntries(
  Array.from(
    migration.matchAll(/category = '([^']+)' and subcategory in \(([^)]+)\)/g),
    (match) => [
      match[1],
      Array.from(match[2].matchAll(/'([^']+)'/g), (child) => child[1]),
    ]
  )
)
assert.deepEqual(sqlPairs, marketTaxonomy)
const owner = '11111111-1111-4111-8111-111111111111'
async function main() {
  let db = new PGlite()
  try {
    await db.exec(bootstrap)
    await db.exec(base)
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())',
      [owner, 'owner@uwo.ca']
    )
    await db.query(
      "insert into public.listings(seller_id,title,price_cents,category,pickup_area) values ($1,'Do not guess',0,'free','Campus')",
      [owner]
    )
    await assert.rejects(
      db.exec(migration),
      /migration aborted: listings exist/
    )
    await db.exec('rollback')
    assert.equal(
      (await db.query('select category from public.listings')).rows[0].category,
      'free'
    )
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='listings' and column_name='subcategory'"
        )
      ).rows[0].count,
      0
    )
    console.log(
      'PASS migration safety: legacy row causes explicit abort; rollback preserves row and old schema'
    )
  } finally {
    await db.close()
  }
  db = new PGlite()
  try {
    await db.exec(bootstrap)
    await db.exec(base)
    await db.exec(usernames)
    await db.exec(migration)
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),\'{"username":"Owner"}\')',
      [owner, 'owner@uwo.ca']
    )
    const columns = (
      await db.query(
        "select column_name,is_nullable,data_type from information_schema.columns where table_schema='public' and table_name='listings' and column_name in ('category','subcategory')"
      )
    ).rows
    assert(
      columns.every((c) => c.is_nullable === 'NO' && c.data_type === 'text')
    )
    assert.equal(columns.length, 2)
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from pg_constraint where conrelid='public.listings'::regclass and conname='listings_category_check'"
        )
      ).rows[0].count,
      0
    )
    const insert =
      "insert into public.listings(seller_id,title,price_cents,category,subcategory,pickup_area) values ($1,'Item',0,$2,$3,'Campus') returning id,status,search_text"
    let first,
      valid = 0,
      invalid = 0
    for (const [category, children] of Object.entries(marketTaxonomy)) {
      for (const subcategory of Object.values(marketTaxonomy).flat()) {
        if (children.includes(subcategory)) {
          const result = (
            await db.query(insert, [owner, category, subcategory])
          ).rows[0]
          first ||= result
          assert.equal(result.status, 'available')
          assert(
            result.search_text.includes(category) &&
              result.search_text.includes(subcategory)
          )
          valid++
        } else {
          await assert.rejects(
            db.query(insert, [owner, category, subcategory]),
            (e) => e.code === '23514'
          )
          invalid++
        }
      }
    }
    assert.equal(valid, 45)
    assert.equal(invalid, 315)
    for (const category of [
      'furniture',
      'electronics',
      'books',
      'clothing',
      'home-kitchen',
      'free',
      'sports-hobbies',
      'other',
    ])
      await assert.rejects(
        db.query(insert, [owner, category, 'Other']),
        (e) => e.code === '23514'
      )
    await assert.rejects(
      db.query(insert, [owner, 'Electronics', null]),
      (e) => e.code === '23502'
    )
    await assert.rejects(
      db.query(
        "update public.listings set category='Other',subcategory='Other' where id=$1",
        [first.id]
      ),
      /cannot be changed/
    )
    await assert.rejects(
      db.query("update public.listings set subcategory='Cameras' where id=$1", [
        first.id,
      ]),
      /cannot be changed/
    )
    await db.query(
      "update public.listings set title='Edited',category=category,subcategory=subcategory,status='sold' where id=$1",
      [first.id]
    )
    assert.equal(
      (
        await db.query('select status from public.listings where id=$1', [
          first.id,
        ])
      ).rows[0].status,
      'sold'
    )
    await assert.rejects(
      db.query("update public.listings set status='active' where id=$1", [
        first.id,
      ]),
      (e) => e.code === '23514'
    )
    console.log(
      'PASS actual local migrations: complete base/username/taxonomy chain, 45 valid/315 invalid pairs, legacy/null rejection, NOT NULL text, old CHECK removal, immutable privileged edits, searchable pairs and available/sold status'
    )
  } finally {
    await db.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

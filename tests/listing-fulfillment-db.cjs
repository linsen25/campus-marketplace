const fs = require('node:fs'),
  assert = require('node:assert/strict')
const {
  PGlite,
} = require('./artifacts/checkpoint-db-runtime/node_modules/@electric-sql/pglite')
async function run() {
  const db = new PGlite()
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role;create schema marketplace_private;create table public.listings(id int primary key,status text default 'available',title text,description text,category text,subcategory text,pickup_area text not null check(length(btrim(pickup_area)) between 1 and 120),search_text text generated always as(title||' '||description||' '||pickup_area||' '||category||' '||subcategory)stored);insert into public.listings values(1,'available','Old','Desc','Other','Other','Near campus');"
    )
    const before = (await db.query('select * from public.listings')).rows[0]
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610150002_listing_fulfillment_defaults.sql',
        'utf8'
      )
    )
    const after = (await db.query('select * from public.listings')).rows[0]
    delete after.estimated_delivery_fee_cents
    assert.deepEqual(after, before)
    await db.exec(
      "insert into public.listings(id,title,description,category,subcategory)values(2,'New','Desc','Other','Other');"
    )
    const row = (
      await db.query(
        'select pickup_area,estimated_delivery_fee_cents,search_text from public.listings where id=2'
      )
    ).rows[0]
    assert.equal(row.pickup_area, null)
    assert.equal(Number(row.estimated_delivery_fee_cents), 0)
    assert(row.search_text.includes('New'))
    await db.exec(
      'update public.listings set estimated_delivery_fee_cents=1050 where id=2'
    )
    assert.equal(
      Number(
        (
          await db.query(
            'select estimated_delivery_fee_cents from public.listings where id=2'
          )
        ).rows[0].estimated_delivery_fee_cents
      ),
      1050
    )
    for (const n of [-1, '9007199254740992'])
      await assert.rejects(
        db.exec(
          'update public.listings set estimated_delivery_fee_cents=' +
            n +
            ' where id=2'
        )
      )
    await db.exec("update public.listings set status='sold' where id=2")
    await assert.rejects(
      db.exec(
        'update public.listings set estimated_delivery_fee_cents=2000 where id=2'
      )
    )
    console.log(
      'PASS actual additive migration: legacy rows/search unchanged, nullable pickup, zero/default/custom/invalid estimate, search with NULL legacy field, sold guard'
    )
  } finally {
    await db.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')

async function main() {
  const db = new PGlite()
  let checks = 0
  const check = (value) => {
    assert(value)
    checks++
  }
  const reject = async (operation) => {
    await assert.rejects(operation)
    checks++
  }
  try {
    const bootstrap = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    await db.exec(bootstrap)
    for (const name of [
      '202609290001_marketplace',
      '202610030001_marketplace_usernames',
      '202610040001_marketplace_taxonomy',
    ])
      await db.exec(fs.readFileSync(`supabase/migrations/${name}.sql`, 'utf8'))
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    const c = '33333333-3333-4333-8333-333333333333'
    for (const [id, username] of [
      [a, 'Seller'],
      [b, 'Buyer'],
      [c, 'Third'],
    ])
      await db.query(
        `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),jsonb_build_object('username',$3::text))`,
        [id, `${username}@uwo.ca`, username]
      )
    const as = (id, sql, params = []) =>
      db.transaction(async (tx) => {
        await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
          id || '',
        ])
        return tx.query(sql, params)
      })
    const old = (
      await as(
        a,
        `insert into public.listings(title,price_cents,category,subcategory,pickup_area) values ('Old',1,'Other','Other','On campus') returning id,created_at`
      )
    ).rows[0]
    const migration = fs.readFileSync(
      'supabase/migrations/202610050001_marketplace_publication_favorites.sql',
      'utf8'
    )
    // Unexpected image-less old rows must abort and roll back, never be invented/published.
    await assert.rejects(db.exec(migration), /existing listings require review/)
    await db.exec('rollback')
    check(
      !(
        await db.query(
          "select column_name from information_schema.columns where table_schema='public' and table_name='listings' and column_name='published_at'"
        )
      ).rows.length
    )
    const oldImage = (
      await as(
        a,
        'insert into public.listing_images(listing_id,slot) values ($1,1) returning id,path',
        [old.id]
      )
    ).rows[0]
    // Local Storage API stand-ins only; never connect to hosted Storage.
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values (\'listing-images\',$1,\'{"mimetype":"image/png","size":100}\')',
      [oldImage.path]
    )
    await as(a, 'update public.listing_images set ready=true where id=$1', [
      oldImage.id,
    ])
    await db.exec(migration)
    check(
      (
        await db.query(
          "select count(*)::int as n from pg_trigger where tgrelid='storage.objects'::regclass and not tgisinternal"
        )
      ).rows[0].n === 0
    )
    check(
      !(
        await db.query(
          "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='marketplace_private' and p.proname='protect_published_listing_storage'"
        )
      ).rows.length
    )
    check(
      (
        await db.query(
          'select published_at=created_at as backfilled from public.listings where id=$1',
          [old.id]
        )
      ).rows[0].backfilled
    )
    const create = async (count = 1) =>
      (
        await as(
          a,
          `insert into public.listings(title,price_cents,category,subcategory,pickup_area,expected_image_count) values ('New',100,'Electronics','Cameras','Near campus',$1) returning id,published_at`,
          [count]
        )
      ).rows[0]
    const finalize = (id) =>
      as(a, 'select public.marketplace_finalize_listing($1)', [id])
    await reject(create(0))
    await reject(create(7))
    const partial = await create(2)
    check(partial.published_at === null)
    check(
      !(
        await as(null, 'select id from public.listings where id=$1', [
          partial.id,
        ])
      ).rows.length
    )
    check(
      !(await as(b, 'select id from public.listings where id=$1', [partial.id]))
        .rows.length
    )
    check(
      (await as(a, 'select id from public.listings where id=$1', [partial.id]))
        .rows.length === 1
    )
    await reject(finalize(partial.id))
    await reject(
      as(b, 'select public.marketplace_finalize_listing($1)', [partial.id])
    )
    await reject(
      as(null, 'select public.marketplace_finalize_listing($1)', [partial.id])
    )
    await reject(
      as(a, 'update public.listings set published_at=now() where id=$1', [
        partial.id,
      ])
    )
    await reject(
      as(a, 'update public.listings set expected_image_count=0 where id=$1', [
        partial.id,
      ])
    )
    await reject(
      db.query(
        'update public.listings set expected_image_count=0 where id=$1',
        [partial.id]
      )
    )
    const reserve = async (id, slot) =>
      (
        await as(
          a,
          'insert into public.listing_images(listing_id,slot) values ($1,$2) returning id,path',
          [id, slot]
        )
      ).rows[0]
    const upload = (image) =>
      as(
        a,
        `insert into storage.objects(bucket_id,name,metadata) values ('listing-images',$1,'{"mimetype":"image/png","size":100}')`,
        [image.path]
      )
    const ready = (image) =>
      as(a, 'update public.listing_images set ready=true where id=$1', [
        image.id,
      ])
    const first = await reserve(partial.id, 1)
    await reject(ready(first))
    await upload(first)
    await ready(first)
    await reject(finalize(partial.id))
    check(
      !(
        await as(
          null,
          'select id from public.listing_images where listing_id=$1',
          [partial.id]
        )
      ).rows.length
    )
    await reject(reserve(partial.id, 3))
    const second = await reserve(partial.id, 2)
    await upload(second)
    await ready(second)
    // DELETE policy denies even unpublished objects while metadata references them.
    check(
      !(
        await as(a, 'delete from storage.objects where name=$1 returning id', [
          second.path,
        ])
      ).rows.length
    )
    // Metadata-first removal obtains the parent lock; finalization then sees an incomplete set.
    await as(a, 'delete from public.listing_images where id=$1', [second.id])
    checks++
    await reject(finalize(partial.id))
    check(
      (
        await as(a, 'delete from storage.objects where name=$1 returning id', [
          second.path,
        ])
      ).rows.length === 1
    )
    const replacement = await reserve(partial.id, 2)
    await upload(replacement)
    await ready(replacement)
    await finalize(partial.id)
    check(
      (
        await as(null, 'select id from public.listings where id=$1', [
          partial.id,
        ])
      ).rows.length === 1
    )
    check(
      (
        await as(
          null,
          'select id from public.listing_images where listing_id=$1',
          [partial.id]
        )
      ).rows.length === 2
    )
    const stamp = (
      await db.query('select published_at from public.listings where id=$1', [
        partial.id,
      ])
    ).rows[0].published_at
    await finalize(partial.id)
    check(
      String(
        (
          await db.query(
            'select published_at from public.listings where id=$1',
            [partial.id]
          )
        ).rows[0].published_at
      ) === String(stamp)
    )
    for (const sql of [
      'update public.listing_images set ready=false where listing_id=$1',
      'delete from public.listing_images where listing_id=$1',
      'update public.listing_images set slot=3 where listing_id=$1',
    ])
      await reject(db.query(sql, [partial.id]))
    await reject(reserve(partial.id, 1))
    check(
      !(
        await as(a, 'delete from storage.objects where name=$1 returning id', [
          first.path,
        ])
      ).rows.length
    )
    // No authenticated overwrite/update permission; metadata lock is on listing_images only.
    check(
      !(
        await as(
          a,
          "update storage.objects set metadata='{}' where name=$1 returning id",
          [first.path]
        )
      ).rows.length
    )
    await reject(
      db.query('update public.listings set published_at=null where id=$1', [
        partial.id,
      ])
    )
    await reject(
      db.query(
        "update public.listings set category='Other',subcategory='Other' where id=$1",
        [partial.id]
      )
    )
    await reject(
      as(a, "update public.listings set subcategory='Monitors' where id=$1", [
        partial.id,
      ])
    )
    await as(
      a,
      "update public.listings set title='Edited',price_cents=200,description='Body',condition='good',pickup_area='On campus' where id=$1",
      [partial.id]
    )
    checks++
    // Currency has an existing UPDATE grant, but NOT NULL/CAD CHECK forbids changes.
    check(
      (
        await db.query(
          "select has_column_privilege('authenticated','public.listings','currency','UPDATE') as allowed"
        )
      ).rows[0].allowed
    )
    await reject(
      as(a, "update public.listings set currency='USD' where id=$1", [
        partial.id,
      ])
    )
    await reject(
      as(a, 'update public.listings set currency=null where id=$1', [
        partial.id,
      ])
    )
    await as(a, "update public.listings set currency='CAD' where id=$1", [
      partial.id,
    ])
    check(
      (
        await as(a, 'select currency from public.listings where id=$1', [
          partial.id,
        ])
      ).rows[0].currency === 'CAD'
    )
    // Published available content remains visible to anonymous and other users.
    check(
      (await as(b, 'select id from public.listings where id=$1', [partial.id]))
        .rows.length === 1
    )
    check(
      (
        await as(
          b,
          'select id from public.listing_images where listing_id=$1',
          [partial.id]
        )
      ).rows.length === 2
    )
    const unpublished = await create()
    const favorite = (id) =>
      as(
        b,
        'insert into public.listing_favorites(user_id,listing_id) values ($1,$2)',
        [b, id]
      )
    await favorite(partial.id)
    checks++
    await reject(favorite(partial.id))
    await reject(favorite(unpublished.id))
    await reject(
      as(
        a,
        'insert into public.listing_favorites(user_id,listing_id) values ($1,$2)',
        [a, partial.id]
      )
    )
    await reject(
      as(
        c,
        'insert into public.listing_favorites(user_id,listing_id) values ($1,$2)',
        [b, partial.id]
      )
    )
    check(
      (await as(b, 'select * from public.listing_favorites')).rows.length === 1
    )
    check(!(await as(c, 'select * from public.listing_favorites')).rows.length)
    await reject(as(null, 'select * from public.listing_favorites'))
    check(
      !(await as(c, 'delete from public.listing_favorites returning *')).rows
        .length
    )
    await as(a, "update public.listings set status='sold' where id=$1", [
      partial.id,
    ])
    // Sold content is private to its seller, including image metadata/history.
    for (const viewer of [null, b, c]) {
      check(
        !(
          await as(viewer, 'select id from public.listings where id=$1', [
            partial.id,
          ])
        ).rows.length
      )
      check(
        !(
          await as(
            viewer,
            'select id from public.listing_images where listing_id=$1',
            [partial.id]
          )
        ).rows.length
      )
    }
    check(
      (
        await as(a, 'select status from public.listings where id=$1', [
          partial.id,
        ])
      ).rows[0].status === 'sold'
    )
    check(
      (
        await as(
          a,
          'select id from public.listing_images where listing_id=$1',
          [partial.id]
        )
      ).rows.length === 2
    )
    check(
      (
        await as(
          a,
          "select id from public.listings where seller_id=$1 and published_at is not null and status='sold'",
          [a]
        )
      ).rows.length === 1
    )
    await reject(favorite(partial.id))
    await reject(
      as(a, "update public.listings set title='Sold edit' where id=$1", [
        partial.id,
      ])
    )
    check(
      (await as(b, 'select * from public.listing_favorites')).rows.length === 1
    )
    check(
      !(
        await as(
          b,
          "select l.id from public.listings l join public.listing_favorites f on f.listing_id=l.id where l.published_at is not null and l.status='available'"
        )
      ).rows.length
    )
    // Exact published predicates used by My Listings and Trends.
    check(
      (
        await as(
          a,
          'select id from public.listings where seller_id=$1 and published_at is not null',
          [a]
        )
      ).rows.length === 2
    )
    check(
      (
        await as(
          b,
          "select category from public.listings where published_at is not null and status='available'"
        )
      ).rows.length === 1
    )
    await as(b, 'delete from public.listing_favorites where listing_id=$1', [
      partial.id,
    ])
    checks++
    const clean = await create()
    const cleanImage = await reserve(clean.id, 1)
    await upload(cleanImage)
    await ready(cleanImage)
    await finalize(clean.id)
    await favorite(clean.id)
    await as(a, 'delete from public.listings where id=$1', [clean.id])
    check(!(await as(b, 'select * from public.listing_favorites')).rows.length)
    // Published listing deletion may cascade metadata; orphan Storage cleanup remains possible.
    await as(a, 'delete from public.listings where id=$1', [partial.id])
    await as(a, 'delete from storage.objects where name=$1', [first.path])
    checks++
    check(
      !(
        await db.query(
          'select * from public.listing_images where listing_id=$1',
          [partial.id]
        )
      ).rows.length
    )
    // The real metadata trigger and finalizer both lock the same parent row.
    for (const name of [
      'marketplace_private.protect_published_listing_images()',
      'public.marketplace_finalize_listing(uuid)',
    ]) {
      const definition = (
        await db.query(
          'select pg_get_functiondef($1::regprocedure) as source',
          [name]
        )
      ).rows[0].source
      check(/for update/i.test(definition))
    }
    const pending = await create(1)
    const pendingImage = await reserve(pending.id, 1)
    await upload(pendingImage)
    await ready(pendingImage)
    await as(a, 'delete from public.listing_images where id=$1', [
      pendingImage.id,
    ])
    checks++
    await as(
      a,
      'delete from public.listings where id=$1 and published_at is null',
      [pending.id]
    )
    checks++
    await as(a, 'delete from storage.objects where name=$1', [
      pendingImage.path,
    ])
    checks++
    const six = await create(6)
    for (let slot = 1; slot <= 6; slot++) {
      const image = await reserve(six.id, slot)
      await upload(image)
      await ready(image)
    }
    await finalize(six.id)
    checks++
    await reject(reserve(six.id, 6))
    // Deleting the entire listing already removed its metadata: orphan cleanup is eligible.
    check(
      (
        await as(a, 'delete from storage.objects where name=$1 returning id', [
          cleanImage.path,
        ])
      ).rows.length === 1
    )
    check(
      (
        await db.query(
          "select has_column_privilege('authenticated','public.listings','subcategory','INSERT') as insert_ok,has_column_privilege('authenticated','public.listings','published_at','UPDATE') as update_bad"
        )
      ).rows[0].insert_ok
    )
    check(
      !(
        await db.query(
          "select has_column_privilege('authenticated','public.listings','published_at','UPDATE') as bad"
        )
      ).rows[0].bad
    )
    console.log(
      `PASS: ${checks} in-memory publication/favorites/storage/RLS assertions; database discarded.`
    )
  } finally {
    await db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

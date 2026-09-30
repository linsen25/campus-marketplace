/* Local PostgreSQL contract tests. PGlite is installed separately, not shipped with the app. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')

async function main() {
  const db = new PGlite()
  try {
    // Only Supabase-owned schemas are stand-ins; run the real marketplace migration.
    await db.exec(`
      create role anon; create role authenticated; create role supabase_auth_admin;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
    `)
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202609290001_marketplace.sql',
        'utf8'
      )
    )
    const owner = '11111111-1111-4111-8111-111111111111'
    const other = '22222222-2222-4222-8222-222222222222'
    const unverified = '33333333-3333-4333-8333-333333333333'
    for (const [id, email, confirmed] of [
      [owner, 'owner@uwo.ca', true],
      [other, 'other@uwo.ca', true],
      [unverified, 'unverified@uwo.ca', false],
    ]) {
      await db.query(
        `insert into auth.users(id,email,email_confirmed_at) values ($1,$2,case when $3 then now() else null end)`,
        [id, email, confirmed]
      )
    }
    await assert.rejects(
      db.query(
        `insert into auth.users(id,email) values (gen_random_uuid(),'fake@uwo.ca.evil.test')`
      )
    )
    await assert.rejects(
      db.query(
        `update auth.users set email='outside@example.com' where id=$1`,
        [owner]
      )
    )
    const as = (id, sql, params = []) =>
      db.transaction(async (tx) => {
        await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
          id || '',
        ])
        return tx.query(sql, params)
      })
    const insert = `insert into public.listings(title,description,price_cents,category,pickup_area) values ('Desk','Study desk',1250,'furniture','On campus') returning id,seller_id`
    await assert.rejects(as(null, insert))
    await assert.rejects(as(unverified, insert))
    const listing = (await as(owner, insert)).rows[0]
    assert.equal(listing.seller_id, owner)
    assert.equal(
      (await as(null, 'select * from public.listings')).rows.length,
      1
    )
    assert.equal(
      (
        await as(
          other,
          `update public.listings set title='stolen' where id=$1 returning id`,
          [listing.id]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          other,
          `update public.listings set status='sold' where id=$1 returning id`,
          [listing.id]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          other,
          `delete from public.listings where id=$1 returning id`,
          [listing.id]
        )
      ).rows.length,
      0
    )
    await assert.rejects(
      as(owner, `update public.listings set seller_id=$1 where id=$2`, [
        other,
        listing.id,
      ])
    )
    await assert.rejects(
      as(
        owner,
        `insert into public.listings(seller_id,title,price_cents,category,pickup_area) values ($1,'Spoof',0,'free','Campus')`,
        [other]
      )
    )
    for (const sql of [
      'price_cents=-1',
      "currency='USD'",
      "category='shoes'",
      "condition='used'",
      "title=''",
      "pickup_area=''",
      "status='reserved'",
    ]) {
      await assert.rejects(
        as(owner, `update public.listings set ${sql} where id=$1`, [listing.id])
      )
    }
    await as(
      owner,
      `update public.listings set title='Edited desk',price_cents=0,condition=null where id=$1`,
      [listing.id]
    )
    const reservation = (
      await as(
        owner,
        `insert into public.listing_images(listing_id,slot) values ($1,1) returning id,path`,
        [listing.id]
      )
    ).rows[0]
    await assert.rejects(
      as(
        other,
        `insert into public.listing_images(listing_id,slot) values ($1,2)`,
        [listing.id]
      )
    )
    await assert.rejects(
      as(owner, `update public.listing_images set ready=true where id=$1`, [
        reservation.id,
      ])
    )
    await assert.rejects(
      as(
        owner,
        `insert into storage.objects(bucket_id,name) values ('listing-images','unreserved/path')`
      )
    )
    await assert.rejects(
      as(
        other,
        `insert into storage.objects(bucket_id,name) values ('listing-images',$1)`,
        [reservation.path]
      )
    )
    await as(
      owner,
      `insert into storage.objects(bucket_id,name,metadata) values ('listing-images',$1,'{"mimetype":"image/png","size":100}')`,
      [reservation.path]
    )
    await as(owner, `update public.listing_images set ready=true where id=$1`, [
      reservation.id,
    ])
    assert.equal(
      (await as(null, 'select * from public.listing_images')).rows.length,
      1
    )
    for (let slot = 2; slot <= 6; slot++)
      await as(
        owner,
        `insert into public.listing_images(listing_id,slot) values ($1,$2)`,
        [listing.id, slot]
      )
    await assert.rejects(
      as(
        owner,
        `insert into public.listing_images(listing_id,slot) values ($1,7)`,
        [listing.id]
      )
    )
    await assert.rejects(
      as(
        owner,
        `insert into public.listing_images(listing_id,slot) values ($1,1)`,
        [listing.id]
      )
    )
    assert.equal(
      (
        await as(
          other,
          `delete from storage.objects where name=$1 returning id`,
          [reservation.path]
        )
      ).rows.length,
      0
    )
    await as(owner, `update public.listings set status='sold' where id=$1`, [
      listing.id,
    ])
    assert.equal(
      (await as(null, `select * from public.listings where status='available'`))
        .rows.length,
      0
    )
    assert.equal(
      (
        await as(
          owner,
          `select * from public.listings where seller_id=auth.uid()`
        )
      ).rows[0].status,
      'sold'
    )
    assert.equal(
      (
        await as(
          other,
          `select * from public.listings where seller_id=auth.uid()`
        )
      ).rows.length,
      0
    )
    await as(owner, `delete from public.listings where id=$1`, [listing.id])
    assert.equal(
      (
        await as(null, `select * from public.listings where id=$1`, [
          listing.id,
        ])
      ).rows.length,
      0
    )
    assert.equal(
      (await as(owner, 'select * from public.listing_images')).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          owner,
          `delete from storage.objects where name=$1 returning id`,
          [reservation.path]
        )
      ).rows.length,
      1
    )
    const profile = (await as(null, 'select * from public.profiles limit 1'))
      .rows[0]
    assert(!('email' in profile))
    console.log(
      'PASS: migration; public reads; anonymous/unverified write denial; owner create/edit/sold/delete; cross-user denial; spoofed seller denial; constraints; My Listings scoping; image reservations, six-slot limit, publication, cleanup ownership; profile privacy.'
    )
  } finally {
    await db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

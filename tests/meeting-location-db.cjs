// Actual additive DDL and validators in local PostgreSQL/PGlite; no hosted access.
const fs = require('node:fs'),
  assert = require('node:assert/strict')
const { PGlite } = require(process.env.PGLITE_MODULE ||
  './artifacts/checkpoint-db-runtime/node_modules/@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema marketplace_private;create table public.listings(id int primary key,status text default 'available');`
    )
    const old = fs.readFileSync(
      'supabase/migrations/202610130002_delivery_area_economics.sql',
      'utf8'
    )
    await db.exec(
      old.slice(
        old.indexOf(
          'create function marketplace_private.normalize_delivery_area('
        ),
        old.indexOf(
          'create function marketplace_private.normalize_offer_terms('
        )
      )
    )
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610150001_meeting_location_references.sql',
        'utf8'
      )
    )
    await db.exec(
      `insert into public.listings(id)values(1);update public.listings set meeting_location='User wording',meeting_location_provider='google',meeting_place_id='fixture_1' where id=1;`
    )
    for (const sql of [
      `update public.listings set meeting_place_id=null where id=1`,
      `update public.listings set meeting_location='' where id=1`,
      `update public.listings set meeting_location_provider='other' where id=1`,
    ])
      await assert.rejects(db.exec(sql))
    await db.exec(`update public.listings set status='pending' where id=1`)
    await assert.rejects(
      db.exec(
        `update public.listings set meeting_location='Changed' where id=1`
      )
    )
    const terms = {
      item_amount_cents: 8000,
      fulfillment: 'on_campus',
      meetup_location: 'User wording',
      scheduled_at: new Date(
        Math.ceil((Date.now() + 86400000) / 900000) * 900000
      ).toISOString(),
      note: '',
    }
    const validate = (t) =>
      db.query(
        'select marketplace_private.validate_offer_terms($1::jsonb) valid',
        [JSON.stringify(t)]
      )
    assert.equal((await validate(terms)).rows[0].valid, true)
    assert.equal(
      (
        await validate({
          ...terms,
          meetup_location_provider: 'google',
          meetup_place_id: 'fixture_1',
        })
      ).rows[0].valid,
      true
    )
    for (const t of [
      { ...terms, meetup_place_id: 'fixture_1' },
      { ...terms, meetup_location_provider: 'google' },
      { ...terms, meetup_location_provider: 'google', meetup_place_id: 123456 },
      { ...terms, latitude: 1 },
    ])
      await assert.rejects(validate(t))
    const changed = await db.query(
      `select marketplace_private.offer_changed_fields($1::jsonb,$2::jsonb) fields`,
      [
        JSON.stringify({ ...terms, meetup_location: ' USER   wording ' }),
        JSON.stringify(terms),
      ]
    )
    assert.deepEqual(changed.rows[0].fields, [])
    console.log(
      'PASS actual Meeting additive migration, legacy Listing compatibility, label/reference constraints, state guard, free-text/Google V2 validators, forbidden raw data/coordinates, normalized Changed terms; local PostgreSQL only.'
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

const fs = require('node:fs'),
  assert = require('node:assert/strict')
const {
  PGlite,
} = require('./artifacts/checkpoint-db-runtime/node_modules/@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema marketplace_private;
 create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function marketplace_private.is_western_user() returns boolean language sql as $$select auth.uid() is not null$$;
 create table public.listings(id uuid primary key,seller_id uuid,status text,published_at timestamptz);
 create table public.orders(id uuid primary key,listing_origin_id uuid,seller_origin_id uuid,lifecycle_status text);
 create table public.transaction_events(order_id uuid,event_type text,created_at timestamptz);
 grant usage on schema public,auth,marketplace_private to anon,authenticated;
 `)
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610160003_account_activity.sql',
        'utf8'
      )
    )
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      visitor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      listing = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      event = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await db.exec(
      `insert into public.profiles values('${owner}');insert into auth.users values('${owner}'),('${visitor}');insert into public.listings values('${listing}','${owner}','available',null);update public.listings set published_at=clock_timestamp() where id='${listing}';update public.listings set published_at=published_at where id='${listing}';`
    )
    const count = async (kind) =>
      Number(
        (
          await db.query(
            'select count(*) n from marketplace_private.account_activity_events where kind=$1',
            [kind]
          )
        ).rows[0].n
      )
    assert.equal(await count('listing_published'), 1)
    await db.exec(
      `select set_config('request.jwt.claim.sub','${owner}',false);select public.marketplace_record_listing_view('${listing}','${event}');`
    )
    assert.equal(await count('view'), 0)
    await db.exec(
      `select set_config('request.jwt.claim.sub','${visitor}',false);select public.marketplace_record_listing_view('${listing}','${event}');select public.marketplace_record_listing_view('${listing}','${event}');`
    )
    assert.equal(await count('view'), 1)
    await db.exec(
      `select set_config('request.jwt.claim.sub','',false);select public.marketplace_record_listing_view('${listing}',gen_random_uuid());`
    )
    assert.equal(await count('view'), 2)
    await db.exec(
      `update public.listings set status='sold' where id='${listing}';update public.listings set status='sold' where id='${listing}';delete from public.listings where id='${listing}';`
    )
    assert.equal(await count('listing_sold'), 1)
    assert.equal(await count('listing_published'), 1)
    assert.equal(await count('view'), 2)
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('anon','marketplace_private.account_activity_events','SELECT') ok"
        )
      ).rows[0].ok,
      false
    )
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`)
    for (const period of ['1D', '7D', '30D']) {
      const response = (
        await db.query(
          'select public.marketplace_account_activity($1) result',
          [period]
        )
      ).rows[0].result
      assert.equal(
        response.points.length,
        period === '1D' ? 24 : parseInt(period)
      )
      assert.equal(
        response.points.reduce((n, p) => n + p.overall, 0),
        4
      )
      assert(response.points.some((p) => p.overall === 0))
    }
    await db.exec(
      `select set_config('request.jwt.claim.sub','${visitor}',false)`
    )
    assert(
      (
        await db.query(
          "select public.marketplace_account_activity('7D') result"
        )
      ).rows[0].result.points.every((p) => p.overall === 0)
    )
    for (const [anchor, hours] of [
      ['2026-03-09T12:00:00Z', 23],
      ['2026-11-02T12:00:00Z', 25],
    ]) {
      const bins = (
        await db.query(
          "select *,extract(epoch from(bucket_end-bucket_at))/3600 hours from marketplace_private.account_activity_buckets('7D',$1)",
          [anchor]
        )
      ).rows
      assert.equal(bins.length, 7)
      assert(bins.some((b) => Number(b.hours) === hours))
    }
    const fall = (
      await db.query(
        "select * from marketplace_private.account_activity_buckets('1D','2026-11-01T18:35:12Z')"
      )
    ).rows
    assert.equal(fall.length, 24)
    assert.equal(
      fall.filter((b) => b.bucket_label.startsWith('01:00')).length,
      2
    )
    assert.equal(new Set(fall.map((b) => b.bucket_label)).size, 24)
    assert(
      fall.some((b) => b.bucket_label.includes('UTC-04:00')) &&
        fall.some((b) => b.bucket_label.includes('UTC-05:00'))
    )
    console.log(
      'PASS Toronto: 24 real hourly buckets, 7/30 local days, explicit zeros, spring 23h/fall 25h days, repeated hour labels, own-only aggregates'
    )
    console.log(
      'PASS local PostgreSQL: additive migration, publication once, owner exclusion, authenticated/anonymous views, idempotency, Sold once, deleted Listing retention, private table grants'
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

const fs = require('node:fs'),
  assert = require('node:assert/strict')
const {
  PGlite,
} = require('./artifacts/checkpoint-db-runtime/node_modules/@electric-sql/pglite')
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema marketplace_private;create schema auth;
create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
create function marketplace_private.is_western_user() returns boolean language sql as $$select true$$;
create table public.listings(id uuid primary key default gen_random_uuid(),seller_id uuid default auth.uid(),title text,status text default 'available',published_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default '2000-01-01');
create function marketplace_private.assert_listing_images_complete(public.listings) returns void language sql as $$select$$;
alter table public.listings enable row level security;
grant usage on schema auth to authenticated;
grant select on public.listings to anon,authenticated;
grant insert(title),update(title) on public.listings to authenticated;
create policy listings_public_read on public.listings for select using(published_at is not null and status='available');
create policy listings_owner_insert on public.listings for insert to authenticated with check(seller_id=auth.uid());
insert into public.listings(title) values('Historical');`)
    const before = (await db.query('select * from public.listings')).rows[0]
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610160007_listing_channel_authority.sql',
        'utf8'
      )
    )
    const after = (await db.query('select * from public.listings')).rows[0]
    assert.equal(after.listing_channel, 'resale')
    delete after.listing_channel
    assert.deepEqual(after, before)
    for (const status of ['available', 'reserved', 'pending', 'sold']) {
      await db.exec(
        `insert into public.listings(title,status) values('Immutable ${status}','${status}')`
      )
      await assert.rejects(
        db.exec(
          `update public.listings set listing_channel='shop' where title='Immutable ${status}'`
        ),
        (e) => e.code === '23514' && /immutable/.test(e.message)
      )
    }
    await assert.rejects(
      db.exec(
        "insert into public.listings(title,listing_channel) values('Invalid','both')"
      ),
      (e) => e.code === '23514'
    )
    await db.exec(
      "insert into public.listings(title,listing_channel,published_at) values('Synthetic Shop','shop',now()),('Public Resale','resale',now())"
    )
    await db.exec('set role anon')
    assert.deepEqual(
      (await db.query('select title from public.listings')).rows.map(
        (r) => r.title
      ),
      ['Public Resale']
    )
    await db.exec('reset role;set role authenticated')
    await db.exec("insert into public.listings(title) values('Normal Create')")
    await assert.rejects(
      db.exec(
        "insert into public.listings(title,listing_channel) values('Forged','shop')"
      ),
      (e) => e.code === '42501'
    )
    await assert.rejects(
      db.exec("update public.listings set listing_channel='shop'"),
      (e) => e.code === '42501'
    )
    await db.exec('reset role')
    assert.equal(
      (
        await db.query(
          "select listing_channel from public.listings where title='Normal Create'"
        )
      ).rows[0].listing_channel,
      'resale'
    )
    const shop = (
      await db.query(
        "select id from public.listings where title='Synthetic Shop'"
      )
    ).rows[0].id
    await assert.rejects(
      db.query('select public.marketplace_finalize_listing($1)', [shop]),
      (e) => e.code === '42501' && /eligibility/.test(e.message)
    )
    console.log(
      'PASS exact migration in local PostgreSQL runtime: historical default/no row rewrite, immutable available/reserved/pending/sold, CHECK, no client channel INSERT/UPDATE, public RLS, Shop finalize denied'
    )
  } finally {
    await db.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

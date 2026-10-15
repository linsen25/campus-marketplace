// Explicit staging-only additive application and rollback synthetic qualification.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const { query, q, root, ref } = require('./order-master-staging-query.cjs')
const file = '202610150001_meeting_location_references.sql',
  version = '202610150001'
const source = fs.readFileSync('supabase/migrations/' + file, 'utf8'),
  hash = crypto.createHash('sha256').update(source).digest('hex')
const mode = process.argv[2]
assert(['dry-run', 'apply', 'verify', 'qualify'].includes(mode))
assert.equal(ref, 'pcaqxezdfxofysghssyo')
const receipt = path.join(root, 'meeting-places-dry-run.json')
const body = source.replace(/\bbegin;/, '').replace(/commit;\s*$/, '')
const fingerprint = () =>
  query(
    'begin read only;' +
      [
        'public.listings',
        'public.orders',
        'public.order_requests',
        'public.transaction_events',
        'public.conversations',
        'public.listing_favorites',
        'auth.users',
        'public.profiles',
        'storage.objects',
      ]
        .map(
          (table) =>
            `select ${q(
              table
            )} name,count(*) n,md5(coalesce(string_agg((to_jsonb(t)-array['meeting_location','meeting_location_provider','meeting_place_id'])::text,'' order by (to_jsonb(t)-array['meeting_location','meeting_location_provider','meeting_place_id'])::text),'')) hash from ${table} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
async function main() {
  const before = await fingerprint()
  const versions = await query(
    'begin read only;select version from supabase_migrations.schema_migrations;rollback;'
  )
  if (['dry-run', 'apply'].includes(mode)) {
    assert(
      !versions.some((x) => x.version === version),
      'Already applied; never rewrite applied SQL'
    )
    const pending = fs
      .readdirSync('supabase/migrations')
      .filter(
        (f) =>
          f.endsWith('.sql') &&
          !versions.some((x) => x.version === f.split('_')[0])
      )
      .sort()
    assert.deepEqual(pending, [file])
    if (mode === 'apply')
      assert.equal(JSON.parse(fs.readFileSync(receipt)).hash, hash)
    await query(
      `begin;set local lock_timeout='15s';${body}\n${
        mode === 'apply'
          ? `insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(
              version
            )},'meeting_location_references',array[${q(source)}]);commit;`
          : 'rollback;'
      }select true complete;`
    )
    if (mode === 'dry-run')
      fs.writeFileSync(receipt, JSON.stringify({ file, hash, ref }))
  } else {
    assert(
      versions.some((x) => x.version === version),
      'Migration not applied'
    )
    const stored = await query(
      `begin read only;select statements[1] source from supabase_migrations.schema_migrations where version=${q(
        version
      )};rollback;`
    )
    assert.equal(stored[0].source, source)
    const columns = await query(
      `begin read only;select column_name,is_nullable,has_column_privilege('authenticated','public.listings',column_name,'INSERT') ins,has_column_privilege('authenticated','public.listings',column_name,'UPDATE') upd,has_column_privilege('anon','public.listings',column_name,'UPDATE') anon from information_schema.columns where table_schema='public' and table_name='listings' and column_name in('meeting_location','meeting_location_provider','meeting_place_id');rollback;`
    )
    assert.equal(columns.length, 3)
    for (const c of columns) {
      assert.equal(c.is_nullable, 'YES')
      assert(c.ins && c.upd && !c.anon)
    }
    const functions = await query(
      `begin read only;select p.proname,p.prosrc,p.proconfig,p.provolatile,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='marketplace_private' and p.proname in('valid_meeting_reference','protect_listing_meeting','validate_offer_terms','offer_changed_fields');rollback;`
    )
    assert.equal(functions.length, 4)
    for (const f of functions) {
      assert.equal(f.anon, false)
      assert(f.proconfig.some((x) => x.startsWith('search_path=')))
      const match = source.match(
        new RegExp(
          'function marketplace_private\\.' +
            f.proname +
            '\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;',
          'i'
        )
      )
      assert(match)
      assert.equal(f.prosrc.trim(), match[1].trim())
    }
    if (mode === 'qualify') {
      const helpers = fs
        .readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
        .split('do $$declare terms jsonb;')[0]
      await query(`begin;${helpers}
do $$declare o public.orders;terms jsonb;frozen jsonb;listing_before jsonb;
begin
perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','meeting_fixture','meeting_payout','Test Bank','6789');
terms:=jsonb_build_object('item_amount_cents',8000,'fulfillment','on_campus','meetup_location','User-entered front entrance','meetup_location_provider','google','meetup_place_id','fixture_place_1','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','note','');
o:=pg_temp.bc_accept(terms,true);frozen:=o.terms_snapshot;
perform pg_temp.bc_assert(o.terms_snapshot->'terms'=terms,'accepted terms/reference frozen exactly');
perform pg_temp.bc_reject(format('update public.orders set terms_snapshot=%L::jsonb where id=%L',jsonb_set(frozen,'{terms,meetup_location}','"Forbidden rewrite"'),o.id),'42501');
perform pg_temp.bc_actor((select buyer from bc_people));perform public.marketplace_cancel_order(o.id,'buyer_changed_mind','Synthetic rollback qualification',gen_random_uuid());
perform pg_temp.bc_actor((select seller from bc_people));
update public.listings set meeting_location='New user default',meeting_location_provider='google',meeting_place_id='fixture_place_2' where id=o.listing_id;
perform pg_temp.bc_assert((select terms_snapshot=frozen from public.orders where id=o.id),'Listing edit does not change Order terms');
perform pg_temp.bc_assert((select offer_terms=terms from public.order_requests where id=o.request_id),'Listing edit does not change historical Offer');
perform pg_temp.bc_assert(not (frozen::text like '%formattedAddress%' or frozen::text like '%displayName%' or frozen::text like '%sessionToken%'),'no provider response content frozen');
perform pg_temp.bc_assert((select pickup_area from public.listings where id=o.listing_id) in('On campus','Near campus','Other'),'Place classification independent');
o:=pg_temp.bc_accept(terms-array['meetup_location_provider','meetup_place_id'],true);
perform pg_temp.bc_assert(o.terms_snapshot->'terms'->>'meetup_location'='User-entered front entrance','free-text Offer/Order accepted');
perform pg_temp.bc_reject(format('select marketplace_private.validate_offer_terms(%L::jsonb)',terms-'meetup_place_id'),'23514');
perform pg_temp.bc_assert(marketplace_private.offer_changed_fields(terms,jsonb_set(terms,'{meetup_location}','" USER-entered   front entrance "'))='[]'::jsonb,'normalized word identity');
perform pg_temp.bc_assert(marketplace_private.offer_changed_fields(terms,jsonb_set(terms,'{meetup_location}','"Different entrance"'))='["Meeting location"]'::jsonb,'wording change remains visible even for same placeId');
end;$$;rollback;select true fixtures_rolled_back;`)
    }
  }
  assert.deepEqual(
    await fingerprint(),
    before,
    'Existing rows must remain unchanged'
  )
  console.log(
    JSON.stringify({
      mode,
      ref,
      file,
      sha256: hash,
      passed: true,
      existingRowsUnchanged: true,
      syntheticFixturesPersisted: false,
    })
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

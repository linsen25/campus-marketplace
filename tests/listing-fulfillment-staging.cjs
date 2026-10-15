// Exact-target migration deployment and rollback-only synthetic qualification.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict')
const { query, q, root, ref } = require('./order-master-staging-query.cjs')
const file = '202610150002_listing_fulfillment_defaults.sql',
  version = '202610150002',
  source = fs.readFileSync('supabase/migrations/' + file, 'utf8'),
  hash = crypto.createHash('sha256').update(source).digest('hex'),
  mode = process.argv[2]
assert.equal(ref, 'pcaqxezdfxofysghssyo')
assert(['dry-run', 'apply', 'verify', 'qualify'].includes(mode))
const receipt = path.join(root, 'listing-fulfillment-dry-run.json')
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
          (t) =>
            `select ${q(
              t
            )} name,count(*) n,md5(coalesce(string_agg((to_jsonb(t)-'estimated_delivery_fee_cents')::text,'' order by (to_jsonb(t)-'estimated_delivery_fee_cents')::text),'')) hash from ${t} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
async function main() {
  const before = await fingerprint(),
    versions = await query(
      'begin read only;select version from supabase_migrations.schema_migrations;rollback;'
    )
  if (['dry-run', 'apply'].includes(mode)) {
    assert(
      !versions.some((v) => v.version === version),
      'Already applied: never rewrite migration'
    )
    assert.deepEqual(
      fs
        .readdirSync('supabase/migrations')
        .filter(
          (f) =>
            f.endsWith('.sql') &&
            !versions.some((v) => v.version === f.split('_')[0])
        ),
      [file]
    )
    if (mode === 'apply')
      assert.equal(JSON.parse(fs.readFileSync(receipt)).hash, hash)
    await query(
      `begin;set local lock_timeout='15s';${source
        .replace(/\bbegin;/, '')
        .replace(/commit;\s*$/, '')}\n${
        mode === 'apply'
          ? `insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(
              version
            )},'listing_fulfillment_defaults',array[${q(source)}]);commit;`
          : 'rollback;'
      }select true complete;`
    )
    if (mode === 'dry-run')
      fs.writeFileSync(receipt, JSON.stringify({ ref, file, hash }))
  } else {
    const ledger = await query(
      `begin read only;select statements[1] source from supabase_migrations.schema_migrations where version=${q(
        version
      )};rollback;`
    )
    assert.equal(ledger[0]?.source, source)
    const columns = await query(
      "begin read only;select column_name,data_type,is_nullable,column_default,has_column_privilege('authenticated','public.listings',column_name,'INSERT') ins,has_column_privilege('authenticated','public.listings',column_name,'UPDATE') upd,has_column_privilege('anon','public.listings',column_name,'UPDATE') anon from information_schema.columns where table_schema='public' and table_name='listings' and column_name in('pickup_area','estimated_delivery_fee_cents');rollback;"
    )
    const fee = columns.find(
      (c) => c.column_name === 'estimated_delivery_fee_cents'
    )
    assert.equal(fee.data_type, 'bigint')
    assert.equal(fee.is_nullable, 'NO')
    assert.equal(fee.column_default, '0')
    assert(fee.ins && fee.upd && !fee.anon)
    assert.equal(
      columns.find((c) => c.column_name === 'pickup_area').is_nullable,
      'YES'
    )
    const funcs = await query(
      "begin read only;select p.prosrc,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='marketplace_private' and p.proname='protect_listing_delivery_estimate';rollback;"
    )
    assert.equal(funcs.length, 1)
    assert(!funcs[0].anon)
    assert.equal(
      funcs[0].prosrc.trim(),
      source.match(/as \$\$([\s\S]*?)\$\$;/)[1].trim()
    )
    if (mode === 'qualify') {
      let helpers = fs
        .readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
        .split('do $$declare terms jsonb;')[0]
      helpers = helpers
        .replace(
          'condition,pickup_area,expected_image_count',
          'condition,pickup_area,estimated_delivery_fee_cents,meeting_location,expected_image_count'
        )
        .replace(
          'condition,pickup_area,1,clock_timestamp()',
          "condition,null,1000,'Synthetic entrance',1,clock_timestamp()"
        )
      assert(helpers.includes("condition,null,1000,'Synthetic entrance'"))
      await query(`begin;${helpers}
do $$declare o public.orders;t jsonb;frozen jsonb;l public.listings;
begin
perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','listing_fixture','listing_payout','Test Bank','6789');
t:='{"item_amount_cents":8000,"fulfillment":"delivery","delivery_fee_cents":800,"delivery_method":"seller_delivery","delivery_area":{"country_code":"CA","province_code":"ON","city_label":"London","postal_prefix":"N6A"},"note":""}';
o:=pg_temp.bc_accept(t,true);frozen:=o.terms_snapshot;
select * into l from public.listings where id=o.listing_id;
perform pg_temp.bc_assert(l.pickup_area is null and l.estimated_delivery_fee_cents=1000,'nullable legacy field plus Listing estimate persisted');
perform pg_temp.bc_assert(l.search_text is not null and l.search_text like '%BC rollback fixture%','NULL pickup does not destroy search');
perform pg_temp.bc_assert((o.terms_snapshot->'terms'->>'delivery_fee_cents')::bigint=800,'accepted negotiated fee wins over Listing estimate');
perform pg_temp.bc_assert(public.marketplace_order_economics(o.id)->>'delivery'='800','Order economics uses accepted fee');
perform pg_temp.bc_reject(format('update public.listings set estimated_delivery_fee_cents=-1 where id=%L',l.id),'23514');
perform pg_temp.bc_reject(format('update public.listings set estimated_delivery_fee_cents=9007199254740992 where id=%L',l.id),'23514');
perform pg_temp.bc_actor((select buyer from bc_people));perform public.marketplace_cancel_order(o.id,'buyer_changed_mind','Rollback-only qualification',gen_random_uuid());
perform pg_temp.bc_actor((select seller from bc_people));
update public.listings set estimated_delivery_fee_cents=2000,meeting_location='New real default' where id=l.id;
perform pg_temp.bc_assert((select estimated_delivery_fee_cents=2000 and pickup_area is null from public.listings where id=l.id),'edit persistence without fake Place');
perform pg_temp.bc_assert((select terms_snapshot=frozen from public.orders where id=o.id),'Listing edit never changes Order terms');
perform pg_temp.bc_assert((select offer_terms=t from public.order_requests where id=o.request_id),'Listing edit never changes historical Offer');
perform pg_temp.bc_assert(public.marketplace_order_economics(o.id)->>'delivery'='800','Listing edit never changes frozen economics');
update public.listings set status='sold' where id=l.id;
perform pg_temp.bc_reject(format('update public.listings set estimated_delivery_fee_cents=2100 where id=%L',l.id),'23514');
end;$$;rollback;select true rolled_back;`)
    }
  }
  assert.deepEqual(await fingerprint(), before, 'All existing rows unchanged')
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

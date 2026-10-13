// Execute the additive candidate against an isolated local PostgreSQL runtime.
// No hosted connection, application credentials, Orders or emails are used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')

async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema marketplace_private;
      create table public.orders (
        id uuid primary key, order_protocol_version integer not null,
        item_amount_cents bigint not null, terms_snapshot jsonb not null,
        created_at timestamptz not null default clock_timestamp()
      );
      create table marketplace_private.v2_order_economics (
        order_id uuid primary key references public.orders(id),
        item_price_cents bigint not null,
        delivery_fee_cents bigint not null,
        buyer_service_fee_cents bigint not null check(buyer_service_fee_cents between 100 and 1500),
        buyer_total_cents bigint not null,
        seller_platform_fee_cents bigint not null default 0 check(seller_platform_fee_cents=0),
        seller_gross_cents bigint not null,
        fee_rule text not null check(fee_rule='item_only_4pct_min100_max1500_v1'),
        created_at timestamptz not null,
        check(buyer_total_cents::numeric=item_price_cents::numeric+delivery_fee_cents+buyer_service_fee_cents),
        check(seller_gross_cents::numeric=item_price_cents::numeric+delivery_fee_cents)
      );
      create function marketplace_private.validate_offer_terms(jsonb) returns boolean
      language sql immutable as $$ select true $$;
      create function marketplace_private.normalize_offer_terms(jsonb) returns jsonb
      language sql immutable as $$ select $1 $$;
      create function marketplace_private.protect_v2_order_economics() returns trigger
      language plpgsql as $$ begin raise exception 'Immutable'; end $$;
      create trigger immutable before update or delete on marketplace_private.v2_order_economics
      for each row execute function marketplace_private.protect_v2_order_economics();
      insert into public.orders values ('00000000-0000-4000-8000-000000000001',2,10000,'{}',now());
      insert into marketplace_private.v2_order_economics values
      ('00000000-0000-4000-8000-000000000001',10000,1000,400,11400,0,11000,'item_only_4pct_min100_max1500_v1',now());
    `)
    const before = (
      await db.query('select * from marketplace_private.v2_order_economics')
    ).rows
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610130010_offer_revision_economics.sql',
        'utf8'
      )
    )
    assert.deepEqual(
      (await db.query('select * from marketplace_private.v2_order_economics'))
        .rows,
      before
    )
    for (const [item, expected] of [
      [1000, 10],
      [5000, 50],
      [10000, 100],
      [30000, 300],
      [50000, 500],
      [80000, 500],
      [1, 0],
      [49, 0],
      [50, 1],
      [149, 1],
      [150, 2],
      [9007199254740991, 500],
    ]) {
      const result = await db.query(
        'select marketplace_private.v2_buyer_service_fee($1::bigint) fee',
        [item]
      )
      assert.equal(Number(result.rows[0].fee), expected)
    }
    await assert.rejects(
      db.query('select marketplace_private.v2_buyer_service_fee(0)'),
      /Invalid accepted/
    )
    await assert.rejects(
      db.query('select marketplace_private.v2_buyer_service_fee(-1)'),
      /Invalid accepted/
    )
    await db.exec(
      `create trigger orders_freeze_v2_economics after insert on public.orders for each row execute function marketplace_private.freeze_v2_order_economics()`
    )
    await db.exec(`insert into public.orders values
      ('00000000-0000-4000-8000-000000000002',2,10000,'{"terms":{"fulfillment":"delivery","delivery_fee_cents":1000}}',now()),
      ('00000000-0000-4000-8000-000000000003',2,10000,'{"terms":{"fulfillment":"on_campus"}}',now()),
      ('00000000-0000-4000-8000-000000000004',1,10000,'{}',now())`)
    const rows = (
      await db.query(
        'select * from marketplace_private.v2_order_economics order by order_id'
      )
    ).rows
    assert.equal(rows.length, 3, 'V1 must not enter the V2 freeze path')
    assert.equal(Number(rows[1].buyer_service_fee_cents), 100)
    assert.equal(Number(rows[1].buyer_total_cents), 11100)
    assert.equal(Number(rows[1].seller_gross_cents), 11000)
    assert.equal(Number(rows[2].delivery_fee_cents), 0)
    assert.equal(Number(rows[2].buyer_total_cents), 10100)
    assert.equal(rows[1].fee_rule, 'item_only_1pct_max500_v2')
    await assert.rejects(
      db.exec(
        'update marketplace_private.v2_order_economics set buyer_service_fee_cents=0'
      ),
      /Immutable/
    )
    await assert.rejects(
      db.exec('delete from marketplace_private.v2_order_economics'),
      /Immutable/
    )
    await assert.rejects(
      db.exec(
        `insert into public.orders values ('00000000-0000-4000-8000-000000000005',2,9007199254740991,'{"terms":{"fulfillment":"delivery","delivery_fee_cents":1}}',now())`
      ),
      /safe integer/
    )
    console.log(
      'PASS: new V2 fee examples, half-up cents, Delivery exclusion, immutable historical economics, V1 exclusion, overflow rejection. Local PostgreSQL only.'
    )
  } finally {
    await db.close()
  }
}
main().catch((error) => {
  console.error('FAIL: local V2 economics qualification:', error.message)
  process.exitCode = 1
})

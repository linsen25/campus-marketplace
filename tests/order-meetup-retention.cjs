// Isolated, rollback-only terminal participant-reference compatibility check.
const assert = require('node:assert/strict')
const h = require('./order-meetup-fixtures.cjs')
;(async () => {
  const before = await h.fingerprint()
  try {
    await h.setup()
    const f = await h.accepted()
    await h.query(`begin;lock table public.orders in access exclusive mode;
      alter table public.order_meetup_revisions disable trigger order_meetup_guard;
      alter table public.order_meetup_revisions disable trigger order_meetup_event;
      update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '65 minutes' where order_id=${h.q(
        f.order.id
      )};
      alter table public.order_meetup_revisions enable trigger order_meetup_event;
      alter table public.order_meetup_revisions enable trigger order_meetup_guard;commit;
      select marketplace_private.settle_order_meetup(${h.q(f.lid)});`)
    const facts = async () =>
      (
        await h.query(`select
      (select md5(to_jsonb(l)::text) from public.listings l where id=${h.q(
        f.lid
      )}) listing,
      (select md5((to_jsonb(o)-array['buyer_id','updated_at'])::text) from public.orders o where id=${h.q(
        f.order.id
      )}) snapshot,
      (select count(*) from public.transaction_events where order_id=${h.q(
        f.order.id
      )} and event_type='order_no_show_expired') events,
      (select count(*) from marketplace_private.meetup_expiries where order_id=${h.q(
        f.order.id
      )}) receipts,
      (select md5(string_agg(to_jsonb(m)::text,'' order by position)) from marketplace_private.order_snapshot_media m where order_id=${h.q(
        f.order.id
      )}) media;`)
      )[0]
    const original = await facts()
    assert.equal(original.events, 1)
    assert.equal(original.receipts, 1)
    // Real FK SET NULL, rolled back: never delete the fixture identity permanently.
    await h.query(`begin;delete from public.profiles where id=${h.q(
      h.users[1]
    )};
      do $$begin if not exists(select 1 from public.orders where id=${h.q(
        f.order.id
      )} and buyer_id is null and lifecycle_status='expired') then raise exception 'Historical FK compatibility failed';end if; if (select count(*) from public.transaction_events where order_id=${h.q(
      f.order.id
    )} and event_type='order_no_show_expired')<>1 or (select status from public.listings where id=${h.q(
      f.lid
    )})<>'available' or (select count(*) from marketplace_private.meetup_expiries where order_id=${h.q(
      f.order.id
    )})<>1 or (select count(*) from marketplace_private.order_snapshot_media where order_id=${h.q(
      f.order.id
    )})<>3 then raise exception 'FK maintenance reran expiry or lost history';end if;end$$;rollback;`)
    assert.deepEqual(await facts(), original)
    console.log(
      'PASS Expired Order preserves existing participant FK SET NULL compatibility (rollback-only)'
    )
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), before)
    console.log('Exact synthetic cleanup; canonical/manual/media unchanged')
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

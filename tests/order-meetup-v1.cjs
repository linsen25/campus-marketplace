const assert = require('assert/strict'),
  crypto = require('crypto'),
  h = require('./order-meetup-fixtures.cjs')
async function legacy() {
  const f = await h.fixture('delivery')
  const cid = (
    await h.query(
      `select conversation_id from public.order_requests where id=${h.q(
        f.offer
      )};`
    )
  )[0].conversation_id
  assert(
    !(
      await h.clients[0].rpc('marketplace_withdraw_offer', {
        p_offer_id: f.offer,
        p_client_action_id: crypto.randomUUID(),
        p_note: 'Synthetic V1 regression',
      })
    ).error
  )
  const r = await h.clients[0].rpc('marketplace_create_order_request', {
    p_conversation_id: cid,
    p_terms: {
      item_amount_cents: 7000,
      fulfillment_type: 'shipping',
      shipping_cost_mode: 'included',
      shipping_amount_cents: 0,
      seller_note: 'D1 V1 regression',
    },
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!r.error, r.error?.message)
  const corrected = await h.clients[0].rpc(
    'marketplace_replace_order_request',
    {
      p_request_id: r.data.id,
      p_terms: {
        item_amount_cents: 7000,
        fulfillment_type: 'shipping',
        shipping_cost_mode: 'included',
        shipping_amount_cents: 0,
        seller_note: 'D1 V1 replacement',
      },
      p_client_action_id: crypto.randomUUID(),
    }
  )
  assert(!corrected.error, corrected.error?.message)
  const cancelled = await h.clients[0].rpc('marketplace_cancel_order_request', {
    p_request_id: corrected.data.id,
    p_reason_code: 'sent_by_mistake',
    p_note: 'Synthetic regression',
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!cancelled.error, cancelled.error?.message)
  const final = await h.clients[0].rpc('marketplace_create_order_request', {
    p_conversation_id: cid,
    p_terms: {
      item_amount_cents: 7000,
      fulfillment_type: 'shipping',
      shipping_cost_mode: 'included',
      shipping_amount_cents: 0,
    },
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!final.error, final.error?.message)
  const a = await h.clients[1].rpc('marketplace_accept_order_request', {
    p_request_id: final.data.id,
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!a.error, a.error?.message)
  h.orders.push(a.data.id)
  h.journal()
  return { ...f, order: a.data }
}
;(async () => {
  const before = await h.fingerprint()
  let failure
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    const f = await legacy()
    assert.equal(f.order.order_protocol_version, 1)
    assert.equal(
      Date.parse(f.order.reservation_expires_at) -
        Date.parse(f.order.accepted_at),
      1800000
    )
    assert.equal(
      (
        await h.query(
          `select count(*) n from public.order_meetup_revisions where order_id=${h.q(
            f.order.id
          )};`
        )
      )[0].n,
      0
    )
    assert(
      (
        await h.clients[1].rpc('marketplace_order_meetup_history', {
          p_order_id: f.order.id,
        })
      ).error
    )
    const paid = await h.admin.rpc(
      'marketplace_simulate_order_payment_success',
      {
        p_order_id: f.order.id,
        p_buyer_id: h.users[1],
        p_client_action_id: crypto.randomUUID(),
      }
    )
    assert(!paid.error, paid.error?.message)
    assert.equal(paid.data.order.payment_status, 'paid')
    const g = await legacy()
    const c = await h.clients[1].rpc('marketplace_cancel_order', {
      p_order_id: g.order.id,
      p_reason: 'buyer_changed_mind',
      p_note: 'Synthetic V1 cancellation',
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!c.error)
    assert.equal(c.data.order.lifecycle_status, 'cancelled')
    const row = (
      await h.query(
        `select status from public.listings where id=${h.q(g.lid)};`
      )
    )[0]
    assert.equal(row.status, 'available')
    const expiry = await legacy()
    // Rollback-only existing V1 expiry path; test fixture clock shift, no RPC clock override.
    await h.query(`begin;lock table public.orders in access exclusive mode;
      alter table public.orders disable trigger orders_immutable;
      update public.orders set created_at=created_at-interval '31 minutes',updated_at=updated_at-interval '31 minutes',accepted_at=accepted_at-interval '31 minutes',reservation_started_at=reservation_started_at-interval '31 minutes',reservation_expires_at=reservation_expires_at-interval '31 minutes' where id=${h.q(
        expiry.order.id
      )};
      set constraints all immediate;alter table public.orders enable trigger orders_immutable;select marketplace_private.settle_listing_reservation(${h.q(
        expiry.lid
      )});
      do $$begin if not exists(select 1 from public.orders where id=${h.q(
        expiry.order.id
      )} and lifecycle_status='expired' and not holds_listing) or not exists(select 1 from public.listings where id=${h.q(
      expiry.lid
    )} and status='available') then raise exception 'V1 expiry regression';end if;end$$;rollback;`)
    console.log(
      'PASS real V1 Accept/30-minute deadline/payment simulator/cancel/release and D1 exclusion'
    )
  } catch (e) {
    failure = e
    console.error(e.stack)
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), before)
    console.log(
      'V1 fixtures cleaned; full canonical/manual/media fingerprint unchanged'
    )
  }
  if (failure) throw failure
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

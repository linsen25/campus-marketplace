// Actual notification service, authenticated/RLS-scoped transport mocked; no network.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
let rows = [],
  queries = [],
  actor = 'buyer',
  failure = null
const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  oid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  missing = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const data = {
  conversations: [
    {
      id: cid,
      channel: 'shop',
      shopName: 'Vintage Loop',
      participants: ['buyer', 'seller'],
    },
  ],
  orders: [
    {
      id: oid,
      channel: 'shop',
      shopName: 'Chris Vintage',
      participants: ['buyer', 'seller'],
    },
  ],
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const req = (name) => {
    if (name === '@/lib/server/financial-capabilities-service')
      return { requireFinancialEnvironment() {} }
    if (name === '@/lib/server/marketplace-auth')
      return { requireMarketplaceUser: async () => ({ id: actor }) }
    if (name === '@/lib/server/messages-environment')
      return { messageUuid: (v) => v }
    if (name === '@/lib/supabase/server')
      return {
        createMarketplaceClient: () => ({
          rpc: async (name, p) => {
            assert.equal(name, 'marketplace_notifications_filtered')
            const filtered = rows.filter(
              (n) =>
                (!p.p_before_id || n.id < p.p_before_id) &&
                (!p.p_category ||
                  (p.p_category === 'order' &&
                    n.event_type !== 'new_message' &&
                    n.event_type !== 'price_drop')) &&
                (!p.p_status ||
                  (p.p_status === 'read' ? Boolean(n.read_at) : !n.read_at))
            )
            const notifications = filtered.slice(0, 50)
            const last = notifications.at(-1)
            return {
              data: {
                notifications,
                unreadCount: 77,
                hasMore: filtered.length > 50,
                nextCursor:
                  filtered.length > 50
                    ? { before: last.created_at, beforeId: last.id }
                    : null,
                metadata: 'preserved',
              },
              error: null,
            }
          },
          from(table) {
            assert(
              ['conversations', 'orders'].includes(table),
              'no live Shop/Listing/media/economics'
            )
            let columns
            return {
              select(c) {
                columns = c
                return this
              },
              async in(key, ids) {
                queries.push({ table, columns, key, ids })
                assert.equal(key, 'id')
                assert.equal(new Set(ids).size, ids.length)
                return {
                  data: data[table]
                    .filter(
                      (r) =>
                        ids.includes(r.id) && r.participants.includes(actor)
                    )
                    .map(({ id, channel, shopName }) => ({
                      id,
                      channel,
                      shopName,
                    })),
                  error: failure,
                }
              },
            }
          },
        }),
      }
    return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
  }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText
  )(req, m, m.exports)
  cache.set(full, m.exports)
  return m.exports
}
const { createNotificationsService } = load(
  'lib/server/notifications-service.ts'
)
const item = (type, section, id) => ({
  id:
    '00000000-0000-4000-8000-' +
    String(9000 - (rows.length || 0)).padStart(12, '0'),
  event_type: type,
  created_at: '2026-10-17T00:00:00Z',
  read_at: null,
  destination: {
    section,
    ...(section === 'messages'
      ? { conversationId: id, destination: 'buying' }
      : section === 'orders'
      ? { orderId: id, destination: 'purchases' }
      : section === 'listing'
      ? { listingId: id }
      : { panel: 'payments-payouts' }),
  },
})
;(async () => {
  const messageTypes = [
    'new_message',
    'incoming_offer',
    'incoming_counter_offer',
    'offer_declined',
    'offer_withdrawn',
    'offer_closed',
  ]
  const orderTypes = [
    'offer_accepted',
    'agreement_confirmation_required',
    'agreement_complete',
    'payment_paid',
    'meetup_proposed',
    'seller_delivery_started',
    'handoff_confirmed',
    'protection_started',
    'order_cancelled',
    'order_completed',
    'delivery_claim_1h',
    'payout_paid',
  ]
  rows = [
    ...messageTypes.map((t) => item(t, 'messages', cid)),
    ...orderTypes.map((t) => item(t, 'orders', oid)),
    item('price_drop', 'listing', oid),
    item('payout_needs_attention', 'settings', oid),
  ]
  const original = JSON.stringify(rows),
    s = createNotificationsService({})
  const result = await s.list(null, null)
  assert.equal(queries.length, 2)
  assert.deepEqual(queries.find((q) => q.table === 'conversations').ids, [cid])
  assert.deepEqual(queries.find((q) => q.table === 'orders').ids, [oid])
  assert(queries[1].columns.includes('listing_snapshot->>'))
  for (const n of result.notifications) {
    if (n.destination.section === 'messages')
      assert.deepEqual(n.listingProvenance, {
        channel: 'shop',
        shopName: 'Vintage Loop',
      })
    else if (n.destination.section === 'orders')
      assert.deepEqual(n.listingProvenance, {
        channel: 'shop',
        shopName: 'Chris Vintage',
      })
    else assert.equal(n.listingProvenance, undefined)
  }
  assert.equal(JSON.stringify(rows), original)
  assert.equal(result.unreadCount, 77)
  assert.equal(result.metadata, 'preserved')
  // Event type cannot override its frozen destination, even after Order creation.
  rows = [
    item('offer_accepted', 'messages', cid),
    item('new_message', 'orders', oid),
  ]
  let p = await s.list(null, null)
  assert.equal(p.notifications[0].listingProvenance.shopName, 'Vintage Loop')
  assert.equal(p.notifications[1].listingProvenance.shopName, 'Chris Vintage')
  for (actor of ['buyer', 'seller']) {
    p = await s.list(null, null)
    assert(p.notifications.every((n) => n.listingProvenance))
  }
  actor = 'outsider'
  p = await s.list(null, null)
  assert.equal(p.notifications.length, 2)
  assert(p.notifications.every((n) => !n.listingProvenance))
  actor = 'buyer'
  rows = [
    item('incoming_offer', 'messages', missing),
    item('payment_paid', 'orders', missing),
    item('new_message', 'messages', 'invalid'),
  ]
  queries = []
  p = await s.list(null, null)
  assert(p.notifications.every((n) => !n.listingProvenance))
  assert.equal(p.notifications.length, 3)
  data.conversations[0].channel = null
  data.orders[0].channel = null
  rows = [
    item('incoming_offer', 'messages', cid),
    item('payment_paid', 'orders', oid),
  ]
  p = await s.list(null, null)
  assert(p.notifications.every((n) => !n.listingProvenance))
  data.conversations[0].channel = data.orders[0].channel = 'shop'
  failure = { code: '42501' }
  p = await s.list(null, null)
  assert(p.notifications.every((n) => !n.listingProvenance))
  failure = { code: 'XX000' }
  await assert.rejects(
    () => s.list(null, null),
    (e) => e.status === 503
  )
  failure = null
  rows = Array.from({ length: 110 }, (_, i) => ({
    ...item('payment_paid', 'orders', oid),
    id: '00000000-0000-4000-8000-' + String(9000 - i).padStart(12, '0'),
    read_at: i % 2 ? '2026-10-17T00:01:00Z' : null,
  }))
  queries = []
  p = await s.list(null, null, 'order', 'unread')
  assert.equal(p.notifications.length, 50)
  assert.equal(p.hasMore, true)
  assert.equal(p.unreadCount, 77)
  assert.equal(queries.length, 1, 'one Order batch after scanning/filtering')
  let second = await s.list(
    p.nextCursor.before,
    p.nextCursor.beforeId,
    'order',
    'unread'
  )
  assert.equal(second.notifications.length, 5)
  assert.equal(second.hasMore, false)
  assert(
    !second.notifications.some((n) =>
      p.notifications.some((a) => a.id === n.id)
    )
  )
  const handler = load('pages/api/notifications.ts').default
  for (const key of ['conversationId', 'orderId', 'listingId']) {
    const response = {
      code: 200,
      setHeader() {},
      status(code) {
        this.code = code
        return this
      },
      json(value) {
        this.value = value
        return this
      },
    }
    queries = []
    await handler({ method: 'GET', query: { [key]: cid } }, response)
    assert.equal(
      response.code,
      400,
      'API does not accept client entity IDs for enrichment'
    )
    assert.equal(queries.length, 0)
  }
  console.log(
    'PASS A-I destination authority, rename semantics, two deduplicated participant batches, no Shop lookup, missing/denied/legacy fallback, infrastructure errors, immutable DTO inputs, filtered pagination/order/unread preservation'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

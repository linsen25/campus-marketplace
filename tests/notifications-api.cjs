// No network or fixtures: exercise the actual API/service with mocked session/RPC.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const cache = new Map()
let environment = true,
  authenticated = true,
  calls = [],
  rpcError = null,
  sameOrigin = true,
  rows = [],
  lastResponse
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const categoryOf = (item) => {
  if (item.event_type === 'new_message') return 'message'
  if (item.event_type === 'price_drop') return 'listing'
  if (item.event_type === 'notification_test') return 'system'
  return 'order'
}
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  cache.set(full, module.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      const ApiError = () => load('lib/listing-validation.ts').ListingApiError
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          requireFinancialEnvironment() {
            if (!environment) throw new (ApiError())('Staging required.', 503)
          },
        }
      if (name === '@/lib/server/marketplace-auth')
        return {
          async requireMarketplaceUser() {
            if (!authenticated) throw new (ApiError())('Sign in.', 401)
          },
          requireSameOriginWrite() {
            if (!sameOrigin) throw new (ApiError())('Origin rejected.', 403)
          },
        }
      if (name === '@/lib/supabase/server')
        return {
          createMarketplaceClient() {
            return {
              async rpc(name, params) {
                calls.push({ name, params })
                if (name !== 'marketplace_notifications_filtered')
                  return {
                    data: { ok: true, unreadCount: rows.length },
                    error: rpcError,
                  }
                const filtered = rows.filter(
                  (n) =>
                    (!params.p_before_id || n.id < params.p_before_id) &&
                    (!params.p_category ||
                      categoryOf(n) === params.p_category) &&
                    (!params.p_status ||
                      (params.p_status === 'read'
                        ? Boolean(n.read_at)
                        : !n.read_at))
                )
                const notifications = filtered.slice(0, 50)
                const last = notifications.at(-1)
                return {
                  data: {
                    notifications,
                    unreadCount: rows.filter((n) => !n.read_at).length,
                    hasMore: filtered.length > 50,
                    nextCursor:
                      filtered.length > 50
                        ? { before: last.created_at, beforeId: last.id }
                        : null,
                  },
                  error: rpcError,
                }
              },
            }
          },
        }
      if (name === '@/lib/server/messages-environment')
        return {
          messageUuid(value) {
            if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
              throw new (ApiError())('Invalid UUID.')
            return value
          },
        }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const handler = load('pages/api/notifications.ts').default
async function request(method, query = {}, body = {}) {
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(v) {
      this.code = v
      return this
    },
    json(v) {
      this.body = v
      return this
    },
  }
  calls = []
  await handler({ method, query, body }, response)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  lastResponse = response
  return response.code
}
async function main() {
  assert.equal(await request('GET'), 200)
  assert.deepEqual(calls[0], {
    name: 'marketplace_notifications_filtered',
    params: {
      p_before: null,
      p_before_id: null,
      p_category: null,
      p_status: null,
    },
  })
  assert.equal(await request('GET', { userId: id }), 400)
  assert.equal(calls.length, 0)
  assert.equal(await request('GET', { before: 'invalid', beforeId: id }), 400)
  assert.equal(await request('GET', { beforeId: id }), 400)
  assert.equal(await request('POST', {}, { id }), 200)
  assert.deepEqual(calls[0], {
    name: 'marketplace_mark_notification_read',
    params: { p_id: id },
  })
  assert.equal(await request('POST', {}, { id, recipient: id }), 400)
  assert.equal(calls.length, 0)
  assert.equal(await request('POST', {}, { action: 'markAllRead' }), 200)
  assert.equal(calls[0].name, 'marketplace_mark_all_notifications_read')
  assert.equal(
    await request('POST', {}, { action: 'markAllRead', userId: id }),
    400
  )
  assert.equal(calls.length, 0)
  sameOrigin = false
  assert.equal(await request('POST', {}, { id }), 403)
  assert.equal(calls.length, 0)
  sameOrigin = true
  authenticated = false
  assert.equal(await request('GET'), 401)
  assert.equal(calls.length, 0)
  authenticated = true
  environment = false
  assert.equal(await request('GET'), 503)
  assert.equal(calls.length, 0)
  environment = true
  rpcError = { code: '42501', message: 'must never expose this diagnostic' }
  assert.equal(await request('POST', {}, { id }), 403)
  rpcError = null
  assert.equal(await request('DELETE'), 405)
  assert.equal(calls.length, 0)
  assert.equal(await request('GET', { category: 'bad' }), 400)
  assert.equal(calls.length, 0)
  assert.equal(await request('GET', { category: ['order'] }), 400)
  const { notificationCategory, notificationTime } = load(
    'lib/notification-category.ts'
  )
  for (const [event_type, expected] of [
    ['new_message', 'message'],
    ['incoming_offer', 'order'],
    ['offer_accepted', 'order'],
    ['meetup_1h', 'order'],
    ['payout_needs_attention', 'order'],
    ['price_drop', 'listing'],
    ['notification_test', 'system'],
    ['unknown_future_event', 'system'],
  ])
    assert.equal(
      notificationCategory({ event_type, destination: {} }),
      expected
    )
  assert.equal(
    notificationCategory({
      event_type: 'future_message',
      destination: { section: 'messages' },
    }),
    'message'
  )
  assert.equal(
    notificationCategory({
      event_type: 'future_order',
      destination: { section: 'orders' },
    }),
    'order'
  )
  assert.equal(
    notificationTime(
      '2026-10-16T12:00:00Z',
      Date.parse('2026-10-16T12:02:00Z')
    ),
    '2m'
  )
  rows = Array.from({ length: 155 }, (_, i) => ({
    id:
      (99999999 - i).toString().padStart(8, '0') +
      '-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event_type:
      i < 50
        ? 'new_message'
        : i < 151
        ? 'order_completed'
        : 'notification_test',
    created_at: '2026-10-15T12:00:00Z',
    read_at: null,
    destination: {},
  }))
  assert.equal(await request('GET', { category: 'order' }), 200)
  assert.equal(lastResponse.body.notifications.length, 50)
  assert.equal(calls.length, 1)
  assert.equal(lastResponse.body.unreadCount, 155)
  const first = lastResponse.body.notifications.map((n) => n.id)
  let cursor = lastResponse.body.nextCursor
  assert.equal(await request('GET', { category: 'order', ...cursor }), 200)
  assert.equal(lastResponse.body.notifications.length, 50)
  assert(!lastResponse.body.notifications.some((n) => first.includes(n.id)))
  cursor = lastResponse.body.nextCursor
  assert.equal(await request('GET', { category: 'order', ...cursor }), 200)
  assert.equal(lastResponse.body.notifications.length, 1)
  assert.equal(lastResponse.body.hasMore, false)
  assert.equal(await request('GET', { category: 'listing' }), 200)
  assert.equal(lastResponse.body.notifications.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(lastResponse.body.hasMore, false)
  assert.equal(await request('GET', { category: 'system' }), 200)
  assert.equal(lastResponse.body.notifications.length, 4)
  rows = rows.slice(0, 100).concat(rows.slice(151))
  assert.equal(await request('GET', { category: 'order' }), 200)
  assert.equal(lastResponse.body.notifications.length, 50)
  assert.equal(lastResponse.body.hasMore, false)
  assert.equal(lastResponse.body.nextCursor, null)
  rows.forEach((n, i) => (n.read_at = i % 2 ? '2026-10-16T01:00:00Z' : null))
  assert.equal(
    await request('GET', { category: 'order', status: 'unread' }),
    200
  )
  assert.equal(lastResponse.body.notifications.length, 25)
  assert(
    lastResponse.body.notifications.every(
      (n) => !n.read_at && n.event_type === 'order_completed'
    )
  )
  assert.equal(lastResponse.body.hasMore, false)
  assert.equal(await request('GET', { status: 'read' }), 200)
  assert.equal(lastResponse.body.notifications.length, 50)
  assert.equal(lastResponse.body.hasMore, true)
  const readCursor = lastResponse.body.nextCursor
  assert.equal(await request('GET', { status: 'read', ...readCursor }), 200)
  assert.equal(lastResponse.body.notifications.length, 2)
  assert(lastResponse.body.notifications.every((n) => Boolean(n.read_at)))
  assert.equal(await request('GET', { status: 'bad' }), 400)
  assert.equal(await request('GET', { status: ['read'] }), 400)
  for (const action of ['markRead', 'delete']) {
    assert.equal(await request('POST', {}, { action, ids: [id, id] }), 200)
    assert.deepEqual(calls[0], {
      name: 'marketplace_mutate_notifications',
      params: { p_ids: [id], p_action: action },
    })
    for (const ids of [[], [null], ['not-a-uuid'], Array(501).fill(id)]) {
      assert.equal(await request('POST', {}, { action, ids }), 400)
      assert.equal(calls.length, 0)
    }
    assert.equal(
      await request('POST', {}, { action, ids: [id], recipient: id }),
      400
    )
    sameOrigin = false
    assert.equal(await request('POST', {}, { action, ids: [id] }), 403)
    sameOrigin = true
    authenticated = false
    assert.equal(await request('POST', {}, { action, ids: [id] }), 401)
    authenticated = true
  }
  rows = Array.from({ length: 160 }, (_, i) => ({
    id:
      (99999999 - i).toString().padStart(8, '0') +
      '-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event_type: i < 20 ? 'new_message' : 'order_completed',
    created_at: '2026-10-15T12:00:00Z',
    read_at: i % 2 ? '2026-10-16T01:00:00Z' : null,
    destination: {},
  }))
  assert.equal(
    await request('GET', { category: 'order', status: 'unread' }),
    200
  )
  assert.equal(lastResponse.body.notifications.length, 50)
  const combinedCursor = lastResponse.body.nextCursor
  assert.equal(lastResponse.body.hasMore, true)
  const combinedIDs = lastResponse.body.notifications.map((n) => n.id)
  assert.equal(
    await request('GET', {
      category: 'order',
      status: 'unread',
      ...combinedCursor,
    }),
    200
  )
  assert.equal(lastResponse.body.notifications.length, 20)
  assert(
    lastResponse.body.notifications.every(
      (n) =>
        !n.read_at &&
        n.event_type === 'order_completed' &&
        !combinedIDs.includes(n.id)
    )
  )
  assert.equal(lastResponse.body.hasMore, false)
  rows = []
  console.log(
    'PASS status/category combinations and continuation, batch bounds/deduplication, exact RPC contract, authentication and CSRF'
  )
  console.log(
    'PASS database-filtered pagination: one bounded RPC, stable equal-time UUID cursors, no skipped/duplicate matches, global unread, empty categories, invalid input; zero network'
  )
  console.log(
    'PASS Notifications API: exact staging guard, session, no-store, CSRF, identity rejection, cursor, safe errors; no network'
  )
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})

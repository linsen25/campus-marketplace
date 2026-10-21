// Offline actual connector: deterministic SDK failures, timers and teardown.
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const userId = '11111111-1111-4111-8111-111111111111',
  ref = 'pcaqxezdfxofysghssyo'
const code = ts.transpileModule(
  fs.readFileSync('lib/messages-realtime.ts', 'utf8'),
  { compilerOptions: { module: 1, target: 7 } }
).outputText
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}
async function scenario(fault) {
  const timers = new Map(),
    clients = [],
    events = {}
  let timerId = 0,
    active = 0,
    signals = 0,
    recovered = 0,
    invalid = 0,
    requests = 0,
    callback
  const target = () => ({
    addEventListener: (n, fn) => {
      if (!events[n]) events[n] = new Set()
      events[n].add(fn)
    },
    removeEventListener: (n, fn) => events[n]?.delete(fn),
  })
  const window = target(),
    document = { ...target(), visibilityState: 'visible' }
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    process: {
      env: {
        NEXT_PUBLIC_MESSAGES_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
      },
    },
    window,
    document,
    navigator: { onLine: true },
    URL,
    Date,
    Promise,
    Set,
    JSON,
    atob: () => {
      throw Error('unused')
    },
    setTimeout: (fn, ms) => {
      const id = ++timerId
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async () => {
      requests++
      return {
        ok: true,
        status: 200,
        json: async () => ({
          userId,
          accessToken: 'memory-only-fixture',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }),
      }
    },
    require: (name) => {
      assert.equal(name, '@supabase/supabase-js')
      return {
        createClient: () => {
          const index = clients.length,
            client = {
              disconnected: false,
              removed: 0,
              realtime: {
                setAuth: async () => {
                  if (index === 0 && fault === 'auth')
                    throw Error('SDK transient auth failure')
                },
                disconnect: () => {
                  client.disconnected = true
                  active = 0
                },
              },
              removeAllChannels: async () => {
                client.removed++
                if (fault === 'remove') throw Error('SDK teardown failure')
                active = 0
              },
              channel: (topic, options) => {
                assert.equal(topic, 'marketplace:messages:' + userId)
                assert(options.config.private)
                if (index === 0 && fault === 'channel')
                  throw Error('SDK channel failure')
                active++
                return {
                  on(_kind, _event, fn) {
                    callback = fn
                    return this
                  },
                  subscribe(fn) {
                    fn('SUBSCRIBED')
                    return this
                  },
                }
              },
            }
          clients.push(client)
          return client
        },
      }
    },
  }
  vm.runInNewContext(code, context)
  const stop = module.exports.connectMessagesRealtime(
    userId,
    () => signals++,
    () => recovered++,
    () => invalid++
  )
  try {
    await flush()
    if (['auth', 'channel'].includes(fault)) {
      const retry = [...timers].find(([, t]) => t.ms === 5000)
      assert(retry, 'retry must be scheduled')
      timers.delete(retry[0])
      retry[1].fn()
      await flush()
      assert.equal(
        active,
        1,
        `${fault}: initial SDK failure must recover a real subscription`
      )
      assert(clients[0].disconnected, 'failed client must be disconnected')
      assert.equal(clients.length, 2, 'retry must use a fresh client')
    }
    assert.equal(active, 1)
    assert.equal(recovered, 1)
    callback({
      payload: { conversationId: userId, scope: 'history', role: 'buying' },
    })
    assert.equal(signals, 1)
    stop()
    await flush()
    assert(
      clients.at(-1).disconnected,
      'disconnect must run even if removeAllChannels rejects'
    )
    callback({
      payload: { conversationId: userId, scope: 'history', role: 'buying' },
    })
    assert.equal(signals, 1, 'late signal after logout ignored')
    assert.equal(active, 0)
    assert.equal(timers.size, 0)
    assert.equal(invalid, 0)
    assert(requests >= 1)
  } finally {
    stop()
    await flush()
  }
}
async function main() {
  for (const fault of ['auth', 'channel', 'remove', 'none'])
    await scenario(fault)
  console.log(
    'PASS B06 actual Realtime connector: initial auth/channel retry, no wedged client, teardown failure still disconnects, one private topic, stopped timers and late-event isolation; zero network'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

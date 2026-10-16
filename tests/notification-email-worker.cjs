// Offline tests run the real Edge worker core; no Resend credentials or network.
const fs = require('fs'),
  assert = require('assert/strict'),
  path = require('path'),
  ts = require('typescript')
function load(file) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('.')
        ? load(path.resolve(path.dirname(file), name))
        : require(name),
    m,
    m.exports
  )
  return m.exports
}
const { notificationTarget } = load('lib/notification-presentation.ts')
const { runEmailBatch, emailEnvelope } = load(
  'supabase/functions/notification-email-worker/worker.js'
)
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
;(async () => {
  assert.equal(
    notificationTarget({
      section: 'orders',
      orderId: 'javascript:evil',
      destination: 'sales',
    }),
    null
  )
  assert.equal(
    notificationTarget({ section: 'evil', url: 'https://evil.invalid' }),
    null
  )
  const row = {
    id,
    leaseId: id,
    type: 'incoming_offer',
    email: 'fixture@example.invalid',
    destination: {
      section: 'messages',
      conversationId: id,
      destination: 'buying',
      qrToken: 'SENSITIVE',
      address: 'PRIVATE',
    },
  }
  const envelope = emailEnvelope(
    row,
    'fixture@sender.invalid',
    row.email,
    'http://localhost:3000'
  )
  assert(!JSON.stringify(envelope).match(/SENSITIVE|PRIVATE|qrToken/))
  const keys = [],
    bodies = [],
    finishes = []
  let claimed = false,
    stored
  const rpc = async (name, input) => {
    if (name === 'marketplace_claim_email_deliveries') {
      if (claimed) return []
      claimed = true
      return [row]
    }
    if (name === 'marketplace_prepare_email') {
      stored ||= input.p_envelope
      return stored
    }
    finishes.push(input)
    return true
  }
  const config = {
    rpc,
    from: 'fixture@sender.invalid',
    origin: 'http://localhost:3000',
    send: async (body, key) => {
      keys.push(key)
      bodies.push(body)
      throw Error('Controlled transport failure')
    },
  }
  await runEmailBatch(config)
  assert.equal(finishes[0].p_error, 'timeout')
  assert(finishes[0].p_retry)
  claimed = false
  row.envelope = stored
  config.send = async (body, key) => {
    keys.push(key)
    bodies.push(body)
    return { ok: true, json: async () => ({ id: 'provider-fixture' }) }
  }
  assert.equal((await runEmailBatch(config)).sent, 1)
  assert.equal(keys[0], keys[1])
  assert.deepEqual(bodies[0], bodies[1])
  assert.equal((await runEmailBatch(config)).claimed, 0)
  claimed = false
  let concurrentSends = 0
  const concurrent = {
    ...config,
    send: async () => {
      concurrentSends++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        ok: true,
        json: async () => ({ id: 'concurrent-provider-fixture' }),
      }
    },
  }
  const results = await Promise.all([
    runEmailBatch(concurrent),
    runEmailBatch(concurrent),
  ])
  assert.equal(concurrentSends, 1)
  assert.equal(
    results.reduce((total, result) => total + result.sent, 0),
    1
  )
  for (const status of [400, 403, 429, 500]) {
    claimed = false
    config.send = async () => ({ ok: false, status, json: async () => ({}) })
    await runEmailBatch(config)
    assert.equal(finishes.at(-1).p_retry, status >= 429)
  }
  assert.equal(
    (await runEmailBatch({ ...config, from: 'onboarding@resend.dev' })).blocked,
    'test_recipient_required'
  )
  claimed = false
  let sent = false
  await runEmailBatch({
    ...config,
    from: 'onboarding@resend.dev',
    testRecipient: 'owner@example.invalid',
    send: async () => {
      sent = true
    },
  })
  assert(!sent)
  assert.equal(finishes.at(-1).p_error, 'sender_restricted')
  claimed = false
  config.send = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      message:
        'You can only send testing emails to your own email address (private@example.invalid)',
    }),
  })
  const restricted = await runEmailBatch(config)
  assert.deepEqual(restricted.failureReasons, [
    'test_sender_recipient_restricted',
  ])
  assert(!JSON.stringify(restricted).includes('private@example.invalid'))
  console.log(
    'PASS actual email worker: frozen envelope/stable key, timeout retry, permanent/retryable errors, no duplicate sent claim, sender restrictions, safe links/content; zero network'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

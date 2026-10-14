const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createStagingMediaFetch } = require('./staging-media-transport.cjs')
async function run() {
  const sent = [],
    body = Buffer.from('synthetic bytes')
  let status = 200,
    failure = null,
    fallbackCalls = 0
  const request = (url, options, callback) => {
    const req = new EventEmitter()
    req.end = (bytes) => {
      sent.push({ url, options, bytes })
      queueMicrotask(() => {
        if (failure) return req.emit('error', failure)
        const res = new EventEmitter()
        res.statusCode = status
        res.headers = { 'content-type': 'application/json' }
        callback(res)
        res.emit('data', Buffer.from('{"Key":"synthetic"}'))
        res.emit('end')
      })
    }
    return req
  }
  const fetch = createStagingMediaFetch(() => {
    fallbackCalls++
    return 'fallback'
  }, request)
  const url =
    'https://pcaqxezdfxofysghssyo.supabase.co/storage/v1/object/order-snapshot-media/batch/asset'
  for (let lifetime = 0; lifetime < 2; lifetime++) {
    const response = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'image/jpeg' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { Key: 'synthetic' })
  }
  for (const r of sent) {
    assert.equal(r.options.agent, false)
    assert.equal(r.options.headers['content-length'], String(body.length))
    assert.deepEqual(r.bytes, body)
  }
  status = 429
  assert.equal((await fetch(url, { method: 'POST', body })).status, 429)
  failure = Object.assign(Error('socket closed'), { code: 'ECONNRESET' })
  await assert.rejects(
    fetch(url, { method: 'POST', body }),
    (e) => e === failure
  )
  assert.equal(sent.length, 4, 'No implicit retries')
  assert.equal(await fetch(url, { method: 'GET' }), 'fallback')
  assert.equal(
    await fetch(url.replace('pcaqxezdfxofysghssyo', 'other'), {
      method: 'POST',
      body,
    }),
    'fallback'
  )
  assert.equal(fallbackCalls, 2)
  console.log(
    'PASS fixture private-media transport: fresh connections, same-process repeats, exact bytes, HTTP/errors preserved, no retries; other requests unchanged'
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

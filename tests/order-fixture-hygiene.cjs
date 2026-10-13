const assert = require('node:assert/strict')
const fs = require('node:fs')
const settleFixtureRaces = require('./helpers/settle-fixture-races.cjs')
;(async () => {
  let finish
  let done = false
  const delayed = new Promise((resolve) => {
    finish = resolve
  })
  const result = settleFixtureRaces([
    Promise.reject(Error('test failure')),
    delayed,
  ])
  result.catch(() => {
    done = true
  })
  await Promise.resolve()
  assert.equal(
    done,
    false,
    'cleanup must not start while another transaction is pending'
  )
  finish({ ok: true })
  await assert.rejects(result, /test failure/)
  assert.deepEqual(
    await settleFixtureRaces([Promise.resolve(1), Promise.resolve(2)]),
    [1, 2]
  )
  const admin = fs.readFileSync('tests/order-accept-staging-admin.cjs', 'utf8')
  assert(!admin.includes('Promise.all(['))
  assert(admin.includes('notify_order_history(id)'))
  assert(
    admin.indexOf('fixtures.push(lid)') < admin.indexOf('const setup = query')
  )
  const browser = fs.readFileSync(
    'tests/order-manual-fixture.browser.cjs',
    'utf8'
  )
  assert(
    !browser.includes("getByRole('button',{name:'Accept',exact:true}).click")
  )
  assert(!browser.includes('marketplace_accept_order_request'))
  console.log(
    'PASS fixture hygiene: wait on failure before scoped cleanup, pre-register IDs, deletion invalidation, read-only manual browser'
  )
})().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

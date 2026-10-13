const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
let slots = [],
  index = 0,
  effects = [],
  pending = []
const react = {
  useState(initial) {
    const i = index++
    if (!(i in slots)) slots[i] = initial
    return [
      slots[i],
      (value) => {
        slots[i] = value
      },
    ]
  },
  useRef(initial) {
    const i = index++
    if (!(i in slots)) slots[i] = { current: initial }
    return slots[i]
  },
  useCallback(fn) {
    return fn
  },
  useEffect(fn) {
    effects.push(fn)
  },
}
global.window = { addEventListener() {}, removeEventListener() {} }
const m = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(
    fs.readFileSync('hooks/use-formal-order-requests.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }
  ).outputText
)(
  (name) =>
    name === 'react'
      ? react
      : {
          getOrderRequests: () =>
            new Promise((resolve, reject) => pending.push({ resolve, reject })),
        },
  m,
  m.exports
)
function render(conversation = 'c') {
  index = 0
  effects = []
  return m.exports.useFormalOrderRequests(conversation, 'buyer', true)
}
const history = (status) => ({
  requests: [{ id: 'r', status }],
  eligibleRequestIds: status === 'active' ? ['r'] : [],
})
;(async () => {
  render()
  effects[0]()
  pending.shift().resolve(history('active'))
  await Promise.resolve()
  let hook = render()
  const staleRead = hook.refresh(),
    stale = pending.shift()
  hook.markAcceptanceSucceeded('r')
  assert(
    hook.isAcceptanceBlocked('r'),
    'Synchronous barrier before React rerender'
  )
  stale.resolve(history('active'))
  await staleRead
  hook = render()
  assert.equal(
    hook.history.requests[0].status,
    'active',
    'No fabricated final status'
  )
  assert.deepEqual(hook.pendingAcceptanceIds, ['r'])
  const failure = hook.refresh()
  pending.shift().reject(Error('forced read failure'))
  await failure
  hook = render()
  assert(hook.error.includes('Acceptance succeeded'))
  assert(hook.isAcceptanceBlocked('r'))
  assert.equal(hook.history.requests[0].status, 'active')
  const stillActive = hook.refresh()
  pending.shift().resolve(history('active'))
  await stillActive
  hook = render()
  assert(hook.isAcceptanceBlocked('r'))
  assert(hook.error.includes('retry'))
  const recovery = hook.refresh()
  pending.shift().resolve(history('accepted'))
  await recovery
  hook = render()
  assert.equal(hook.history.requests[0].status, 'accepted')
  assert.equal(hook.error, '')
  assert(!hook.isAcceptanceBlocked('r'))
  const oldHook = hook
  render('other')
  effects[0]()
  oldHook.markAcceptanceSucceeded('old-r')
  assert(
    !render('other').isAcceptanceBlocked('old-r'),
    'Old session/conversation callback fenced'
  )
  pending.shift().resolve({ requests: [], eligibleRequestIds: [] })
  await Promise.resolve()
  const card = fs.readFileSync(
    'components/home/order-request-preview.tsx',
    'utf8'
  )
  assert(/acceptOpen && formal[\s\S]*?className=\{profile.dialog\}/.test(card))
  const copy = fs.readFileSync(
    'components/listings/homepage-footer-content.ts',
    'utf8'
  )
  assert(copy.includes('buyer payment comes before fulfillment'))
  assert(copy.includes('seller payout eligible for release'))
  assert(!/72\s*(?:h|hour)|Payment moves forward only after/i.test(copy))
  console.log(
    'PASS successful Accept barrier, pre-success stale read fencing, failed/Active read recovery, server Accepted truth, scope guards, approved dialog surface and trust copy; no network'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

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
  ts.transpileModule(fs.readFileSync('hooks/use-formal-offers.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
)(
  (name) =>
    name === 'react'
      ? react
      : {
          getOffers: () =>
            new Promise((resolve, reject) => pending.push({ resolve, reject })),
        },
  m,
  m.exports
)
function render(conversation = 'c') {
  index = 0
  effects = []
  return m.exports.useFormalOffers(conversation, 'buyer', true)
}
const history = (status, updatedAt = '2026-10-12T10:00:00Z') => ({
  offers: [{ id: 'r', status, updatedAt }],
  events: [],
})
;(async () => {
  render()
  effects[0]()
  pending.shift().resolve(history('Active'))
  await Promise.resolve()
  let hook = render()
  const oldRead = hook.refresh(),
    stale = pending.shift()
  hook.markSucceeded({
    id: 'r',
    status: 'Withdrawn',
    updatedAt: '2026-10-12T11:00:00Z',
  })
  assert(hook.isBlocked())
  stale.resolve(history('Active'))
  await oldRead
  hook = render()
  assert(hook.blocked)
  assert.equal(hook.history.offers[0].status, 'Active')
  const failure = hook.refresh()
  pending.shift().reject(Error('forced failure'))
  await failure
  hook = render()
  assert(hook.blocked)
  assert(hook.error.includes('Actions remain unavailable'))
  assert.equal(hook.history.offers[0].status, 'Active')
  const outdated = hook.refresh()
  pending.shift().resolve(history('Active'))
  await outdated
  hook = render()
  assert(hook.blocked)
  const recovered = hook.refresh()
  pending.shift().resolve(history('Withdrawn', '2026-10-12T11:00:00Z'))
  await recovered
  hook = render()
  assert(!hook.blocked)
  assert.equal(hook.history.offers[0].status, 'Withdrawn')
  assert.equal(hook.error, '')
  const old = hook
  render('other')
  effects[0]()
  old.markSucceeded({ id: 'r' })
  assert(!render('other').blocked)
  pending.shift().resolve({ offers: [], events: [] })
  await Promise.resolve()
  console.log(
    'PASS Offer receipt barrier, old-read fencing, failed/outdated history blocking, authoritative recovery and scope isolation; no network'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

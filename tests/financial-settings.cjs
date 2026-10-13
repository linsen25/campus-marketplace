const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
let state = { data: null, error: '', loading: true, refresh: async () => {} }
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/hooks/use-financial-capabilities')
        return { useFinancialCapabilities: () => state }
      if (name.endsWith('.css'))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, p) => String(p) }),
        }
      if (name.startsWith('@/'))
        return load(
          name.slice(2) +
            (name.includes('stateful-button') || name.includes('/skeleton')
              ? '.tsx'
              : '.ts')
        )
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(full), name) + '.tsx')
      return require(name)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const { FinancialSettings } = load('components/home/financial-settings.tsx')
function render(settings = true) {
  return renderToStaticMarkup(
    React.createElement(FinancialSettings, { settings, onManage: () => {} })
  )
}
process.env.NEXT_PUBLIC_MESSAGES_ENV = 'staging'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  'https://pcaqxezdfxofysghssyo.supabase.co'
let html = render()
assert.equal((html.match(/data-slot="skeleton"/g) || []).length, 2)
assert(!html.includes('>Unset<'))
state = {
  ...state,
  loading: false,
  data: {
    paymentMethod: { status: 'unset', brand: null, last4: null },
    payoutAccount: { status: 'unset', institution: null, last4: null },
  },
}
html = render()
assert(html.includes('STAGING ONLY'))
assert(html.includes('not real financial onboarding'))
assert.equal((html.match(/>Unset</g) || []).length, 2)
state.data = {
  paymentMethod: { status: 'set', brand: 'Test Card', last4: '4242' },
  payoutAccount: { status: 'ready', institution: 'Test Bank', last4: '6789' },
}
html = render()
assert(html.includes('Test Card •••• 4242'))
assert(html.includes('Test Bank •••• 6789'))
assert(!render(false).includes('4242'))
assert(render(false).includes('Manage in Settings'))
state.data.paymentMethod.status = 'needs_attention'
state.data.payoutAccount.status = 'needs_attention'
assert.equal((render().match(/>Needs attention</g) || []).length, 2)
state.error = 'Unable to load'
html = render()
assert(html.includes('role="alert"'))
assert(html.includes('Retry'))
assert(!html.includes('data-slot="skeleton"'))
for (const [env, url] of [
  ['production', 'https://yzvchumzyonegujucyqs.supabase.co'],
  ['staging', 'https://yzvchumzyonegujucyqs.supabase.co'],
  ['production', 'https://pcaqxezdfxofysghssyo.supabase.co'],
  ['unknown', 'https://pcaqxezdfxofysghssyo.supabase.co'],
]) {
  process.env.NEXT_PUBLIC_MESSAGES_ENV = env
  process.env.NEXT_PUBLIC_SUPABASE_URL = url
  assert(!render().includes('STAGING ONLY'))
  assert(!render().includes('Simulate'))
}
console.log(
  'PASS Settings/Profile safe statuses, skeleton/error/retry, no metadata in summary, exact staging-only control visibility'
)

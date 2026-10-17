// Safe server-rendered state coverage; no API or hosted environment involved.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let state = { data: null, error: '', loading: true, refresh: async () => {} }
const source = fs.readFileSync('components/home/financial-settings.tsx', 'utf8')
const m = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(source, {
    compilerOptions: { module: 1, jsx: 4, target: 7, esModuleInterop: true },
  }).outputText
)(
  (name) => {
    if (name.endsWith('.css'))
      return {
        __esModule: true,
        default: new Proxy({}, { get: (_, p) => String(p) }),
      }
    if (name === '@/hooks/use-financial-capabilities')
      return { useFinancialCapabilities: () => state }
    if (name === '@/lib/listings-api')
      return {
        marketplaceRequest: async () => {
          throw Error('Unexpected server request')
        },
      }
    if (name === './stripe-card-setup')
      return { StripeCardSetup: () => null, stripeSetupAvailable: () => false }
    if (name === '@/components/ui/dynamic-action')
      return { DynamicAction: () => null }
    if (name === '@/components/ui/fading-dialog')
      return { FadingDialog: () => null }
    if (name === '@/components/ui/skeleton')
      return {
        Skeleton: () =>
          React.createElement('span', { 'data-slot': 'skeleton' }),
      }
    if (name === '@/components/velora/stateful-button')
      return {
        StatefulButton: ({ children, ...props }) =>
          React.createElement('button', props, children),
      }
    return require(name)
  },
  m,
  m.exports
)
const render = (settings = true) =>
  renderToStaticMarkup(
    React.createElement(m.exports.FinancialSettings, {
      settings,
      onManage: () => {},
    })
  )
assert.equal((render().match(/data-slot="skeleton"/g) || []).length, 2)
state = {
  ...state,
  loading: false,
  data: {
    paymentMethod: { status: 'unset' },
    payoutAccount: { status: 'unset' },
  },
}
assert.equal((render().match(/>Not set</g) || []).length, 0)
assert.equal((render(false).match(/>Unset</g) || []).length, 2)
assert(render().includes('Set up payment method'))
assert(render().includes('Set up payouts'))
assert(!render().includes('Simulate'))
state.data = {
  paymentMethod: { status: 'set', brand: 'Visa', last4: '4242' },
  payoutAccount: {
    status: 'ready',
    institution: 'Bank account',
    last4: '1234',
  },
}
assert(render().includes('Visa •••• 4242'))
assert.equal((render().match(/>Ready</g) || []).length, 0)
assert(render(false).includes('>Set<'))
assert(render(false).includes('>Ready<'))
assert(!render(false).includes('4242'))
assert(render(false).includes('Manage in Settings'))
state.data.paymentMethod.status = 'needs_attention'
state.data.payoutAccount.status = 'needs_attention'
assert.equal((render().match(/>Needs attention</g) || []).length, 0)
assert.equal((render(false).match(/>Needs attention</g) || []).length, 2)
state.error = 'Unable to load'
assert(render().includes('role="alert"'))
assert(!source.includes('/api/financial-capabilities/test-state'))
console.log(
  'PASS financial Settings states, safe summaries, Profile regression, no simulator calls'
)

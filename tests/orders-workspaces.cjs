const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file, resolve) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText
  )(resolve, module, module.exports)
  return module.exports
}
const helpers = load('lib/order-workspaces.ts', () => {
  throw Error('Unexpected dependency')
})
const snapshot = {
  listing: { title: 'Fixture' },
  draft: { price: 8000, fulfillment: 'pickup' },
}
const purchases = {
  id: 'purchase',
  buyerId: 'viewer',
  sellerId: 'other',
  snapshot,
}
const sales = { id: 'sale', buyerId: 'other', sellerId: 'viewer', snapshot }
const unrelated = { id: 'unrelated', buyerId: 'a', sellerId: 'b', snapshot }
const store = [purchases, sales, unrelated]
const collections = helpers.deriveOrderWorkspaces(store, 'viewer')
assert.deepEqual(collections, { purchases: [purchases], sales: [sales] })
assert.strictEqual(collections.purchases[0], purchases)
assert.deepEqual(helpers.deriveOrderWorkspaces(store, null), {
  purchases: [],
  sales: [],
})
assert.deepEqual(helpers.deriveOrderWorkspaces(store, 'outsider'), {
  purchases: [],
  sales: [],
})
let detailProps,
  visual = {
    state: { orders: store },
    enabled: true,
    viewerId: 'viewer',
    role: 'seller',
    selection: null,
    open() {},
    showList() {},
  }
function FluidTabs() {
  return React.createElement('nav', { 'data-tabs': true })
}
FluidTabs.List = FluidTabs.Tab = FluidTabs.Label = () => null
const { Orders } = load('components/home/orders.tsx', (name) => {
  if (name === 'react/jsx-runtime') return require(name)
  if (name.endsWith('fluid-tabs'))
    return { default: FluidTabs, __esModule: true }
  if (name.endsWith('card-actions'))
    return {
      CardAction: ({ children }) =>
        React.createElement('button', null, children),
    }
  if (name.endsWith('workspace-empty'))
    return {
      WorkspaceEmpty: ({ children }) =>
        React.createElement('p', null, children),
    }
  if (name.endsWith('order-interaction-preview'))
    return {
      previewNextStep: (_, role) => role,
      previewStatusLabel: (_, role) => role,
    }
  if (name.endsWith('order-visual-preview'))
    return {
      formatOrderVisualAmount: String,
      fulfillmentLabels: { pickup: 'Pickup' },
    }
  if (name.endsWith('order-workspaces')) return helpers
  if (name.endsWith('order-visual-context'))
    return { useOrderVisual: () => visual }
  if (name.endsWith('order-detail-preview'))
    return {
      OrderDetailPreview: (props) => {
        detailProps = props
        return React.createElement('p', null, props.originWorkspace)
      },
    }
  if (name.endsWith('formal-orders')) return { FormalOrders: () => null }
  if (name.endsWith('.css')) return { __esModule: true, default: {} }
  throw Error(name)
})
for (const mode of ['purchases', 'sales']) {
  const render = (desktop = true) =>
    renderToStaticMarkup(
      React.createElement(Orders, { destination: mode, desktop })
    )
  assert(!render().includes('data-tabs'))
  assert(!render(false).includes('data-tabs'))
  assert(
    render().includes(
      `data-order-list-card="${mode === 'purchases' ? 'purchase' : 'sale'}"`
    )
  )
  assert(
    !render().includes(
      `data-order-list-card="${mode === 'purchases' ? 'sale' : 'purchase'}"`
    )
  )
  visual.selection = {
    id: mode === 'purchases' ? 'purchase' : 'sale',
    workspace: mode,
  }
  for (const role of ['buyer', 'seller']) {
    visual.role = role
    render()
    assert.equal(detailProps.orderRole, helpers.orderWorkspaceRole(mode))
    assert.equal(detailProps.originWorkspace, mode)
    assert.strictEqual(
      detailProps.order,
      mode === 'purchases' ? purchases : sales
    )
  }
  visual.selection = null
}
visual.viewerId = 'outsider'
for (const mode of ['purchases', 'sales']) {
  const html = renderToStaticMarkup(
    React.createElement(Orders, { destination: mode, desktop: true })
  )
  assert(
    html.includes(mode === 'purchases' ? 'No purchases yet.' : 'No sales yet.')
  )
  assert(!html.includes('data-order-list-card'))
}
assert.equal(store.length, 3)
console.log(
  'PASS independent relationship collections, shared references, identity fail-closed, desktop/mobile navigation, detail roles and origin independent of global debug role'
)

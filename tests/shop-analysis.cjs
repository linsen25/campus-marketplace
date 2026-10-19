// Offline calculation qualification; no DB, HTTP, credentials or environment.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const cache = new Map()
function load(filename) {
  const file = path.resolve(filename)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (id) =>
      id.startsWith('@/')
        ? load(id.slice(2) + '.ts')
        : id.startsWith('.')
        ? load(path.resolve(path.dirname(file), id) + '.ts')
        : require(id),
    module,
    module.exports
  )
  return module.exports
}
const core = load('lib/shop-analysis.ts'),
  fixture = load('lib/fixtures/shop-analysis-fixture.ts')
async function main() {
  for (const access of ['plus', 'pro', 'trial'])
    for (const range of ['week', 'month', 'last-month', 'year']) {
      const data = await fixture.loadShopAnalysisFixture(range, access),
        c = data.current
      assert.equal(
        c.estimatedProfitCents,
        c.revenueCents - c.knownExpensesCents
      )
      assert.equal(
        c.breakdown.reduce((s, x) => s + x.cents, 0),
        c.knownExpensesCents
      )
      assert.equal(
        c.trend.reduce((s, x) => s + x.sold, 0),
        c.sold
      )
      assert.equal(
        Math.round(c.trend.reduce((s, x) => s + x.revenue, 0) * 100),
        c.revenueCents
      )
      assert.equal(
        Math.round(c.trend.reduce((s, x) => s + x.expenses, 0) * 100),
        c.knownExpensesCents
      )
      if (access === 'plus') {
        assert(!data.pro)
        assert(!('products' in data.current))
        assert(!('products' in data.previous))
      } else
        assert.equal(
          data.pro.products.reduce((s, x) => s + x.revenueCents, 0),
          c.revenueCents
        )
      if (access === 'trial')
        assert.equal(
          c.breakdown.find((x) => x.name === 'Subscription'),
          undefined
        )
      else if (range === 'month')
        assert.equal(
          c.breakdown.find((x) => x.name === 'Subscription').cents,
          access === 'plus' ? 299 : 599
        )
    }
  const source = fixture.createShopAnalysisFixture('pro'),
    b = core.shopAnalysisBounds('month', fixture.shopAnalysisFixtureAsOf),
    baseline = core.calculateShopAnalysis(source, b.start, b.end)
  source.orders.push({
    ...source.orders.at(-3),
    id: 'resale-poison',
    channel: 'resale',
    itemRevenueCents: 999999999,
    quantity: 999999,
  })
  source.expenses.push({
    id: 'resale-cost',
    channel: 'resale',
    on: '2026-10-01',
    kind: 'Marketing',
    amountCents: 999999999,
    description: 'Excluded',
  })
  assert.deepEqual(
    core.calculateShopAnalysis(source, b.start, b.end),
    baseline,
    'Resale excluded'
  )
  const external = source.orders.find(
    (x) =>
      x.channel === 'shop' &&
      x.status === 'completed' &&
      x.paymentMode === 'external' &&
      x.completedOn >= '2026-10-01'
  )
  assert(external)
  const without = core.calculateShopAnalysis(
    { ...source, orders: source.orders.filter((x) => x.id !== external.id) },
    b.start,
    b.end
  )
  assert.equal(
    baseline.revenueCents - without.revenueCents,
    external.itemRevenueCents
  )
  const shifted = {
    ...external,
    id: 'completion-boundary',
    createdOn: '2025-01-01',
    completedOn: '2026-10-16',
    quantity: 3,
    itemRevenueCents: 3000,
  }
  const added = core.calculateShopAnalysis(
    { ...source, orders: [...source.orders, shifted] },
    b.start,
    b.end
  )
  assert.equal(added.revenueCents - baseline.revenueCents, 3000)
  assert.equal(added.sold - baseline.sold, 3)
  const missing = core.calculateShopAnalysis(
    { ...source, orders: [{ ...shifted, unitCostSnapshotCents: null }] },
    b.start,
    b.end
  )
  assert.equal(missing.estimatedProfitCents, null)
  assert.equal(missing.products[0].profitCents, null)
  assert.equal(missing.missingCostCount, 1)
  const sub = source.expenses.find(
    (x) => x.on === '2026-10-01' && x.kind === 'Subscription'
  )
  const duplicate = core.calculateShopAnalysis(
    { ...source, expenses: [...source.expenses, { ...sub, id: 'duplicate' }] },
    b.start,
    b.end
  )
  assert.equal(duplicate.knownExpensesCents, baseline.knownExpensesCents)
  const costly = {
    id: 'loss',
    channel: 'shop',
    on: '2026-10-17',
    kind: 'Marketing',
    amountCents: 999999,
    description: 'Loss fixture',
  }
  const loss = core.calculateShopAnalysis(
    { ...source, expenses: [...source.expenses, costly] },
    b.start,
    b.end
  )
  assert(loss.estimatedProfitCents < 0)
  assert.equal(core.shopComparison(10, 0), '\u2014')
  assert.equal(core.shopComparison(0, 10), '-100.0%')
  const empty = core.calculateShopAnalysis(
    { orders: [], expenses: [], featured: [] },
    b.start,
    b.end
  )
  assert.equal(empty.sold, 0)
  assert.equal(empty.featured.rate, null)
  assert.equal(empty.products.length, 0)
  console.log(
    'PASS 12 range/access projections; coherent cents/trends/product totals; completed external revenue; quantity; completion timing; Resale exclusion; missing costs; losses; subscription deduplication; no-charge trial; empty states/comparisons'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

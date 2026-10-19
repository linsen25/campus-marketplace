import { calculateShopAnalysis, shopAnalysisBounds } from '@/lib/shop-analysis'
import type {
  ShopAnalysisSource,
  ShopAnalysisRange,
  ShopAnalysisDemoAccess,
  ShopAnalysisResponse,
  ShopExpense,
} from '@/lib/shop-analysis'

import { TEST_PICTURES } from './test-pictures'
/** Explicit illustrative Shop dataset, never persisted or bound to the signed-in seller. */
export const shopAnalysisFixtureAsOf = '2026-10-17'
const fixtureProducts = [
  {
    id: 'demo-shop-tote',
    name: 'Everyday canvas tote',
    price: 2800,
    cost: 1100,
    image: TEST_PICTURES.toteBag,
  },
  {
    id: 'demo-shop-mug',
    name: 'Handmade ceramic mug',
    price: 2400,
    cost: 900,
    image: TEST_PICTURES.mug,
  },
  {
    id: 'demo-shop-print',
    name: 'Potted plant',
    price: 1800,
    cost: 400,
    image: TEST_PICTURES.plant,
  },
  {
    id: 'demo-shop-kit',
    name: 'Study stationery kit',
    price: 1600,
    cost: 650,
    image: TEST_PICTURES.stationery,
  },
  {
    id: 'demo-shop-candle',
    name: 'Small-batch candle',
    price: 2200,
    cost: 800,
    image: TEST_PICTURES.candle,
  },
]
export function createShopAnalysisFixture(
  access: ShopAnalysisDemoAccess
): ShopAnalysisSource {
  const orders: ShopAnalysisSource['orders'] = []
  const expenses: ShopExpense[] = []
  const featured: ShopAnalysisSource['featured'] = []
  for (let month = 0; month < 10; month++) {
    const days =
      month === 9 ? 17 : new Date(Date.UTC(2026, month + 1, 0)).getUTCDate()
    for (let date = 1; date <= days; date++) {
      const on = `2026-${String(month + 1).padStart(2, '0')}-${String(
        date
      ).padStart(2, '0')}`
      if (date % 3 !== 0) {
        const product = fixtureProducts[(date + month) % fixtureProducts.length]
        const quantity = date % 4 === 0 ? 3 : 1
        orders.push({
          id: `demo-shop-${on}`,
          channel: 'shop',
          status: 'completed',
          createdOn: on,
          completedOn: on,
          paymentMode: date % 2 ? 'external' : 'uu_pay',
          productId: product.id,
          productName: product.name,
          image: product.image,
          quantity,
          itemRevenueCents: quantity * product.price,
          unitCostSnapshotCents: product.cost,
        })
      }
      featured.push({
        on,
        impressions: 80 + date * 4,
        attributedVisits: 8 + (date % 7),
      })
    }
    const on = `2026-${String(month + 1).padStart(2, '0')}-01`
    for (const [kind, amount] of [
      ['Packaging', 1900],
      ['Marketing', 2500],
      ['Other', 750],
    ] as const)
      expenses.push({
        id: `demo-${on}-${kind}`,
        channel: 'shop',
        on,
        kind,
        amountCents: amount,
        description: 'Illustrative operating expense',
      })
    // Demo trial has no subscription charges. This does not establish real trial billing authority.
    if (access !== 'trial')
      expenses.push({
        id: `demo-subscription-${on}`,
        channel: 'shop',
        on,
        kind: 'Subscription',
        amountCents: access === 'plus' ? 299 : 599,
        description: 'Illustrative monthly plan charge',
        chargeReference: `demo-charge-${on}`,
      })
  }
  for (const status of ['pending', 'cancelled'] as const)
    orders.push({
      ...orders[orders.length - 1],
      id: `demo-shop-${status}`,
      status,
      createdOn: shopAnalysisFixtureAsOf,
      completedOn: null,
    })
  return { orders, expenses, featured }
}
/** Fixture-only loader. A future authenticated backend must authorize Pro projection before retrieval. */
export function loadShopAnalysisFixture(
  range: ShopAnalysisRange,
  access: ShopAnalysisDemoAccess,
  manual: ShopExpense[] = []
): Promise<ShopAnalysisResponse> {
  const source = createShopAnalysisFixture(access)
  source.expenses.push(...manual)
  const b = shopAnalysisBounds(range, shopAnalysisFixtureAsOf)
  const { products, featured, ...current } = calculateShopAnalysis(
    source,
    b.start,
    b.end
  )
  const previousCore = calculateShopAnalysis(
    source,
    b.previousStart,
    b.previousEnd
  )
  const previous = {
    revenueCents: previousCore.revenueCents,
    knownExpensesCents: previousCore.knownExpensesCents,
    estimatedProfitCents: previousCore.estimatedProfitCents,
    sold: previousCore.sold,
    missingCostCount: previousCore.missingCostCount,
    orders: previousCore.orders,
    breakdown: previousCore.breakdown,
    trend: previousCore.trend,
  }
  return Promise.resolve({
    source: 'fixture',
    timezone: 'America/Toronto',
    asOf: shopAnalysisFixtureAsOf,
    range,
    access,
    current,
    previous,
    ...(access === 'plus' ? {} : { pro: { products, featured } }),
  })
}

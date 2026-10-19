/** Future Shop-only response/calculation boundary. No network or entitlement authority. All money is integer CAD cents. */
export type ShopAnalysisRange = 'last-month' | 'month' | 'week' | 'year'
export type ShopAnalysisDemoAccess = 'plus' | 'pro' | 'trial'
export const shopAnalysisRanges = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'year', label: 'This Year' },
] as const
export type ShopAnalysisOrder = {
  id: string
  channel: 'resale' | 'shop'
  status: 'cancelled' | 'completed' | 'pending'
  createdOn: string
  completedOn: string | null
  paymentMode: 'external' | 'uu_pay'
  productId: string
  productName: string
  image: string
  quantity: number
  itemRevenueCents: number
  unitCostSnapshotCents: number | null
}
export type ShopExpense = {
  id: string
  channel: 'resale' | 'shop'
  on: string
  kind: 'Marketing' | 'Other' | 'Packaging' | 'Subscription'
  amountCents: number
  description: string
  chargeReference?: string
  productId?: string
}
export type ShopFeaturedEvent = {
  on: string
  impressions: number
  attributedVisits: number
}
export type ShopAnalysisSource = {
  orders: ShopAnalysisOrder[]
  expenses: ShopExpense[]
  featured: ShopFeaturedEvent[]
}
export type ShopAnalysisPoint = {
  date: string
  revenue: number
  expenses: number
  profit: number | null
  sold: number
  impressions: number
  visits: number
}
export type ShopProductAnalysis = {
  id: string
  name: string
  image: string
  sold: number
  revenueCents: number
  costCents: number | null
  directExpenseCents: number
  profitCents: number | null
  margin: number | null
}
export type ShopAnalysisCore = {
  revenueCents: number
  knownExpensesCents: number
  estimatedProfitCents: number | null
  sold: number
  missingCostCount: number
  orders: { completed: number; pending: number; cancelled: number }
  breakdown: Array<{ name: string; cents: number }>
  trend: ShopAnalysisPoint[]
  products: ShopProductAnalysis[]
  featured: { impressions: number; visits: number; rate: number | null }
}
export type ShopAnalysisResponse = {
  source: 'fixture'
  timezone: 'America/Toronto'
  asOf: string
  range: ShopAnalysisRange
  access: ShopAnalysisDemoAccess
  current: Omit<ShopAnalysisCore, 'featured' | 'products'>
  previous: Omit<ShopAnalysisCore, 'featured' | 'products'>
  pro?: Pick<ShopAnalysisCore, 'featured' | 'products'>
}
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)
const add = (value: string, n: number) => {
  const d = day(value)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
/** Calendar date keys represent Toronto business days; no browser-local timezone conversion. */
export function shopAnalysisBounds(range: ShopAnalysisRange, asOf: string) {
  const d = day(asOf)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  let start: string
  let end: string
  if (range === 'week') {
    start = add(asOf, -((d.getUTCDay() + 6) % 7))
    end = add(start, 7)
  } else if (range === 'year') {
    start = `${year}-01-01`
    end = `${year + 1}-01-01`
  } else {
    start = iso(
      new Date(Date.UTC(year, month - (range === 'last-month' ? 1 : 0), 1))
    )
    end = iso(
      new Date(Date.UTC(year, month + (range === 'last-month' ? 0 : 1), 1))
    )
  }
  const days = Math.round(
    (day(end).getTime() - day(start).getTime()) / 86400000
  )
  return { start, end, previousStart: add(start, -days), previousEnd: start }
}
export function calculateShopAnalysis(
  source: ShopAnalysisSource,
  start: string,
  end: string
): ShopAnalysisCore {
  const within = (on: string) => on >= start && on < end
  const completed = source.orders.filter(
    (o) =>
      o.channel === 'shop' &&
      o.status === 'completed' &&
      o.completedOn &&
      within(o.completedOn)
  )
  const countedCharges = new Set<string>()
  const expenses = source.expenses.filter((e) => {
    if (e.channel !== 'shop' || !within(e.on)) return false
    if (e.chargeReference) {
      if (countedCharges.has(e.chargeReference)) return false
      countedCharges.add(e.chargeReference)
    }
    return true
  })
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const revenueCents = sum(completed.map((o) => o.itemRevenueCents))
  const cogs = sum(
    completed.map((o) => (o.unitCostSnapshotCents ?? 0) * o.quantity)
  )
  const missingCostCount = completed.filter(
    (o) => o.unitCostSnapshotCents === null
  ).length
  const knownExpensesCents = cogs + sum(expenses.map((e) => e.amountCents))
  const groups = new Map<string, ShopProductAnalysis>()
  completed.forEach((o) => {
    const product = groups.get(o.productId) ?? {
      id: o.productId,
      name: o.productName,
      image: o.image,
      sold: 0,
      revenueCents: 0,
      costCents: 0,
      directExpenseCents: 0,
      profitCents: 0,
      margin: 0,
    }
    product.sold += o.quantity
    product.revenueCents += o.itemRevenueCents
    product.costCents =
      product.costCents === null || o.unitCostSnapshotCents === null
        ? null
        : product.costCents + o.quantity * o.unitCostSnapshotCents
    groups.set(o.productId, product)
  })
  const products = Array.from(groups.values())
    .map((p) => {
      const directExpenseCents = sum(
        expenses.filter((e) => e.productId === p.id).map((e) => e.amountCents)
      )
      const profitCents =
        p.costCents === null
          ? null
          : p.revenueCents - p.costCents - directExpenseCents
      return {
        ...p,
        directExpenseCents,
        profitCents,
        margin:
          profitCents === null || p.revenueCents === 0
            ? null
            : (profitCents / p.revenueCents) * 100,
      }
    })
    .sort((a, b) => b.revenueCents - a.revenueCents || a.id.localeCompare(b.id))
  const trend: ShopAnalysisPoint[] = []
  for (let on = start; on < end; on = add(on, 1)) {
    const orders = completed.filter((o) => o.completedOn === on)
    const dailyExpenses = expenses.filter((e) => e.on === on)
    const events = source.featured.filter((e) => e.on === on)
    const revenue = sum(orders.map((o) => o.itemRevenueCents)) / 100
    const expense =
      (sum(orders.map((o) => (o.unitCostSnapshotCents ?? 0) * o.quantity)) +
        sum(dailyExpenses.map((e) => e.amountCents))) /
      100
    trend.push({
      date: on,
      revenue,
      expenses: expense,
      profit: orders.some((o) => o.unitCostSnapshotCents === null)
        ? null
        : revenue - expense,
      sold: sum(orders.map((o) => o.quantity)),
      impressions: sum(events.map((e) => e.impressions)),
      visits: sum(events.map((e) => e.attributedVisits)),
    })
  }
  const impressions = sum(trend.map((p) => p.impressions))
  const visits = sum(trend.map((p) => p.visits))
  return {
    revenueCents,
    knownExpensesCents,
    estimatedProfitCents: missingCostCount
      ? null
      : revenueCents - knownExpensesCents,
    sold: sum(completed.map((o) => o.quantity)),
    missingCostCount,
    orders: {
      completed: completed.length,
      pending: source.orders.filter(
        (o) =>
          o.channel === 'shop' && o.status === 'pending' && within(o.createdOn)
      ).length,
      cancelled: source.orders.filter(
        (o) =>
          o.channel === 'shop' &&
          o.status === 'cancelled' &&
          within(o.createdOn)
      ).length,
    },
    breakdown: [
      { name: 'Product Cost', cents: cogs },
      ...(['Packaging', 'Marketing', 'Other', 'Subscription'] as const).map(
        (name) => ({
          name,
          cents: sum(
            expenses.filter((e) => e.kind === name).map((e) => e.amountCents)
          ),
        })
      ),
    ].filter((x) => x.cents > 0),
    trend,
    products,
    featured: {
      impressions,
      visits,
      rate: impressions > 0 ? (visits / impressions) * 100 : null,
    },
  }
}
export const shopMoney = (cents: number) =>
  `CA$${(cents / 100).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
export function shopComparison(
  current: number | null,
  previous: number | null
) {
  return current === null || previous === null || previous <= 0
    ? '\u2014'
    : `${current >= previous ? '+' : ''}${(
        ((current - previous) / previous) *
        100
      ).toFixed(1)}%`
}

import { ListingApiError } from '@/lib/listing-validation'
import type {
  ShopAnalysisRange,
  ShopAnalysisResponse,
  ShopProductAnalysis,
} from '@/lib/shop-analysis'
import type { AnalysisCoverage, RealShopAnalysis } from '@/types/shop-analysis'

type ObjectValue = Record<string, unknown>
function invalid(): never {
  throw new ListingApiError('Shop analysis is unavailable. Please retry.', 503)
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  return value as ObjectValue
}
function text(value: unknown, max = 500) {
  if (typeof value !== 'string' || value.length > max) return invalid()
  return value
}
function money(
  value: unknown,
  nullable = false,
  negative = false
): number | null {
  if (nullable && value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (!negative && value < 0)
  )
    return invalid()
  return value
}
function count(value: unknown) {
  return money(value)!
}
function amount(value: unknown) {
  return money(value, true, true)
}
function number(value: unknown, nullable = false) {
  if (nullable && value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  )
    return invalid()
  return value
}
function array(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) return invalid()
  return value as unknown[]
}
function date(value: unknown, day = false) {
  const v = text(value, 80)
  if (
    !Number.isFinite(Date.parse(v)) ||
    (day &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v))
  )
    return invalid()
  return v
}
function coverage(value: unknown): AnalysisCoverage {
  const v = object(value)
  if (typeof v.profitComplete !== 'boolean' || v.productLimit !== 20)
    return invalid()
  return {
    knownSalesCents: count(v.knownSalesCents),
    uuPayCents: count(v.uuPayCents),
    externalCents: count(v.externalCents),
    missingProvenanceCount: count(v.missingProvenanceCount),
    currencyMismatchCount: count(v.currencyMismatchCount),
    invalidFactCount: count(v.invalidFactCount),
    refundedCount: count(v.refundedCount),
    excludedRefundedItemCents: count(v.excludedRefundedItemCents),
    expiredCount: count(v.expiredCount),
    authenticatedListingOpens: count(v.authenticatedListingOpens),
    authenticatedShopOpens: count(v.authenticatedShopOpens),
    productCount: count(v.productCount),
    productLimit: 20,
    grossItemValueCents: count(v.grossItemValueCents),
    profitComplete: v.profitComplete,
  }
}
function core(value: unknown): RealShopAnalysis['current'] {
  const v = object(value)
  const orders = object(v.orders)
  const b = object(v.bounds)
  const c = coverage(v.coverage)
  const revenue = money(v.revenueCents, true)
  const profit = amount(v.estimatedProfitCents)
  const start = date(b.start, true)
  const end = date(b.end, true)
  const days = (Date.parse(end) - Date.parse(start)) / 86400000
  if (days < 1 || days > 366 || array(v.trend, 366).length !== days)
    return invalid()
  if (
    c.knownSalesCents !== c.uuPayCents + c.externalCents ||
    (!c.profitComplete && profit !== null)
  )
    return invalid()
  return {
    revenueCents: revenue,
    knownExpensesCents: count(v.knownExpensesCents),
    estimatedProfitCents: profit,
    sold: count(v.sold),
    missingCostCount: count(v.missingCostCount),
    orders: {
      completed: count(orders.completed),
      pending: count(orders.pending),
      cancelled: count(orders.cancelled),
    },
    bounds: {
      start,
      end,
      observedUntil: date(b.observedUntil),
    },
    coverage: c,
    breakdown: array(v.breakdown, 4).map((x) => {
      const e = object(x)
      const name = text(e.name)
      if (!['Product Cost', 'Packaging', 'Marketing', 'Other'].includes(name))
        return invalid()
      return { name, cents: count(e.cents) }
    }),
    trend: array(v.trend, 366).map((x) => {
      const e = object(x)
      return {
        date: date(e.date, true),
        revenue: number(e.revenue, true),
        expenses: number(e.expenses, true),
        profit: number(e.profit, true),
        sold: money(e.sold, true),
        impressions: null,
        visits: null,
      }
    }),
  }
}
function product(value: unknown): ShopProductAnalysis {
  const v = object(value)
  return {
    id: text(v.id, 36),
    name: text(v.name, 500),
    image: '',
    sold: count(v.sold),
    revenueCents: count(v.revenueCents),
    costCents: money(v.costCents, true),
    directExpenseCents: 0,
    profitCents: amount(v.profitCents),
    margin: number(v.margin, true),
  }
}
/** Explicit projection: no raw private/party/provider fields escape the read boundary. */
export function projectRealShopAnalysis(
  value: unknown,
  range: ShopAnalysisRange
): RealShopAnalysis {
  const v = object(value)
  const pro = object(v.pro)
  if (
    v.source !== 'real' ||
    v.range !== range ||
    v.timezone !== 'America/Toronto' ||
    !['plus', 'pro', 'trial'].includes(String(v.access)) ||
    !['active', 'trial', 'grace'].includes(String(v.membershipStatus))
  )
    return invalid()
  const current = core(v.current)
  const previous = core(v.previous)
  return {
    source: 'real',
    range,
    timezone: 'America/Toronto',
    asOf: date(v.asOf),
    access: v.access as ShopAnalysisResponse['access'],
    membershipStatus:
      v.membershipStatus as RealShopAnalysis['membershipStatus'],
    nextBoundaryAt: date(v.nextBoundaryAt),
    current,
    previous,
    pro: {
      products: array(pro.products, 20).map(product),
      featured: null,
      promotionAvailable: false,
      topProducts: array(pro.topProducts, 5).map((x) => {
        const e = object(x)
        return { id: text(e.id, 36), name: text(e.name), sold: count(e.sold) }
      }),
      distribution: array(pro.distribution, 6).map((x) => {
        const e = object(x)
        return { name: text(e.name), cents: count(e.cents) }
      }),
    },
  }
}

import type { ShopAnalysisResponse } from '@/lib/shop-analysis'

export type AnalysisCoverage = {
  knownSalesCents: number
  uuPayCents: number
  externalCents: number
  missingProvenanceCount: number
  currencyMismatchCount: number
  invalidFactCount: number
  refundedCount: number
  excludedRefundedItemCents: number
  expiredCount: number
  authenticatedListingOpens: number
  authenticatedShopOpens: number
  productCount: number
  productLimit: number
  grossItemValueCents: number
  profitComplete: boolean
}
export type RealShopAnalysis = Omit<
  ShopAnalysisResponse,
  'current' | 'previous' | 'source'
> & {
  source: 'real'
  membershipStatus: 'active' | 'grace' | 'trial'
  nextBoundaryAt: string
  current: ShopAnalysisResponse['current'] & {
    coverage: AnalysisCoverage
    bounds: AnalysisBounds
  }
  previous: ShopAnalysisResponse['previous'] & {
    coverage: AnalysisCoverage
    bounds: AnalysisBounds
  }
}
export type AnalysisBounds = {
  start: string
  end: string
  observedUntil: string
}

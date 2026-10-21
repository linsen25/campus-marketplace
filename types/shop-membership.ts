/** Server-derived owner projection; never a request granting paid entitlement. */
export type ShopMembership = {
  evaluatedAt: string
  revision: number
  status: 'active' | 'grace' | 'suspended' | 'trial' | null
  reason: 'no_shop' | 'not_started' | null
  effectiveTier: 'plus' | 'pro' | null
  currentTermStart: string | null
  currentTermEnd: string | null
  graceEndsAt: string | null
  nextBoundaryAt: string | null
  trialClaimed: boolean
  trialEligible: boolean
  maxActiveProducts: 0 | 40 | 100
  canOperateShop: boolean
  canUseShopAnalytics: boolean
  proPromotionEligible: boolean
  accessCycleId: string | null
  scheduledTier: 'plus' | 'pro' | null
  scheduledAt: string | null
  purchaseMode: 'auto_renew' | 'one_month' | null
}

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { ShopMembership } from '@/types/shop-membership'

const unavailable = () =>
  new ListingApiError('Shop membership unavailable. Please retry.', 503)

/** Explicit field projection: no database/provider object is forwarded wholesale. */
export function projectShopMembership(input: unknown): ShopMembership {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw unavailable()
  const v = input as Record<string, unknown>
  const choice = <T extends number | string | null>(
    key: string,
    values: T[]
  ) => {
    if (!values.includes(v[key] as T)) throw unavailable()
    return v[key] as T
  }
  const text = (key: string, nullable = true): string | null => {
    const value = v[key]
    if (nullable && value === null) return null
    if (typeof value !== 'string' || !value || value.length > 80)
      throw unavailable()
    return value
  }
  const flag = (key: string): boolean => {
    if (typeof v[key] !== 'boolean') throw unavailable()
    return v[key] as boolean
  }
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 0)
    throw unavailable()
  return {
    evaluatedAt: text('evaluatedAt', false)!,
    revision: v.revision as number,
    status: choice('status', ['trial', 'active', 'grace', 'suspended', null]),
    reason: choice('reason', ['no_shop', 'not_started', null]),
    effectiveTier: choice('effectiveTier', ['plus', 'pro', null]),
    currentTermStart: text('currentTermStart'),
    currentTermEnd: text('currentTermEnd'),
    graceEndsAt: text('graceEndsAt'),
    nextBoundaryAt: text('nextBoundaryAt'),
    trialClaimed: flag('trialClaimed'),
    trialEligible: flag('trialEligible'),
    maxActiveProducts: choice('maxActiveProducts', [0, 40, 100]),
    canOperateShop: flag('canOperateShop'),
    canUseShopAnalytics: flag('canUseShopAnalytics'),
    proPromotionEligible: flag('proPromotionEligible'),
    accessCycleId: text('accessCycleId'),
    scheduledTier: choice('scheduledTier', ['plus', 'pro', null]),
    scheduledAt: text('scheduledAt'),
    purchaseMode: choice('purchaseMode', ['one_month', 'auto_renew', null]),
  }
}

function checkError(error: { code?: string } | null) {
  if (!error) return
  if (error.code === '42501')
    throw new ListingApiError('An eligible owned Shop is required.', 403)
  if (['23505', '40001'].includes(error.code || ''))
    throw new ListingApiError(
      'Trial is unavailable or membership changed.',
      409
    )
  if (['23514', '22P02'].includes(error.code || ''))
    throw new ListingApiError('Invalid Trial request.', 400)
  throw unavailable()
}

export function createShopMembershipRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  return {
    async getOwnMembership(): Promise<ShopMembership> {
      await requireMarketplaceUser(client)
      const { data, error } = await client.rpc('marketplace_shop_membership')
      checkError(error)
      return projectShopMembership(data)
    },
    async claimOwnTrial(input: unknown): Promise<ShopMembership> {
      await requireMarketplaceUser(client)
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(input, 'actionId')
      )
        throw new ListingApiError('Provide only a Trial action ID.')
      const actionId = (input as { actionId?: unknown }).actionId
      if (
        typeof actionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          actionId
        )
      )
        throw new ListingApiError('A valid Trial action ID is required.')
      const { data, error } = await client.rpc('marketplace_claim_shop_trial', {
        p_action_id: actionId,
      })
      checkError(error)
      if (data?.outcome !== 'applied') throw unavailable()
      return projectShopMembership(data.membership)
    },
  }
}

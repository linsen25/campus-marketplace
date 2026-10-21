import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { shopAnalysisRanges } from '@/lib/shop-analysis'
import type { ShopAnalysisRange } from '@/lib/shop-analysis'
import { projectRealShopAnalysis } from '@/lib/shop-analysis-validation'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export function createShopAnalysisRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  return {
    async get(range: unknown) {
      if (
        typeof range !== 'string' ||
        !shopAnalysisRanges.some((x) => x.value === range)
      )
        throw new ListingApiError('Choose a valid analysis period.')
      await requireMarketplaceUser(client)
      const { data, error } = await client.rpc('marketplace_shop_analysis', {
        p_range: range,
      })
      if (error) {
        if (error.code === '42501')
          throw new ListingApiError(
            'An eligible owned Shop is required for Analysis.',
            403
          )
        throw new ListingApiError(
          'Shop analysis is unavailable. Please retry.',
          503
        )
      }
      return projectRealShopAnalysis(data, range as ShopAnalysisRange)
    },
  }
}

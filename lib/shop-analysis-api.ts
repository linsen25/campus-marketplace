import { marketplaceRequest } from '@/lib/listings-api'
import type { ShopAnalysisRange } from '@/lib/shop-analysis'
import { projectRealShopAnalysis } from '@/lib/shop-analysis-validation'
import type { RealShopAnalysis } from '@/types/shop-analysis'

export const getShopAnalysis = (range: ShopAnalysisRange) =>
  marketplaceRequest<RealShopAnalysis>(
    `/api/shop/analysis?range=${encodeURIComponent(range)}`,
    'GET'
  ).then((data) => projectRealShopAnalysis(data, range))

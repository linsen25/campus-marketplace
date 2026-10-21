import type {
  PublicShopDirectory,
  PublicShopListingResult,
  PublicShopProducts,
  PublicShopQuery,
  PublicShopResult,
} from '@/types/shop'

export async function publicShopRequest<T>(
  path: string,
  query: PublicShopQuery,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(
    `/api/public-shops${path}${
      path.includes('?') ? '&' : '?'
    }q=${encodeURIComponent(JSON.stringify(query))}`,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal,
    }
  )
  if (!response.ok) throw new Error('Unable to load Shops. Please retry.')
  return response.json() as Promise<T>
}
export const readPublicShopDirectory = (
  query: PublicShopQuery,
  signal?: AbortSignal
) => publicShopRequest<PublicShopDirectory>('', query, signal)
export const readPublicShop = (
  username: string,
  query: PublicShopQuery,
  signal?: AbortSignal
) =>
  publicShopRequest<PublicShopResult>(
    `/${encodeURIComponent(username)}`,
    query,
    signal
  )
export const readPublicShopProducts = (
  query: PublicShopQuery,
  signal?: AbortSignal
) => publicShopRequest<PublicShopProducts>('?kind=products', query, signal)
export const readPublicShopListing = (id: string, signal?: AbortSignal) =>
  publicShopRequest<PublicShopListingResult>(
    '?kind=listing',
    { id } as PublicShopQuery,
    signal
  )

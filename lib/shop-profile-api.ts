import type { ShopIdentity } from '@/lib/shop-presentation'
import type {
  OwnerShop,
  ShopPreview,
  UpdateShopProfileInput,
} from '@/types/shop'

export class ShopProfileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ShopProfileError'
  }
}

export type ShopProfileResult = { shop: OwnerShop | null; etag: string | null }

/** The existing owner endpoint, never public discovery or provisioning. */
export async function requestOwnShop(
  patch?: UpdateShopProfileInput,
  etag?: string
): Promise<ShopProfileResult> {
  const response = await fetch('/api/shop', {
    method: patch ? 'PATCH' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Marketplace-Request': '1',
      ...(etag ? { 'If-Match': etag } : {}),
    },
    ...(patch ? { body: JSON.stringify(patch) } : {}),
  })
  const body = await response.json()
  if (!response.ok)
    throw new ShopProfileError(
      body?.error || 'Shop profile unavailable. Please retry.',
      response.status
    )
  return { shop: body, etag: response.headers.get('ETag') }
}

export function ownerShopPreview(
  shop: OwnerShop,
  username: string | null
): ShopPreview {
  return {
    sellerProfileId: shop.ownerId,
    username: username || '',
    shopName: shop.name,
    category: shop.category,
    description: shop.description,
  }
}

export function shopIdentityPatch(
  patch: Partial<ShopIdentity>
): UpdateShopProfileInput {
  return {
    ...(patch.shopName !== undefined ? { name: patch.shopName } : {}),
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description }
      : {}),
  }
}

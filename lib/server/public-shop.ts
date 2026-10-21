import { createClient } from '@supabase/supabase-js'

import { validUsername } from '@/lib/auth-username'
import { ListingApiError } from '@/lib/listing-validation'
import type { Listing } from '@/types/listing'
import type {
  PublicShopDirectory,
  PublicShopListingResult,
  PublicShopProducts,
  PublicShopQuery,
  PublicShopResult,
  ShopPreview,
} from '@/types/shop'

const unavailable = () =>
  new ListingApiError('Shop unavailable. Please retry.', 503)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw unavailable()
  return value as RecordValue
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw unavailable()
  return value
}
function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw unavailable()
  return value as number
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw unavailable()
  return value
}
function pageFields(value: RecordValue) {
  if (typeof value.hasNextPage !== 'boolean') throw unavailable()
  return {
    page: number(value.page),
    hasNextPage: value.hasNextPage,
    refreshAfterMs: Math.max(
      100,
      Math.min(30000, number(value.refreshAfterMs))
    ),
  }
}
export function shopProjection(input: unknown): ShopPreview {
  const s = record(input)
  if (
    !validUsername(s.username) ||
    !uuid.test(text(s.id)) ||
    !uuid.test(text(s.sellerProfileId))
  )
    throw unavailable()
  if (!['plus', 'pro'].includes(text(s.badgeTier))) throw unavailable()
  const image = (value: unknown) => {
    const result = text(value)
    if (
      !/^\/api\/(listing-media\/[0-9a-f-]{36}|profile\/avatar\/[0-9a-f-]{36})$/i.test(
        result
      )
    )
      throw unavailable()
    return result
  }
  return {
    id: s.id as string,
    sellerProfileId: s.sellerProfileId as string,
    username: s.username,
    shopName: text(s.shopName),
    category: text(s.category),
    description: text(s.description),
    badgeTier: s.badgeTier as 'plus' | 'pro',
    ...(s.imageUrl ? { imageUrl: image(s.imageUrl) } : {}),
    ...(s.avatarUrl ? { avatarUrl: image(s.avatarUrl) } : {}),
  }
}
export function publicShopListingProjection(input: unknown): Listing {
  const v = record(input)
  const seller = record(v.seller)
  if (
    !uuid.test(text(v.id)) ||
    !uuid.test(text(seller.id)) ||
    v.listingChannel !== 'shop' ||
    v.status !== 'available' ||
    v.currency !== 'CAD'
  )
    throw unavailable()
  const photos = list(v.photoUrls).map((url) => {
    if (!/^\/api\/listing-media\/[0-9a-f-]{36}$/i.test(text(url)))
      throw unavailable()
    return url as string
  })
  return {
    id: v.id as string,
    listingChannel: 'shop',
    title: text(v.title),
    description: text(v.description),
    price: number(v.price),
    currency: 'CAD',
    category: text(v.category) as Listing['category'],
    subcategory: text(v.subcategory) as Listing['subcategory'],
    ...(v.condition
      ? { condition: text(v.condition) as Listing['condition'] }
      : {}),
    preferredPaymentMode: text(
      v.preferredPaymentMode
    ) as Listing['preferredPaymentMode'],
    preferredFulfillment: text(
      v.preferredFulfillment
    ) as Listing['preferredFulfillment'],
    meetingLocation: v.meetingLocation
      ? { label: text(record(v.meetingLocation).label) }
      : null,
    estimatedDeliveryFeeCents: number(v.estimatedDeliveryFeeCents),
    photoUrls: photos,
    status: 'available',
    seller: { id: seller.id as string, displayName: text(seller.displayName) },
    createdAt: text(v.createdAt),
    updatedAt: text(v.updatedAt),
    publishedAt: text(v.publishedAt),
  }
}
// Anonymous even for signed-in owners. No cookies or privileged client.
async function rpc(name: string, args: RecordValue) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw unavailable()
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { data, error } = await client.rpc(name, args)
  if (error) {
    if (['23514', '22P02'].includes(error.code))
      throw new ListingApiError('Invalid public Shop query.', 400)
    throw unavailable()
  }
  return record(data)
}
export async function getPublicShops(
  query: PublicShopQuery = {}
): Promise<PublicShopDirectory> {
  const r = await rpc('marketplace_public_shops', { p_query: query })
  return { shops: list(r.shops).map(shopProjection), ...pageFields(r) }
}
export async function getPublicShop(
  username: string,
  query: PublicShopQuery = {}
): Promise<PublicShopResult> {
  if (!validUsername(username)) return { state: 'not_found' }
  const r = await rpc('marketplace_public_shop', {
    p_username: username,
    p_query: query,
  })
  if (r.state === 'unavailable' || r.state === 'not_found')
    return { state: r.state }
  if (r.state !== 'available') throw unavailable()
  return {
    state: 'available',
    shop: shopProjection(r.shop),
    listings: list(r.listings).map(publicShopListingProjection),
    ...pageFields(r),
  }
}
export async function getPublicShopProducts(
  query: PublicShopQuery & { username?: string; category?: string } = {}
): Promise<PublicShopProducts> {
  const r = await rpc('marketplace_public_shop_products', { p_query: query })
  if (r.state !== 'available')
    throw new ListingApiError('This shop is temporarily unavailable.', 404)
  return {
    state: 'available',
    listings: list(r.listings).map(publicShopListingProjection),
    ...pageFields(r),
  }
}
export async function getPublicShopListing(
  id: string
): Promise<PublicShopListingResult> {
  if (!uuid.test(id)) return { state: 'not_found' }
  const r = await rpc('marketplace_public_shop_products', { p_query: { id } })
  if (r.state === 'unavailable' || r.state === 'not_found')
    return { state: r.state }
  if (r.state !== 'available') throw unavailable()
  return {
    state: 'available',
    listing: publicShopListingProjection(r.listing),
    refreshAfterMs: Math.max(100, Math.min(30000, number(r.refreshAfterMs))),
  }
}

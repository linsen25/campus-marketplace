import type { Listing } from '@/types/listing'

export type ListingRow = {
  id: string
  seller_id: string
  title: string
  description: string
  price_cents: number
  currency: 'CAD'
  category: Listing['category']
  condition: Listing['condition'] | null
  pickup_area: string
  status: Listing['status']
  created_at: string
  updated_at: string
  profiles: { id: string; display_name: string }
  listing_images: Array<{ path: string; slot: number; ready: boolean }>
}

export function mapListing(
  row: ListingRow,
  publicImageUrl: (path: string) => string
): Listing {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price_cents,
    currency: row.currency,
    category: row.category,
    ...(row.condition ? { condition: row.condition } : {}),
    pickupArea: row.pickup_area,
    status: row.status,
    photoUrls: row.listing_images
      .filter((image) => image.ready)
      .sort((a, b) => a.slot - b.slot)
      .map((image) => publicImageUrl(image.path)),
    seller: { id: row.profiles.id, displayName: row.profiles.display_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

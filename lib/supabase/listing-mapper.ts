import type { Listing } from '@/types/listing'

export type ListingRow = {
  id: string
  seller_id: string
  title: string
  description: string
  price_cents: number
  currency: 'CAD'
  category: Listing['category']
  subcategory: Listing['subcategory']
  condition: Listing['condition'] | null
  pickup_area: string | null
  estimated_delivery_fee_cents?: number | null
  preferred_fulfillment?: 'DELIVERY' | 'ON_CAMPUS'
  meeting_location?: string | null
  meeting_location_provider?: 'google' | null
  meeting_place_id?: string | null
  status: Listing['status']
  created_at: string
  updated_at: string
  published_at: string | null
  expected_image_count: number
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
    subcategory: row.subcategory,
    ...(row.condition ? { condition: row.condition } : {}),
    pickupArea: row.pickup_area ?? undefined,
    estimatedDeliveryFeeCents: row.estimated_delivery_fee_cents ?? 0,
    preferredFulfillment: row.preferred_fulfillment ?? 'ON_CAMPUS',
    meetingLocation: row.meeting_location
      ? {
          label: row.meeting_location,
          ...(row.meeting_location_provider === 'google' && row.meeting_place_id
            ? { provider: 'google', placeId: row.meeting_place_id }
            : {}),
        }
      : null,
    status: row.status,
    photoUrls: row.listing_images
      .filter((image) => image.ready)
      .sort((a, b) => a.slot - b.slot)
      .map((image) => publicImageUrl(image.path)),
    seller: { id: row.profiles.id, displayName: row.profiles.display_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    expectedImageCount: row.expected_image_count,
  }
}

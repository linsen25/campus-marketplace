import { TEST_PICTURES } from '@/lib/fixtures/test-pictures'
import type { ShopCategory } from '@/lib/shop-directory'
import type { Listing } from '@/types/listing'

import type { ShopCardVisual } from './shop-card-presentation'

/** Local prototype fixtures. Never public Shop, membership, review or Listing authority. */
export const lunaStudioDemo: ShopCardVisual & {
  id: string
  image: string
  category: ShopCategory
  productCount: number
  about: string
} = {
  id: 'demo-luna',
  name: 'Luna Studio',
  category: 'Art, Crafts & Gifts',
  tagline: 'Handmade jewelry & accessories',
  image: TEST_PICTURES.jewelry,
  verified: true,
  figures: { rating: '4.9', reviews: 24, sold: 68 },
  productCount: 12,
  about:
    'Handmade accessories made by a Western student. Each piece is carefully designed and crafted. Available for campus pickup.',
}
export const demoShopLoading = { skeletonAfterMs: 120, readyAfterMs: 480 }
const rows = [
  ['Wooden accent chair', 4500, 'Home & Living', TEST_PICTURES.chair],
  ['Beaded accessories', 1800, 'Jewelry', TEST_PICTURES.bracelet],
  ['Statement Necklace', 2500, 'Jewelry', TEST_PICTURES.jewelry],
  ['Crochet Bunny', 2200, 'Gifts & Crafts', TEST_PICTURES.crochetBunny],
  ['Protective Phone Case', 2000, 'Accessories', TEST_PICTURES.phoneCase],
  ['Canvas Tote Bag', 2800, 'Bags', TEST_PICTURES.toteBag],
  ['Marble vanity tray', 1600, 'Home & Living', TEST_PICTURES.decorativeTray],
  ['Pair of candles', 2400, 'Home & Living', TEST_PICTURES.candle],
  ['Hanging jewelry collection', 1900, 'Jewelry', TEST_PICTURES.bracelet],
  ['Ceramic mug', 1200, 'Home & Living', TEST_PICTURES.mug],
  ['Clothing rack', 1500, 'Accessories', TEST_PICTURES.clothingDisplay],
  ['Decorative Catchall', 2300, 'Gifts & Crafts', TEST_PICTURES.decorativeTray],
] as const
export const demoShopProducts: ReadonlyArray<{
  listing: Listing
  categoryLabel: string
}> = rows.map(([title, price, categoryLabel, image], index) => ({
  categoryLabel,
  listing: {
    id: `local-demo-luna-product-${index + 1}`,
    listingChannel: 'shop',
    title,
    price,
    currency: 'CAD',
    category: index === 0 ? 'Home & Dorm' : 'Clothing & Accessories',
    subcategory: index === 0 ? 'Furniture' : 'Accessories',
    condition: index === 0 ? 'good' : 'new',
    description:
      'Illustrative local demo product and image. No live Listing or transaction is available.',
    photoUrls: [image],
    seller: { id: lunaStudioDemo.id, displayName: lunaStudioDemo.name },
    status: 'available',
    createdAt: new Date(Date.UTC(2026, 9, 17, 12, -index)).toISOString(),
    updatedAt: '2026-10-17T12:00:00Z',
  },
}))

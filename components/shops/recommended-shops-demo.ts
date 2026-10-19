import { TEST_PICTURES } from '@/lib/fixtures/test-pictures'
import type { ShopCategory } from '@/lib/shop-directory'

import type { ShopCardVisual } from './shop-card-presentation'
import { lunaStudioDemo } from './shop-demo-data'

/** Illustrative discovery fixtures only; never public Shop or membership authority. */
export const recommendedShopsDemo: ReadonlyArray<
  ShopCardVisual & {
    image: string
    id: string
    category: ShopCategory
  }
> = [
  lunaStudioDemo,
  {
    id: 'demo-maple',
    name: 'Maple Corner',
    category: 'Home & Dorm',
    tagline: 'Home & Living',
    image: TEST_PICTURES.chair,
    verified: true,
    figures: { rating: '4.8', reviews: 18, sold: 42 },
  },
  {
    id: 'demo-tech',
    name: 'Campus Tech',
    category: 'Tech & Electronics',
    tagline: 'Electronics & accessories',
    image: TEST_PICTURES.workspace,
    verified: true,
    figures: { rating: '4.7', reviews: 12, sold: 35 },
  },
  {
    id: 'demo-story',
    name: 'Second Story',
    category: 'Books & Stationery',
    tagline: 'Books & collectibles',
    image: TEST_PICTURES.bookshelf,
    verified: true,
    figures: { rating: '4.9', reviews: 31, sold: 96 },
  },
  {
    id: 'demo-thread',
    name: 'Studio Thread',
    category: 'Fashion & Accessories',
    tagline: 'Clothing & handmade pieces',
    image: TEST_PICTURES.clothingDisplay,
    verified: true,
    figures: { rating: '4.8', reviews: 22, sold: 57 },
  },
]

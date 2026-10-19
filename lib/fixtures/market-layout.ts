import type { MarketCategory } from '@/lib/market-taxonomy'
import { marketConditions, marketLocations } from '@/lib/market-taxonomy'

import { TEST_PICTURES } from './test-pictures'

export type MarketPreviewListing = {
  id: string
  title: string
  description: string
  price: number // Integer CAD cents, matching the real listing model.
  category: MarketCategory
  subcategory: string
  condition: typeof marketConditions[number]
  location: typeof marketLocations[number]
  images: string[]
  sellerUsername: string
  createdAt: string
  status: 'available'
}
// Explicit local-only subjects and images; never inferred from real titles.
const items: Array<[string, number, MarketCategory, string, string]> = [
  [
    'Laptop and study essentials',
    52000,
    'Electronics',
    'Computers & Tablets',
    TEST_PICTURES.laptop,
  ],
  ['24-inch monitor', 9500, 'Electronics', 'Monitors', TEST_PICTURES.monitor],
  [
    'Compact keyboard',
    4500,
    'Electronics',
    'Cables & Accessories',
    TEST_PICTURES.keyboard,
  ],
  [
    'Wireless headphones',
    6000,
    'Electronics',
    'Audio & Headphones',
    TEST_PICTURES.headphones,
  ],
  ['Desk workspace', 7000, 'Home & Dorm', 'Furniture', TEST_PICTURES.workspace],
  ['Office chair', 4500, 'Home & Dorm', 'Furniture', TEST_PICTURES.deskChair],
  [
    'Desk lamp',
    1500,
    'Home & Dorm',
    'Lighting & Decor',
    TEST_PICTURES.deskLamp,
  ],
  [
    'Portable speaker',
    4000,
    'Electronics',
    'Audio & Headphones',
    TEST_PICTURES.speaker,
  ],
  ['Ceramic mug', 2500, 'Home & Dorm', 'Kitchen & Dining', TEST_PICTURES.mug],
  [
    'Decorative tray',
    3000,
    'Home & Dorm',
    'Lighting & Decor',
    TEST_PICTURES.decorativeTray,
  ],
  [
    'Study book bundle',
    3500,
    'Textbooks & School',
    'Textbooks',
    TEST_PICTURES.textbook,
  ],
  [
    'Scientific calculator',
    2000,
    'Textbooks & School',
    'Calculators',
    TEST_PICTURES.calculator,
  ],
  [
    'Campus backpack',
    2800,
    'Textbooks & School',
    'Backpacks',
    TEST_PICTURES.backpack,
  ],
  [
    'Winter jacket',
    6500,
    'Clothing & Accessories',
    'Outerwear',
    TEST_PICTURES.jacket,
  ],
  [
    'Canvas sneakers',
    3000,
    'Clothing & Accessories',
    'Shoes',
    TEST_PICTURES.sneakers,
  ],
  ['Camera', 4000, 'Electronics', 'Cameras', TEST_PICTURES.camera],
  [
    'Wooden accent chair',
    5500,
    'Home & Dorm',
    'Furniture',
    TEST_PICTURES.chair,
  ],
  ['Commuter bike', 18000, 'Bikes & Mobility', 'Bikes', TEST_PICTURES.bicycle],
  [
    'Potted plant',
    1200,
    'Home & Dorm',
    'Lighting & Decor',
    TEST_PICTURES.plant,
  ],
  [
    'Protective phone case',
    2100,
    'Electronics',
    'Phones & Accessories',
    TEST_PICTURES.phoneCase,
  ],
  [
    'Wireless controller',
    3500,
    'Electronics',
    'Gaming & Consoles',
    TEST_PICTURES.controller,
  ],
  [
    'Crochet bunny',
    2200,
    'Games & Hobbies',
    'Arts & Crafts',
    TEST_PICTURES.crochetBunny,
  ],
  [
    'Beaded accessories',
    2500,
    'Clothing & Accessories',
    'Accessories',
    TEST_PICTURES.bracelet,
  ],
  [
    'Pair of candles',
    0,
    'Home & Dorm',
    'Lighting & Decor',
    TEST_PICTURES.candle,
  ],
  [
    'Stationery kit',
    1500,
    'Textbooks & School',
    'Stationery',
    TEST_PICTURES.stationery,
  ],
  [
    'Clothing rack',
    3000,
    'Clothing & Accessories',
    'Tops & Bottoms',
    TEST_PICTURES.clothingDisplay,
  ],
  [
    'Gaming mouse',
    2200,
    'Electronics',
    'Cables & Accessories',
    TEST_PICTURES.mouse,
  ],
  [
    'Bookshelf collection',
    0,
    'Games & Hobbies',
    'Books & Media',
    TEST_PICTURES.bookshelf,
  ],
  [
    'Canvas tote bag',
    1000,
    'Clothing & Accessories',
    'Bags',
    TEST_PICTURES.toteBag,
  ],
  [
    'Statement necklace',
    0,
    'Clothing & Accessories',
    'Accessories',
    TEST_PICTURES.jewelry,
  ],
]
export const marketPreviewListings: MarketPreviewListing[] = items.map(
  ([title, price, category, subcategory, image], index) => ({
    id: `market-preview-${index + 1}`,
    title,
    description: `${title}, ready for another student to use. Pickup can be arranged nearby. This is an illustrative listing for the Market layout preview.`,
    price,
    category,
    subcategory,
    condition: marketConditions[index % marketConditions.length],
    location: marketLocations[index % marketLocations.length],
    images: [image],
    sellerUsername: ['CampusChris', 'StudySam', 'WesternAlex'][index % 3],
    createdAt: new Date(
      Date.UTC(2026, 9, 3, 12) - index * 3600000
    ).toISOString(),
    status: 'available',
  })
)

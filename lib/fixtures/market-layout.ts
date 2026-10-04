import type { MarketCategory } from '@/lib/market-taxonomy'
import { marketConditions, marketLocations } from '@/lib/market-taxonomy'

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
const items: Array<[string, number, MarketCategory, string]> = [
  ['MacBook Air M1', 52000, 'Electronics', 'Computers & Tablets'],
  ['24-inch monitor', 9500, 'Electronics', 'Monitors'],
  ['Mechanical keyboard', 4500, 'Electronics', 'Cables & Accessories'],
  ['Wireless headphones', 6000, 'Electronics', 'Audio & Headphones'],
  ['Compact writing desk', 7000, 'Home & Dorm', 'Furniture'],
  ['Office chair', 4500, 'Home & Dorm', 'Furniture'],
  ['Desk lamp', 1500, 'Home & Dorm', 'Lighting & Decor'],
  ['Air fryer', 4000, 'Home & Dorm', 'Small Appliances'],
  ['Rice cooker', 2500, 'Home & Dorm', 'Small Appliances'],
  ['Cookware set', 3000, 'Home & Dorm', 'Kitchen & Dining'],
  ['Calculus textbook', 3500, 'Textbooks & School', 'Textbooks'],
  ['TI scientific calculator', 2000, 'Textbooks & School', 'Calculators'],
  ['Campus backpack', 2800, 'Textbooks & School', 'Backpacks'],
  ['Winter jacket', 6500, 'Clothing & Accessories', 'Outerwear'],
  ['Running shoes', 3000, 'Clothing & Accessories', 'Shoes'],
  ['Pair of dumbbells', 4000, 'Sports & Outdoors', 'Fitness & Gym'],
  ['Hockey skates', 5500, 'Sports & Outdoors', 'Winter Sports'],
  ['Commuter bike', 18000, 'Bikes & Mobility', 'Bikes'],
  ['Bike lock', 1200, 'Bikes & Mobility', 'Locks & Lights'],
  ['Nintendo Switch', 21000, 'Electronics', 'Gaming & Consoles'],
  ['Wireless controller', 3500, 'Electronics', 'Gaming & Consoles'],
  ['Acoustic guitar', 9000, 'Games & Hobbies', 'Musical Instruments'],
  ['Catan board game', 2500, 'Games & Hobbies', 'Board Games'],
  ['Storage baskets', 0, 'Home & Dorm', 'Storage & Organization'],
  ['Chemistry lab coat', 1500, 'Textbooks & School', 'Lab & Art Supplies'],
  ['Camping sleeping bag', 3000, 'Sports & Outdoors', 'Camping & Outdoors'],
  ['Bike helmet', 2200, 'Bikes & Mobility', 'Helmets & Safety'],
  ['Paperback book bundle', 0, 'Games & Hobbies', 'Books & Media'],
  ['Canvas tote bag', 1000, 'Clothing & Accessories', 'Bags'],
  ['Moving boxes', 0, 'Other', 'Other'],
]
export const marketPreviewListings: MarketPreviewListing[] = items.map(
  ([title, price, category, subcategory], index) => ({
    id: `market-preview-${index + 1}`,
    title,
    description: `${title}, ready for another student to use. Pickup can be arranged nearby. This is an illustrative listing for the Market layout preview.`,
    price,
    category,
    subcategory,
    condition: marketConditions[index % marketConditions.length],
    location: marketLocations[index % marketLocations.length],
    images: ['/demo/reading-chair.jpg'],
    sellerUsername: ['CampusChris', 'StudySam', 'WesternAlex'][index % 3],
    createdAt: new Date(
      Date.UTC(2026, 9, 3, 12) - index * 3600000
    ).toISOString(),
    status: 'available',
  })
)

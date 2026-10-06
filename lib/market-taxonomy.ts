// Canonical persisted marketplace taxonomy. Keep the SQL pair constraint in sync.
export const marketTaxonomy = {
  Electronics: [
    'Computers & Tablets',
    'Phones & Accessories',
    'Monitors',
    'Audio & Headphones',
    'Gaming & Consoles',
    'Cameras',
    'Cables & Accessories',
  ],
  'Home & Dorm': [
    'Furniture',
    'Kitchen & Dining',
    'Small Appliances',
    'Bedding & Bath',
    'Storage & Organization',
    'Lighting & Decor',
    'Cleaning',
  ],
  'Textbooks & School': [
    'Textbooks',
    'Calculators',
    'Stationery',
    'School Supplies',
    'Lab & Art Supplies',
    'Backpacks',
  ],
  'Clothing & Accessories': [
    'Tops & Bottoms',
    'Outerwear',
    'Shoes',
    'Bags',
    'Accessories',
    'Formalwear',
  ],
  'Sports & Outdoors': [
    'Fitness & Gym',
    'Team Sports',
    'Racket Sports',
    'Winter Sports',
    'Camping & Outdoors',
    'Other Sports',
  ],
  'Bikes & Mobility': [
    'Bikes',
    'E-bikes & Scooters',
    'Skateboards',
    'Helmets & Safety',
    'Locks & Lights',
    'Parts & Accessories',
  ],
  'Games & Hobbies': [
    'Video Games',
    'Board Games',
    'Musical Instruments',
    'Books & Media',
    'Arts & Crafts',
    'Collectibles',
  ],
  Other: ['Other'],
} as const
export type MarketCategory = keyof typeof marketTaxonomy
export const marketCategories = Object.keys(marketTaxonomy) as MarketCategory[]
export const marketLocations = ['On campus', 'Near campus', 'Other'] as const
export const marketConditions = ['New', 'Like new', 'Good', 'Fair'] as const
export const marketSorts = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
] as const

export type MarketSubcategory = typeof marketTaxonomy[MarketCategory][number]

export function isMarketCategory(value: unknown): value is MarketCategory {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(marketTaxonomy, value)
  )
}

export function isMarketSubcategory(
  value: unknown
): value is MarketSubcategory {
  return (
    typeof value === 'string' &&
    Object.values(marketTaxonomy).some((children) =>
      (children as readonly string[]).includes(value)
    )
  )
}

export function isMarketPair(category: unknown, subcategory: unknown): boolean {
  return (
    isMarketCategory(category) &&
    typeof subcategory === 'string' &&
    (marketTaxonomy[category] as readonly string[]).includes(subcategory)
  )
}

export function marketSubcategoryOptions(category: unknown) {
  return isMarketCategory(category)
    ? marketTaxonomy[category].map((value) => ({ value, label: value }))
    : []
}

/** A child filter always requires its canonical parent; neither is also valid. */
export function isMarketFilterPair(
  category: unknown,
  subcategory: unknown
): boolean {
  if (category === undefined) return subcategory === undefined
  if (!isMarketCategory(category)) return false
  return subcategory === undefined || isMarketPair(category, subcategory)
}

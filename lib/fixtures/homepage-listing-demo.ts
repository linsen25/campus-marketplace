import type { Listing } from '@/types/listing'

type HomepageListingShowcase = Pick<
  Listing,
  | 'category'
  | 'condition'
  | 'description'
  | 'photoUrls'
  | 'price'
  | 'subcategory'
  | 'title'
> & {
  seller: Pick<Listing['seller'], 'displayName'> & {
    westernEmailVerified: boolean
  }
}

// Local showcase only. Verification is not a field returned by listings-api.
// Never pass this fixture to Supabase, Favorites or Messages.
export const homepageListingDemo: HomepageListingShowcase = {
  title: 'Woven accent chair',
  price: 4500,
  photoUrls: ['/demo/reading-chair.jpg'],
  category: 'Home & Dorm',
  subcategory: 'Furniture',
  condition: 'good',
  seller: { displayName: 'Alex', westernEmailVerified: true },
  description:
    "Used for about a year and still in good condition. Selling because I'm moving.",
}

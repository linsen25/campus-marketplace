import { ListingCard } from '@/components/listings/listing-card'
import type { Listing } from '@/types/listing'

export type ListingGridProps = {
  listings: Listing[]
}

export function ListingGrid({ listings }: ListingGridProps) {
  return (
    <section className="w-full" aria-label="Marketplace listings">
      <ol className="grid grid-cols-2 gap-2 tablet:grid-cols-3 laptop:grid-cols-5">
        {listings.map((listing) => (
          <li key={listing.id}>
            <ListingCard listing={listing} />
          </li>
        ))}
      </ol>
    </section>
  )
}

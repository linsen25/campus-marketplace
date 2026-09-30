import classNames from 'classnames'

import { ProductImage } from '@/components/product/product-image'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'
import { Link } from '@ui/link/link'

export type ListingCardProps = {
  listing: Listing
}

export function ListingCard({ listing }: ListingCardProps) {
  const photo = listing.photoUrls[0]

  return (
    <article
      className={classNames(
        'w-full h-full relative border border-transparent transition-all laptop:p-3 group can-hover:laptop:hover:shadow-sm can-hover:laptop:hover:border-neutral-light',
        { 'opacity-50': listing.status === 'sold' }
      )}
    >
      <Link
        href={`/listings/${encodeURIComponent(listing.id)}`}
        className="flex gap-2 flex-col focus-visible:outline focus-visible:outline-2"
        aria-label={`View ${listing.title}`}
      >
        <div className="relative">
          {photo ? (
            <ProductImage src={photo} alt={listing.title} />
          ) : (
            <div className="bg-neutral-lightest aspect-[20/27] flex items-center justify-center">
              <span className="text-neutral-dark text-xs">
                No photo available
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <header className="flex flex-col gap-1">
            <h2 className="text-brand-black small-bold tracking-normal">
              {listing.title}
            </h2>
            <p className="text-neutral-darkest tag-bold tracking-normal">
              {listing.pickupArea}
            </p>
          </header>
          <footer className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 italic">
              <span className="text-venus-base font-bold">
                {formatListingPrice(listing.price)}
              </span>
            </div>
            {listing.status === 'sold' && (
              <span className="text-neutral-darkest tag-bold tracking-normal">
                Sold
              </span>
            )}
          </footer>
        </div>
      </Link>
    </article>
  )
}

import classNames from 'classnames'
import Image from 'next/image'

import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'
import { Link } from '@ui/link/link'

import styles from './listing-card.module.css'

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
        <div
          className={`${styles.photo} relative overflow-hidden bg-neutral-lightest`}
        >
          {photo ? (
            <Image
              src={photo}
              alt={listing.title}
              layout="fill"
              objectFit="cover"
              sizes="(max-width: 767px) 50vw, (max-width: 1439px) 33vw, 20vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-neutral-dark text-xs">
                No photo available
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <header className="flex flex-col gap-1">
            <h2
              className={`${styles.title} text-brand-black small-bold tracking-normal`}
            >
              {listing.title}
            </h2>
            <p className="text-neutral-darkest text-xs leading-tight tracking-normal break-words">
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

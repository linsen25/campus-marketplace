import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { BackButton } from '@/components/listings/back-button'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { useListingOfferContext } from '@/components/listings/use-listing-offer-context'
import { useMessageSeller } from '@/components/listings/use-message-seller'
import { ProductImage } from '@/components/product/product-image'
import { usePublicShopRead } from '@/hooks/use-public-shop-read'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import { ListingApiError } from '@/lib/listing-validation'
import { getListing } from '@/lib/listings-api'
import { readPublicShopListing } from '@/lib/public-shop-api'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'
import { Button } from '@ui/button/button'

type ListingPageProps = {
  listing: Listing | null
  error?: string
}

export default function ListingPage(props: ListingPageProps) {
  return props.listing?.listingChannel === 'shop' ? (
    <PublicShopListingPage listing={props.listing} />
  ) : (
    <ListingContent {...props} />
  )
}
function PublicShopListingPage({ listing }: { listing: Listing }) {
  const result = usePublicShopRead(
    listing.id,
    (signal) => readPublicShopListing(listing.id, signal),
    { state: 'available' as const, listing, refreshAfterMs: 30000 }
  )
  if (result.data?.state === 'available')
    return <ListingContent listing={result.data.listing} />
  let message = 'Listing not found.'
  if (result.data?.state === 'unavailable')
    message = 'This shop is temporarily unavailable.'
  if (result.loading) message = 'Loading Listing...'
  if (result.error) message = result.error
  return (
    <main className="py-8">
      <Container>
        <p role="status">{message}</p>
        {result.error && (
          <button type="button" onClick={() => result.retry()}>
            Retry
          </button>
        )}
      </Container>
    </main>
  )
}
function ListingContent({ listing, error }: ListingPageProps) {
  const { seller } = useMarketplaceSession()
  const own = seller?.id === listing?.seller.id
  const messaging = useMessageSeller(listing?.id || '')
  const offerContext = useListingOfferContext(
    listing?.id || '',
    listing?.seller.id || '',
    listing?.listingChannel !== 'shop'
  )
  if (!listing)
    return (
      <main className="py-8">
        <Container>
          <p role="alert">{error}</p>
        </Container>
      </main>
    )
  const category = listingCategories.find(
    (item) => item.value === listing.category
  )?.label
  const condition = listingConditions.find(
    (item) => item.value === listing.condition
  )?.label

  return (
    <>
      <Head>
        <title>{`${listing.title} | Usual & Unusual`}</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <BackButton href="/listings" />
            <article className="grid min-w-0 grid-cols-1 items-start gap-6 tablet:grid-cols-2">
              <div
                className="grid min-w-0 grid-cols-1 gap-2"
                aria-label="Listing photos"
              >
                {listing.photoUrls.length > 0 ? (
                  Array.from(new Set(listing.photoUrls)).map((photo, index) => (
                    <ProductImage
                      key={photo}
                      src={photo}
                      alt={`${listing.title}, photo ${index + 1}`}
                    />
                  ))
                ) : (
                  <div className="bg-neutral-lightest aspect-[20/27] flex items-center justify-center">
                    <span className="text-neutral-dark">
                      No photo available
                    </span>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-6 break-words">
                <header className="flex flex-col gap-2">
                  <p className="tag-bold text-neutral-darkest">
                    {listing.status === 'sold' ? 'SOLD' : 'Available'}
                  </p>
                  <h1 className="text-2xl font-bold">{listing.title}</h1>
                  <p className="text-venus-base font-bold italic">
                    {formatListingPrice(listing.price)}
                  </p>
                </header>
                <dl className="grid grid-cols-2 gap-2">
                  <dt className="small-bold">Category</dt>
                  <dd>
                    {category} / {listing.subcategory}
                  </dd>
                  <dt className="small-bold">Condition</dt>
                  <dd>{condition || 'Not specified'}</dd>
                  <dt className="small-bold">Pickup area</dt>
                  <dd>{listing.pickupArea}</dd>
                  <dt className="small-bold">Seller</dt>
                  <dd>{listing.seller.displayName}</dd>
                </dl>
                <section className="flex flex-col gap-2">
                  <h2 className="small-bold">Description</h2>
                  <p className="whitespace-pre-line">{listing.description}</p>
                </section>
                <div className="flex flex-col items-start gap-2">
                  {!own && listing.listingChannel !== 'shop' && (
                    <Button
                      type="primary"
                      size="large"
                      disabled={messaging.busy}
                      onClick={() => messaging.contact()}
                    >
                      Message Seller
                    </Button>
                  )}
                  {!own &&
                    listing.listingChannel !== 'shop' &&
                    offerContext.enabled && (
                      <div className="flex flex-col items-start gap-2">
                        <Button
                          type="primary"
                          size="large"
                          disabled={offerContext.busy || offerContext.disabled}
                          onClick={() => offerContext.open()}
                        >
                          {offerContext.label}
                        </Button>
                        {offerContext.reason && (
                          <p className="text-neutral-dark text-sm">
                            {offerContext.reason}
                          </p>
                        )}
                      </div>
                    )}
                  {messaging.error && <p role="alert">{messaging.error}</p>}
                  {offerContext.error && (
                    <p role="alert">{offerContext.error}</p>
                  )}
                </div>
              </div>
            </article>
          </div>
        </Container>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<ListingPageProps> = async ({
  params,
  req,
  res,
}) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  const id = params?.id
  if (typeof id !== 'string') return { notFound: true }
  let listing: Listing | null
  try {
    listing = await getListing(id, { req, res })
  } catch (error) {
    if (
      error instanceof ListingApiError &&
      error.message === 'This shop is temporarily unavailable.'
    )
      return { props: { listing: null, error: error.message } }
    // eslint-disable-next-line no-param-reassign -- Set the HTTP status for the SSR error page.
    res.statusCode = 503
    return {
      props: {
        listing: null,
        error: 'Marketplace unavailable. Check Supabase setup and try again.',
      },
    }
  }
  if (!listing) return { notFound: true }
  return { props: { listing } }
}

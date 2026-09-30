import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { ListingFilters } from '@/components/listings/listing-filters'
import { ListingGrid } from '@/components/listings/listing-grid'
import type { ListingFilterValues } from '@/lib/listing-filters'
import { parseListingFilters } from '@/lib/listing-filters'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'
import { Link } from '@ui/link/link'

type HomeProps = {
  listings: Listing[]
  error: string | null
  values: ListingFilterValues
}

export default function Home({ listings, error, values }: HomeProps) {
  return (
    <>
      <Head>
        <title>Campus Marketplace</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-3">
              <h1 className="text-2xl font-bold">Campus Marketplace</h1>
              <p>Buy and sell second-hand items in the Western community.</p>
            </header>
            <ListingFilters values={values} />
            <section
              aria-labelledby="latest-listings"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="latest-listings" className="text-xl font-bold">
                  {values.status === 'available' &&
                  !values.search &&
                  !values.category
                    ? 'Latest available listings'
                    : 'Listings'}
                </h2>
                <Link href="/listings" className="underline">
                  Browse all listings
                </Link>
              </div>
              {error && <p role="alert">{error}</p>}
              {!error && listings.length > 0 && (
                <ListingGrid listings={listings} />
              )}
              {!error && listings.length === 0 && (
                <p>
                  No listings match this view. Try another search or clear the
                  filters.
                </p>
              )}
            </section>
            <section
              className="flex flex-col items-start gap-3"
              aria-label="Sell an item"
            >
              <h2 className="text-xl font-bold">
                Have something you no longer need?
              </h2>
              <Link href="/listings/new" className="btn btn-primary btn-small">
                Sell an item
              </Link>
            </section>
          </div>
        </Container>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async ({
  req,
  res,
  query: params,
}) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  const { values, query, error } = parseListingFilters(params || {})
  try {
    const listings = error
      ? []
      : await getListings({ ...query, page: 1, pageSize: 10 }, { req, res })
    return { props: { listings, error, values } }
  } catch {
    // eslint-disable-next-line no-param-reassign -- Return a retryable marketplace error.
    res.statusCode = 503
    return {
      props: {
        listings: [],
        values,
        error: 'Marketplace unavailable. Please try again shortly.',
      },
    }
  }
}

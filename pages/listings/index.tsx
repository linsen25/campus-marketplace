import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { ListingFilters } from '@/components/listings/listing-filters'
import { ListingGrid } from '@/components/listings/listing-grid'
import { MarketplaceActions } from '@/components/listings/marketplace-actions'
import type { ListingFilterValues } from '@/lib/listing-filters'
import { parseListingFilters } from '@/lib/listing-filters'
import { ListingApiError } from '@/lib/listing-validation'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'

type ListingsPageProps = {
  listings: Listing[]
  values: ListingFilterValues
  error: string | null
}

export default function ListingsPage({
  listings,
  values,
  error,
}: ListingsPageProps) {
  return (
    <>
      <Head>
        <title>Student marketplace | Spencer and Williams</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Student marketplace</h1>
              <p>Find available items for pickup near campus.</p>
              <MarketplaceActions />
            </header>
            <ListingFilters key={JSON.stringify(values)} values={values} />
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <>
                <p role="status">
                  {listings.length} available{' '}
                  {listings.length === 1 ? 'listing' : 'listings'}
                </p>
                {listings.length > 0 ? (
                  <ListingGrid listings={listings} />
                ) : (
                  <p>
                    No listings match your filters. Try another search or clear
                    the filters.
                  </p>
                )}
              </>
            )}
          </div>
        </Container>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<
  ListingsPageProps
> = async ({ query: params, req, res }) => {
  const { values, query, error } = parseListingFilters(params)
  try {
    const listings = error ? [] : await getListings(query, { req, res })
    return { props: { listings, values, error } }
  } catch (cause) {
    // eslint-disable-next-line no-param-reassign -- Set the HTTP status for the SSR error page.
    res.statusCode = 503
    return {
      props: {
        listings: [],
        values,
        error:
          cause instanceof ListingApiError
            ? cause.message
            : 'Marketplace unavailable. Please try again.',
      },
    }
  }
}

import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { MarketLayout } from '@/components/listings/market-layout'
import type { ListingFilterValues } from '@/lib/listing-filters'
import { parseListingFilters } from '@/lib/listing-filters'
import { ListingApiError } from '@/lib/listing-validation'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'

type ListingsPageProps = {
  listings: Listing[]
  values: ListingFilterValues
  error: string | null
  page: number
  hasNextPage: boolean
}

export default function ListingsPage({
  values,
  listings,
  error,
}: ListingsPageProps) {
  return (
    <>
      <Head>
        <title>Market | Campus Marketplace</title>
      </Head>
      <MarketLayout
        values={values}
        initialListings={listings}
        initialError={error}
      />
    </>
  )
}
export const getServerSideProps: GetServerSideProps<
  ListingsPageProps
> = async ({ query: params, req, res }) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  const { values, query, error } = parseListingFilters(params || {})
  const requestedPage = Number(params?.page || 1)
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const pageSize = 20
  try {
    const listings = error
      ? []
      : await getListings({ ...query, page, pageSize }, { req, res })
    return {
      props: {
        listings,
        values,
        error,
        page,
        hasNextPage: listings.length === pageSize,
      },
    }
  } catch (cause) {
    // eslint-disable-next-line no-param-reassign -- Set the HTTP status for the SSR error page.
    res.statusCode = 503
    return {
      props: {
        listings: [],
        values,
        page,
        hasNextPage: false,
        error:
          cause instanceof ListingApiError
            ? cause.message
            : 'Marketplace unavailable. Please try again.',
      },
    }
  }
}

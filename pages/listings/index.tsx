import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { MarketLayout } from '@/components/listings/market-layout'
import type { ListingFilterValues } from '@/lib/listing-filters'
import { parseListingFilters } from '@/lib/listing-filters'
import { ListingApiError } from '@/lib/listing-validation'
import { getResaleListingsPage } from '@/lib/listings-api'
import { getPublicShops } from '@/lib/server/public-shop'
import type { Listing } from '@/types/listing'
import type { ListingQuery } from '@/types/listing'
import type { ShopPreview } from '@/types/shop'

type ListingsPageProps = {
  listings: Listing[]
  values: ListingFilterValues
  error: string | null
  page: number
  total: number
  query: ListingQuery
  shops: ShopPreview[]
}

export default function ListingsPage({
  values,
  listings,
  error,
  page,
  total,
  query,
  shops,
}: ListingsPageProps) {
  return (
    <>
      <Head>
        <title>Market | Usual & Unusual</title>
      </Head>
      <MarketLayout
        values={values}
        initialListings={listings}
        initialError={error}
        initialPage={page}
        initialTotal={total}
        initialQuery={query}
        shops={shops}
      />
    </>
  )
}
export const getServerSideProps: GetServerSideProps<
  ListingsPageProps
> = async ({ query: params, req, res }) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  const { values, query, error } = parseListingFilters(params || {})
  const serializedQuery = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined)
  ) as ListingQuery
  const requestedPage = Number(params?.page || 1)
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const pageSize = 15
  let shops: ShopPreview[] = []
  try {
    shops = (await getPublicShops({ pageSize: 8 })).shops
  } catch {
    /* Client read owns the independent Shop loading/error state. */
  }
  try {
    const result = error
      ? { listings: [], total: 0 }
      : await getResaleListingsPage(
          { ...query, page, pageSize, channel: 'resale', status: 'available' },
          { req, res }
        )
    return {
      props: {
        listings: result.listings,
        shops,
        values,
        error,
        page,
        total: result.total,
        query: serializedQuery,
      },
    }
  } catch (cause) {
    // eslint-disable-next-line no-param-reassign -- Set the HTTP status for the SSR error page.
    res.statusCode = 503
    return {
      props: {
        listings: [],
        shops,
        values,
        page,
        total: 0,
        query: serializedQuery,
        error:
          cause instanceof ListingApiError
            ? cause.message
            : 'Marketplace unavailable. Please try again.',
      },
    }
  }
}

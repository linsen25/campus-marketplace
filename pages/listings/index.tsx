import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'

import { Container } from '@/components/container/container'
import { ListingFilters } from '@/components/listings/listing-filters'
import { ListingGrid } from '@/components/listings/listing-grid'
import type { ListingFilterValues } from '@/lib/listing-filters'
import { parseListingFilters } from '@/lib/listing-filters'
import { ListingApiError } from '@/lib/listing-validation'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'
import { Link } from '@ui/link/link'

type ListingsPageProps = {
  listings: Listing[]
  values: ListingFilterValues
  error: string | null
  page: number
  hasNextPage: boolean
}

export default function ListingsPage({
  listings,
  values,
  error,
  page,
  hasNextPage,
}: ListingsPageProps) {
  const router = useRouter()
  const pageUrl = (nextPage: number) => ({
    pathname: router.pathname,
    query: { ...router.query, page: String(nextPage) },
  })
  return (
    <>
      <Head>
        <title>Browse | Campus Marketplace</title>
      </Head>
      <main className="py-4 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-bold laptop:sr-only">
              Campus Marketplace
            </h1>
            <ListingFilters values={values} />
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <>
                <p role="status">
                  {listings.length}{' '}
                  {values.status === 'all' ? '' : values.status}{' '}
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
                {(page > 1 || hasNextPage) && (
                  <nav
                    aria-label="Listing pages"
                    className="flex items-center justify-between gap-4"
                  >
                    {page > 1 && (
                      <Link href={pageUrl(page - 1)} className="underline">
                        Previous
                      </Link>
                    )}
                    <span>Page {page}</span>
                    {hasNextPage && (
                      <Link href={pageUrl(page + 1)} className="underline">
                        Next
                      </Link>
                    )}
                  </nav>
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

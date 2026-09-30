import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { ListingGrid } from '@/components/listings/listing-grid'
import { listingCategories } from '@/lib/listing-metadata'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'
import { Input } from '@ui/input/input'
import { Link } from '@ui/link/link'

type HomeProps = { listings: Listing[]; error: string | null }

export default function Home({ listings, error }: HomeProps) {
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
              <form
                action="/listings"
                method="get"
                role="search"
                className="flex flex-col gap-2 tablet:flex-row tablet:items-end"
              >
                <label className="flex flex-1 flex-col gap-2">
                  <span className="small-bold">Search marketplace</span>
                  <Input
                    name="search"
                    type="search"
                    placeholder="Search desks, books, and more"
                  />
                </label>
                <button type="submit" className="btn btn-primary btn-small">
                  Search
                </button>
              </form>
            </header>
            <nav
              aria-label="Marketplace categories"
              className="flex flex-col gap-3"
            >
              <h2 className="text-xl font-bold">Browse by category</h2>
              <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
                {listingCategories.map((category) => (
                  <li key={category.value}>
                    <Link
                      href={`/listings?category=${encodeURIComponent(
                        category.label
                      )}`}
                      className="block rounded border border-neutral-light p-3 underline"
                    >
                      {category.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <section
              aria-labelledby="latest-listings"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="latest-listings" className="text-xl font-bold">
                  Latest available listings
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
                  No items available yet. Be the first to list something for the
                  community.
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
}) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  try {
    const listings = await getListings(
      { status: 'available', sort: 'newest', page: 1, pageSize: 10 },
      { req, res }
    )
    return { props: { listings, error: null } }
  } catch {
    // eslint-disable-next-line no-param-reassign -- Return a retryable marketplace error.
    res.statusCode = 503
    return {
      props: {
        listings: [],
        error: 'Marketplace unavailable. Please try again shortly.',
      },
    }
  }
}

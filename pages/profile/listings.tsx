import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import { useEffect, useRef, useState } from 'react'

import { Container } from '@/components/container/container'
import { ListingCard } from '@/components/listings/listing-card'
import { MarketplaceActions } from '@/components/listings/marketplace-actions'
import {
  deleteListing,
  getMyListings,
  markListingSold,
} from '@/lib/listings-api'
import { getMarketplaceSession } from '@/lib/server/marketplace-auth'
import type { Listing } from '@/types/listing'
import { Button } from '@ui/button/button'
import { Link } from '@ui/link/link'

type MyListingsPageProps = { listings: Listing[] }

export default function MyListingsPage({
  listings: initialListings,
}: MyListingsPageProps) {
  const [listings, setListings] = useState(initialListings)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  useEffect(() => setListings(initialListings), [initialListings])

  async function manage(listing: Listing, action: 'delete' | 'sold') {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    setMessage('')
    try {
      if (action === 'delete') {
        await deleteListing(listing.id)
        setListings((items) => items.filter((item) => item.id !== listing.id))
        setConfirmDelete(null)
        setMessage(`${listing.title} deleted.`)
      } else {
        const sold = await markListingSold(listing.id)
        setListings((items) =>
          items.map((item) => (item.id === sold.id ? sold : item))
        )
        setMessage(`${listing.title} marked as sold.`)
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this listing. Please try again.'
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Head>
        <title>My Listings | Student marketplace</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <Link href="/listings" className="underline">
              Back to listings
            </Link>
            <MarketplaceActions />
            <h1 className="text-2xl font-bold">My Listings</h1>
            <div>
              <Link href="/listings/new" className="btn btn-primary btn-small">
                Sell an item
              </Link>
            </div>
            {error && <p role="alert">{error}</p>}
            <p role="status">{message}</p>
            {listings.length === 0 ? (
              <p>You have no listings yet. Post an item to get started.</p>
            ) : (
              <ul
                className="grid grid-cols-1 gap-6 tablet:grid-cols-3 laptop:grid-cols-5"
                aria-label="My listings"
                aria-busy={busy}
              >
                {listings.map((listing) => (
                  <li key={listing.id} className="flex min-w-0 flex-col gap-2">
                    <ListingCard listing={listing} />
                    {listing.status === 'sold' && (
                      <p className="small-bold">SOLD</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {!busy && (
                        <Link
                          href={`/listings/${encodeURIComponent(
                            listing.id
                          )}/edit`}
                          className="underline"
                          aria-label={`Edit ${listing.title}`}
                        >
                          Edit
                        </Link>
                      )}
                      {listing.status === 'available' && (
                        <Button
                          type="secondary"
                          disabled={busy}
                          aria-label={`Mark ${listing.title} as sold`}
                          onClick={() => manage(listing, 'sold')}
                        >
                          Mark as Sold
                        </Button>
                      )}
                      <Button
                        type="secondary"
                        disabled={busy}
                        aria-label={`Delete ${listing.title}`}
                        onClick={() => setConfirmDelete(listing.id)}
                      >
                        Delete
                      </Button>
                    </div>
                    {confirmDelete === listing.id && (
                      <div
                        role="group"
                        aria-label={`Confirm deletion of ${listing.title}`}
                        className="flex flex-col gap-2"
                      >
                        <p>
                          Delete “{listing.title}”? This cannot be undone during
                          this session.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="primary"
                            disabled={busy}
                            onClick={() => manage(listing, 'delete')}
                          >
                            Confirm delete
                          </Button>
                          <Button
                            type="secondary"
                            disabled={busy}
                            onClick={() => setConfirmDelete(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Container>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<
  MyListingsPageProps
> = async (context) => {
  const seller = await getMarketplaceSession(context)
  if (!seller)
    return {
      redirect: {
        destination: '/auth/sign-in?next=/profile/listings',
        permanent: false,
      },
    }
  return { props: { listings: await getMyListings(context) } }
}

import { useEffect, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import type { SellerSummary } from '@/types/listing'
import { Button } from '@ui/button/button'
import { Link } from '@ui/link/link'

export function MarketplaceActions() {
  const [seller, setSeller] = useState<SellerSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    marketplaceRequest<{ seller: SellerSummary | null }>(
      '/api/auth/session',
      'GET'
    )
      .then((data) => {
        if (active) setSeller(data.seller)
      })
      .catch(() => {
        if (active) setSeller(null)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/listings/new" className="btn btn-primary btn-small">
          Sell an item
        </Link>
        <Link href="/profile/listings" className="underline">
          My Listings
        </Link>
        {seller ? (
          <Button
            disabled={busy}
            className="underline"
            onClick={async () => {
              setBusy(true)
              try {
                await marketplaceRequest('/api/auth/sign-out', 'POST')
                window.location.assign('/listings')
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : 'Sign out failed.'
                )
                setBusy(false)
              }
            }}
          >
            Sign Out
          </Button>
        ) : (
          <Link href="/auth/sign-in" className="underline">
            Sign In
          </Link>
        )}
      </div>
      {seller && (
        <p className="text-sm text-neutral-dark">
          {seller.displayName} · Western email verified
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

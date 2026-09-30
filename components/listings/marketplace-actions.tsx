import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import type { SellerSummary } from '@/types/listing'
import { Button } from '@ui/button/button'
import { Link } from '@ui/link/link'

import styles from './account-layout.module.css'

export function MarketplaceActions() {
  const router = useRouter()
  const [seller, setSeller] = useState<SellerSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    marketplaceRequest<{ seller: SellerSummary | null }>(
      '/api/auth/session',
      'GET'
    )
      .then((data) => {
        if (active) {
          setSeller(data.seller)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setSeller(null)
          setLoading(false)
          setError('Unable to load your account. Please refresh to try again.')
        }
      })
    return () => {
      active = false
    }
  }, [router.asPath])
  if (loading) return <p role="status">Loading account...</p>
  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert">{error}</p>}
      {seller ? (
        <div>
          <p className="font-bold">{seller.displayName}</p>
          <p className="text-sm text-neutral-dark">Western email verified</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            Sign in with your Western email to manage your account and listings.
          </p>
          <Link
            href="/auth/sign-in?next=/account"
            className="btn btn-primary btn-small"
          >
            Sign In
          </Link>
        </div>
      )}
      <Link href="/listings/new" className="btn btn-primary btn-small w-full">
        Sell an item
      </Link>
      <section
        className="flex flex-col gap-3"
        aria-labelledby="account-selling"
      >
        <h2 id="account-selling" className="text-xl font-bold">
          Selling
        </h2>
        <Link
          href="/profile/listings"
          aria-current={
            router.asPath === '/profile/listings' ? 'page' : undefined
          }
          className={styles.row}
        >
          <span>My Listings</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="account-buying">
        <h2 id="account-buying" className="text-xl font-bold">
          Buying
        </h2>
        <Link
          href="/account/favorites"
          aria-current={
            router.asPath === '/account/favorites' ? 'page' : undefined
          }
          className={styles.row}
        >
          <span>Favorites</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
        <Link
          href="/account/messages"
          aria-current={
            router.asPath === '/account/messages' ? 'page' : undefined
          }
          className={styles.row}
        >
          <span>Messages</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
      </section>
      <section
        className="flex flex-col gap-3"
        aria-labelledby="account-settings"
      >
        <h2 id="account-settings" className="text-xl font-bold">
          Account
        </h2>
        <Link
          href="/account/profile"
          aria-current={
            router.asPath === '/account/profile' ? 'page' : undefined
          }
          className={styles.row}
        >
          <span>Profile</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
        <Link
          href="/account/settings"
          aria-current={
            router.asPath === '/account/settings' ? 'page' : undefined
          }
          className={styles.row}
        >
          <span>Settings</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
        {seller && (
          <Button
            disabled={busy}
            className={styles.row}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await marketplaceRequest('/api/auth/sign-out', 'POST')
                window.location.assign('/account')
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
        )}
      </section>
    </div>
  )
}

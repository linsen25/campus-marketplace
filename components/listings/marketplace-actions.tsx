import { useRouter } from 'next/router'
import { useState } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { marketplaceRequest } from '@/lib/listings-api'
import { Button } from '@ui/button/button'
import { Link } from '@ui/link/link'

import styles from './account-layout.module.css'
import { useMarketplaceSession } from './marketplace-session'

export function MarketplaceActions() {
  const router = useRouter()
  const { openAuth } = useAuthModal()
  const { seller, loading, error: sessionError } = useMarketplaceSession()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (loading) return <p role="status">Loading account...</p>
  return (
    <div className="flex flex-col gap-6">
      {(error || sessionError) && <p role="alert">{error || sessionError}</p>}
      {seller ? (
        <div>
          <p className="font-bold">{seller.displayName}</p>
          <p className="text-sm text-neutral-dark">Western email verified</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            Log in with your Western email to manage your account and listings.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => openAuth({ next: '/account' })}
          >
            Log in
          </button>
        </div>
      )}
      <Link
        href="/listings/new"
        className="btn btn-primary btn-small w-full"
        onClick={(event) => {
          if (!seller) {
            event.preventDefault()
            openAuth({ next: '/listings/new' })
          }
        }}
      >
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
          onClick={(event) => {
            if (!seller) {
              event.preventDefault()
              openAuth({ next: '/profile/listings' })
            }
          }}
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

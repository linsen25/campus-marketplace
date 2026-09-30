import { useRouter } from 'next/router'

import { Container } from '@/components/container/container'
import { Link } from '@ui/link/link'

import styles from './marketplace-shell.module.css'

function NavigationIcon({ account = false }: { account?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {account ? (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
        </>
      ) : (
        <>
          <path d="M3 9h18l-2-6H5L3 9Z M5 9v12h14V9 M9 21v-7h6v7" />
        </>
      )}
    </svg>
  )
}

export function MarketplaceHeader() {
  return (
    <header
      className={`${styles.desktopHeader} border-b border-neutral-light py-4`}
    >
      <Container>
        <nav
          aria-label="Main navigation"
          className="flex items-center justify-between gap-4"
        >
          <Link href="/" className="text-xl font-bold">
            Campus Marketplace
          </Link>
          <div className={styles.desktopLinks}>
            <Link href="/" className="underline">
              Market
            </Link>
            <Link
              href="/profile/listings"
              aria-label="My Account"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <NavigationIcon account={true} />
            </Link>
          </div>
        </nav>
      </Container>
    </header>
  )
}

export function MarketplaceBottomNavigation() {
  const { pathname } = useRouter()
  const account =
    pathname.startsWith('/account') ||
    pathname.startsWith('/profile') ||
    pathname === '/auth/sign-in'
  return (
    <nav aria-label="Primary navigation" className={styles.bottomTabs}>
      <span
        aria-hidden="true"
        className={styles.indicator}
        style={{ transform: `translateX(${account ? 100 : 0}%)` }}
      />
      <Link
        href="/"
        aria-current={!account ? 'page' : undefined}
        className={styles.tab}
      >
        <NavigationIcon />
        <span>Market</span>
      </Link>
      <Link
        href="/account"
        aria-current={account ? 'page' : undefined}
        className={styles.tab}
      >
        <NavigationIcon account={true} />
        <span>My Account</span>
      </Link>
    </nav>
  )
}

export const marketplaceContentClass = styles.content

export function MarketplaceFooter() {
  return (
    <footer
      className={`${styles.desktopFooter} border-t border-neutral-light py-6`}
    >
      <Container>
        <div className="flex flex-col gap-2 text-sm text-neutral-dark">
          <p>
            Campus Marketplace · Second-hand finds for the Western community.
          </p>
          <p>
            Independent community marketplace. Not affiliated with Western
            University.
          </p>
        </div>
      </Container>
    </footer>
  )
}

import type { ReactNode } from 'react'

import { Container } from '@/components/container/container'
import { Link } from '@ui/link/link'

import styles from './marketplace-shell.module.css'

function NavigationIcon() {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
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
            <Link href="/listings" className="underline">
              Market
            </Link>
            <Link
              href="/home"
              aria-label="Home"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <NavigationIcon />
            </Link>
          </div>
        </nav>
      </Container>
    </header>
  )
}

export function MarketplaceContent({ children }: { children: ReactNode }) {
  return <div className={styles.content}>{children}</div>
}

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

import { Container } from '@/components/container/container'
import { MarketplaceActions } from '@/components/listings/marketplace-actions'
import { Link } from '@ui/link/link'

export function MarketplaceHeader() {
  return (
    <header className="border-b border-neutral-light py-4">
      <Container>
        <nav
          aria-label="Main navigation"
          className="flex flex-col gap-4 laptop:flex-row laptop:items-center laptop:justify-between"
        >
          <Link href="/" className="text-xl font-bold">
            Campus Marketplace
          </Link>
          <MarketplaceActions />
        </nav>
      </Container>
    </header>
  )
}

export function MarketplaceFooter() {
  return (
    <footer className="border-t border-neutral-light py-6">
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

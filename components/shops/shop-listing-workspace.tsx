import profile from '@/components/home/profile.module.css'

import { ShopProBadge } from './shop-pro-badge'
import { ShopProPricing } from './shop-pro-pricing'
import pricing from './shop-pro-pricing.module.css'
import styles from './shop-surfaces.module.css'

/** No Shop-scoped inventory/creation provider exists. Never fall back to resale
 * reads or writes. Later authority can supply the existing ListingForm and
 * owner-management primitives here, using the same Listing IDs.
 */
export function ShopListingWorkspace({ create = false }: { create?: boolean }) {
  return (
    <section
      className={create ? profile.panel : pricing.workspace}
      aria-label={create ? 'Create Shop Listing' : 'My Shop'}
      data-shop-listing-workspace="inactive"
    >
      {create && (
        <header className={profile.panelHeader}>
          <h3>Create Shop Listing</h3>
          <ShopProBadge />
        </header>
      )}
      {create ? (
        <>
          <p className={styles.inactive}>Your Shop isn&apos;t active yet.</p>
          <p className={profile.caption}>Available with Shop Pro</p>
        </>
      ) : (
        <ShopProPricing />
      )}
    </section>
  )
}

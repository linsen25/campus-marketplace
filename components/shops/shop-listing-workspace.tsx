import profile from '@/components/home/profile.module.css'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop-surfaces.module.css'

/** Shop creation remains fail-closed until publication entitlement is available. */
export function ShopListingWorkspace({ create = false }: { create?: boolean }) {
  return (
    <section
      className={create ? profile.panel : undefined}
      aria-label={create ? 'Add Product' : 'My Shop'}
      data-shop-listing-workspace={create ? 'inactive' : 'empty'}
    >
      {create && (
        <header className={profile.panelHeader}>
          <h3>Add Product</h3>
          <ShopProBadge tier="plus" />
        </header>
      )}
      {create && (
        <>
          <p className={styles.inactive}>Your Shop isn&apos;t active yet.</p>
          <p className={profile.caption}>Available with Shop Plus or Pro</p>
        </>
      )}
    </section>
  )
}

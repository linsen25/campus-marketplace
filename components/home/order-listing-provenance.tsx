import type { OrderListingProvenance as Provenance } from '@/types/order'

import styles from './order-listing-provenance.module.css'

export function OrderListingProvenance({
  provenance,
}: {
  provenance?: Provenance
}) {
  if (provenance?.channel !== 'shop' || !provenance.shopName) return null
  return (
    <p className={styles.provenance}>{provenance.shopName} &middot; Shop</p>
  )
}

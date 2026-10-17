import type { NotificationItem } from '@/lib/notification-category'

import styles from './notification-listing-provenance.module.css'

export function NotificationListingProvenance({
  provenance,
}: {
  provenance: NotificationItem['listingProvenance']
}) {
  if (provenance?.channel !== 'shop' || !provenance.shopName) return null
  return (
    <span className={styles.provenance} title={provenance.shopName}>
      {provenance.shopName} &middot; Shop
    </span>
  )
}

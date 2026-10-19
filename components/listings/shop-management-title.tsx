import { Store } from 'lucide-react'

import { ShopProBadge } from '@/components/shops/shop-pro-badge'

import styles from './shop-management.module.css'

export function ShopManagementTitle() {
  return (
    <span className={styles.title}>
      <Store size={18} aria-hidden="true" />
      Manage Products
      <span className={styles.badge}>
        <ShopProBadge tier="plus" />
      </span>
    </span>
  )
}

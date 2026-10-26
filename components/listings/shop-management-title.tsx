import { Store } from 'lucide-react'

import styles from './shop-management.module.css'

export function ShopManagementTitle() {
  return (
    <span className={styles.title}>
      <Store size={18} aria-hidden="true" />
      Manage Products
    </span>
  )
}

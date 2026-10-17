import { X } from 'lucide-react'

import { FadingDialog } from '@/components/ui/fading-dialog'

import { ShopProPricing } from './shop-pro-pricing'
import styles from './shop-pro-pricing.module.css'

export function ShopProPricingSheet({ onClose }: { onClose: () => void }) {
  return (
    <FadingDialog
      className={styles.sheet}
      aria-label="Shop Pro plans"
      focusAtTop={true}
      tabIndex={-1}
      onRequestClose={onClose}
    >
      <div className={styles.sheetTop}>
        <span>Shop Pro</span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close Shop Pro pricing"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.sheetBody}>
        <ShopProPricing sheet={true} />
      </div>
    </FadingDialog>
  )
}

import { X } from 'lucide-react'

import { MarketBrandMark } from '@/components/listings/market-brand-mark'
import PricingCard from '@/components/pricing-card'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './shop-pricing-dialog.module.css'

/** Existing modal infrastructure with UU plan presentation; no checkout or trial authority. */
export function ShopPricingDialog({ onClose }: { onClose: () => void }) {
  return (
    <FadingDialog
      focusAtTop={true}
      className={styles.dialog}
      aria-label="Shop Pro pricing"
      tabIndex={-1}
      onRequestClose={onClose}
    >
      <span className={styles.decoration} aria-hidden="true" />
      <header className={styles.top}>
        <span className={styles.brand}>
          <MarketBrandMark />
          <span>Shop Plans</span>
        </span>
        <button
          type="button"
          aria-label="Close Shop Pro pricing"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>
        {/* Full visual shell only. Eligibility remains unavailable; CTAs are no-ops. */}
        <PricingCard showTrialPreview={true} />
      </div>
    </FadingDialog>
  )
}

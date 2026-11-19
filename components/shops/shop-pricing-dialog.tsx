import { X } from 'lucide-react'
import { useState } from 'react'

import { MarketBrandMark } from '@/components/listings/market-brand-mark'
import PricingCard from '@/components/pricing-card'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './shop-pricing-dialog.module.css'
import surfaceStyles from './shop-pricing-surface.module.css'

/** Existing modal infrastructure with UU plan presentation; no checkout or trial authority. */
export function ShopPricingDialog({ onClose }: { onClose: () => void }) {
  const [previewNotice, setPreviewNotice] = useState('')
  return (
    <FadingDialog
      focusAtTop={true}
      className={`${styles.dialog} ${surfaceStyles.surface}`}
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
        {/* Development preview only; it does not receive a live payment handler. */}
        <PricingCard
          showTrialPreview={true}
          trialPreview={true}
          onPreviewNotice={setPreviewNotice}
        />
        {previewNotice && <p role="status">{previewNotice}</p>}
      </div>
    </FadingDialog>
  )
}

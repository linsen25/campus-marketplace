import { LockKeyhole } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import PricingCard from '@/components/pricing-card'
import type { DevShopTier } from '@/hooks/use-shop-membership-access'
import type { ShopMembership } from '@/types/shop-membership'

import styles from './shop-membership-access.module.css'
import { ShopProBadge } from './shop-pro-badge'
import pricingSurfaceStyles from './shop-pricing-surface.module.css'
import { ShopPreviewShowcase } from './shop-preview-showcase'

export function ShopMembershipAccess({
  status,
  membership,
  error,
  devSimulationEnabled,
  userId,
  onRetry,
  onSimulate,
}: {
  status: 'loading' | 'ready' | 'anonymous' | 'ineligible' | 'error'
  membership: ShopMembership | null
  error: string
  devSimulationEnabled: boolean
  userId: string | null
  onRetry: () => void
  onSimulate: (tier: DevShopTier) => void
}) {
  const [previewNotice, setPreviewNotice] = useState('')
  const trialEligibility =
    status === 'ready' && membership
      ? membership.trialEligible
        ? 'eligible'
        : 'ineligible'
      : 'unavailable'
  // This is presentation-only while the server has not returned a trusted
  // projection. A resolved false eligibility never renders a trial CTA.
  const developmentTrialPreview =
    process.env.NODE_ENV === 'development' && status !== 'ready'
  return (
    <section className={styles.page} aria-label="Shop membership">
      <header className={styles.hero}>
        <div className={styles.heroDetails}>
          <div className={styles.heroTitle}>
            <span className={styles.icon} aria-hidden="true">
              <LockKeyhole size={20} />
            </span>
            <div>
              <p className={styles.eyebrow}>My Shop</p>
              <h2>Choose a Shop plan</h2>
            </div>
          </div>

          <div className={styles.heroCopy}>
            <p>Unlock powerful tools to run and grow your student shop.</p>
            <ul>
              <li>Manage your products</li>
              <li>Build your storefront</li>
              <li>Track your performance</li>
            </ul>
            <div
              className={styles.heroBadges}
              aria-label="Available Shop plans"
            >
              <ShopProBadge tier="plus" />
              <ShopProBadge tier="pro" />
            </div>
          </div>
        </div>
        <figure
          className={styles.heroArt}
          aria-label="Usual and Unusual Shop illustration"
        >
          <Image
            className={styles.heroImage}
            src="/static/images/shop-plans/shop-hero.png?v=3"
            alt="Purple and green Usual and Unusual student shop illustration"
            width={2172}
            height={724}
            sizes="(max-width: 639px) min(100vw - 40px, 350px), 400px"
            priority
          />
        </figure>
      </header>
      {status === 'loading' && (
        <p className={styles.loading} role="status">
          Checking your Shop membership...
        </p>
      )}
      {status === 'error' && (
        <div className={styles.notice} role="status">
          <span>{error || 'Shop membership is unavailable.'}</span>
          <ShiningButton
            size="compact"
            variant="outline"
            showArrow={false}
            onClick={onRetry}
          >
            Retry
          </ShiningButton>
        </div>
      )}
      <div className={styles.content}>
        <ShopPreviewShowcase />
        <aside
          className={`${styles.purchase} ${pricingSurfaceStyles.surface}`}
          aria-label="Shop plan purchase"
        >
          <div className={styles.pricing}>
            <PricingCard
              trialEligibility={trialEligibility}
              showTrialPreview={developmentTrialPreview}
              trialPreview={developmentTrialPreview}
              onPreviewNotice={setPreviewNotice}
            />
          </div>
          {previewNotice && (
            <p className={styles.previewNotice} role="status">
              {previewNotice}
            </p>
          )}
          {devSimulationEnabled && (
            <aside
              className={styles.developer}
              aria-label="Development-only Shop membership controls"
            >
              <span>DEV ONLY</span>
              <p>
                Local UI preview only. This never creates a membership, payment,
                or server entitlement.
              </p>
              <div>
                <ShiningButton
                  size="compact"
                  variant="outline"
                  showArrow={false}
                  disabled={!userId}
                  onClick={() => onSimulate('plus')}
                >
                  Simulate Plus
                </ShiningButton>
                <ShiningButton
                  size="compact"
                  variant="outline"
                  showArrow={false}
                  disabled={!userId}
                  onClick={() => onSimulate('pro')}
                >
                  Simulate Pro
                </ShiningButton>
              </div>
            </aside>
          )}
        </aside>
      </div>
      <footer className={styles.footer}>
        <div className={styles.footerCopy}>
          <h3>From your first listing to your next sale</h3>
          <p>Create your shop. Reach buyers. Make your first sale.</p>
          <small>Your shop journey starts here.</small>
        </div>
        <Image
          className={styles.footerImage}
          src="/static/images/shop-plans/shop-footer.png"
          alt="Usual and Unusual Shop journey illustration"
          width={1448}
          height={1086}
          sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1100px) min(100vw - 64px, 700px), 46vw"
        />
      </footer>
    </section>
  )
}

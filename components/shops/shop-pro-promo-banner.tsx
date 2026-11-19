import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useDesktopRouteTransition } from '@/components/navigation/desktop-route-transition'
import styles from './shop-pro-pricing.module.css'

export function ShopProPromoBanner() {
  const reduced = useReducedMotion()
  const [dismissed, setDismissed] = useState(false)
  const navigate = useDesktopRouteTransition()
  const plansHref = '/home?section=shop-membership'
  return (
    <>
      <AnimatePresence initial={false}>
        {!dismissed && (
          <m.div
            data-shop-promo-collapse={true}
            key="promo"
            initial={false}
            animate={{ height: 'auto', opacity: 1, marginBottom: 20 }}
            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
            transition={{
              duration: reduced ? 0 : 0.26,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{ overflow: 'hidden', overflowAnchor: 'none' }}
          >
            <aside
              style={{ marginBottom: 0 }}
              className={styles.banner}
              aria-label="Shop Pro promotion"
            >
              <div className={styles.promoArt}>
                <Image
                  className={styles.promoImage}
                  src="/static/images/shop-plans/shop-promo-trimmed.png"
                  alt="Student seller with a storefront and Shop Pro checklist"
                  width={1878}
                  height={665}
                  sizes="(max-width: 639px) 100vw, (max-width: 1023px) 420px, 510px"
                />
              </div>
              <div className={styles.bannerCopy}>
                <h2>Want your own shop?</h2>
                <p>Subscribe to Shop Pro and create your own storefront.</p>
              </div>
              <ShiningButton
                variant="green"
                href={plansHref}
                onNavigate={(event) => navigate(event, plansHref)}
              >
                Explore Shop Pro
              </ShiningButton>
              <button
                type="button"
                className={styles.dismiss}
                aria-label="Dismiss Shop Pro promotion"
                onClick={() => setDismissed(true)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </aside>
          </m.div>
        )}
      </AnimatePresence>
    </>
  )
}

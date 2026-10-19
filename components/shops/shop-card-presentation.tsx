import { Check, ShoppingBag, Star } from 'lucide-react'
import type { ReactNode } from 'react'

import styles from '@/components/listings/welcome-demo-cards.module.css'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { UserAvatar } from '@/components/ui/user-avatar'

import compactStyles from './shop-card-presentation.module.css'

export type ShopCardVisual = {
  name: string
  tagline: string
  image?: string
  imageAlt?: string
  verified?: boolean
  figures?: { rating: string; reviews: number; sold: number }
}

/** Presentation only: authority and actions stay with each caller. */
export function ShopCardPresentation({
  shop,
  favorite,
  onFavorite,
  action,
  compact = false,
  welcome = false,
  demo = false,
}: {
  shop: ShopCardVisual
  favorite?: boolean
  onFavorite?: (value: boolean) => void
  action: ReactNode
  compact?: boolean
  welcome?: boolean
  demo?: boolean
}) {
  return (
    <article
      className={`${styles.shopCard} ${compact ? compactStyles.compact : ''}`}
      data-shop-card="true"
      aria-label={`${shop.name}${demo ? ' demo shop' : ' shop'}`}
      data-welcome-shop-card={welcome ? 'true' : undefined}
    >
      <div className={styles.shopMedia}>
        {shop.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- Reuse the approved image presentation and local demo assets.
          <img
            src={shop.image}
            alt={shop.imageAlt ?? shop.name}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <UserAvatar username={shop.name} className={compactStyles.fallback} />
        )}
        {demo && <span className={styles.demoTag}>Demo shop</span>}
        {onFavorite && (
          <div className={styles.imageFavorite}>
            <PulseHeart
              appearance="image-overlay"
              liked={Boolean(favorite)}
              showCount={false}
              size={26}
              corner={24}
              idleColor="#4d574d"
              likedColor="#d97991"
              pillColor="transparent"
              className={styles.heart}
              label={
                favorite
                  ? `Unfavorite ${demo ? 'demo shop' : 'shop'}${
                      welcome ? '' : `: ${shop.name}`
                    }`
                  : `Favorite ${demo ? 'demo shop' : 'shop'}${
                      welcome ? '' : `: ${shop.name}`
                    }`
              }
              onChange={onFavorite}
            />
          </div>
        )}
      </div>
      <div className={styles.shopInfo}>
        <div>
          <h3>{shop.name}</h3>
          <p className={styles.tagline}>{shop.tagline}</p>
        </div>
        {shop.verified && (
          <p className={styles.verified}>
            <span className={styles.shopVerifiedMark} aria-hidden="true">
              <Check size={11} strokeWidth={3} />
            </span>
            Western email verified
          </p>
        )}
        {shop.figures && (
          <div className={styles.stats}>
            <p>
              <Star size={16} aria-hidden="true" />
              <strong>{shop.figures.rating}</strong>
              <span>&middot; {shop.figures.reviews} reviews</span>
            </p>
            <p>
              <ShoppingBag size={16} aria-hidden="true" />
              <strong>{shop.figures.sold}</strong> <span>items sold</span>
            </p>
          </div>
        )}
        {demo && (
          <small className={styles.shopDemoNote}>
            Illustrative demo figures
          </small>
        )}
        {action}
      </div>
    </article>
  )
}

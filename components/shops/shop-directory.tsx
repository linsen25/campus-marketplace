import type { CSSProperties } from 'react'

import InfiniteGrid from '@/components/infinite-grid'
import type { ShopPreview } from '@/types/shop'

import { ShopCard } from './shop-card'
import { ShopProPromoBanner } from './shop-pro-promo-banner'
import styles from './shop.module.css'

export function ShopDirectory({
  shops = [],
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  shops?: readonly ShopPreview[]
  onOverlayActiveChange?: (active: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
}) {
  return (
    <>
      <ShopProPromoBanner />
      {!shops.length ? (
        <section className={styles.empty} aria-label="Shop directory">
          <h2>No shops yet</h2>
          <p>Shops will appear here when sellers open their storefronts.</p>
        </section>
      ) : (
        <section aria-label="Shop directory">
          <InfiniteGrid
            repeat={false}
            items={shops.map((shop) => ({
              id: shop.sellerProfileId,
              title: shop.shopName,
              customContent: (
                <ShopCard
                  shop={shop}
                  overlayClassName={overlayClassName}
                  overlayStyle={overlayStyle}
                  onOverlayActiveChange={onOverlayActiveChange}
                />
              ),
            }))}
          />
        </section>
      )}
    </>
  )
}

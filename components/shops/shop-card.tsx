import { ArrowRight } from 'lucide-react'
import { useRouter } from 'next/router'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import card from '@/components/listings/welcome-demo-cards.module.css'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useShopFavorite } from '@/hooks/use-shop-favorites'
import { recordShopView } from '@/lib/record-marketplace-view'
import type { ShopPreview } from '@/types/shop'

import { ShopCardPresentation } from './shop-card-presentation'
import styles from './shop-card.module.css'

export function ShopCard({
  shop,
  preview = false,
}: {
  shop: ShopPreview
  preview?: boolean
}) {
  const router = useRouter()
  const { seller } = useMarketplaceSession()
  const favorite = useShopFavorite(preview ? undefined : shop.id)
  return (
    <ShopCardPresentation
      favorite={favorite.liked}
      confirmFavorite={true}
      favoriteDisabled={favorite.disabled}
      favoriteError={
        favorite.error ? (
          <p role="alert">
            {favorite.error}{' '}
            <button type="button" onClick={() => favorite.retry()}>
              Retry
            </button>
          </p>
        ) : undefined
      }
      shop={{
        name: shop.shopName,
        tagline: shop.category,
        image: shop.imageUrl || shop.avatarUrl,
      }}
      action={
        preview ? (
          <button
            type="button"
            className={card.shopAction}
            onClick={() => undefined}
          >
            Go to shop <ArrowRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <StatefulButton
            className={`${card.shopAction} ${styles.loadingAction}`}
            minLoadingMs={300}
            resetAfter={800}
            successText="Go to shop"
            errorText="Try again"
            onClick={() =>
              router
                .push(`/shop/${encodeURIComponent(shop.username)}`, undefined, {
                  scroll: false,
                })
                .then((navigated) => {
                  if (navigated === false)
                    throw new Error('Shop navigation cancelled')
                  if (seller && seller.id !== shop.sellerProfileId && shop.id)
                    recordShopView(shop.id)
                })
            }
          >
            <span className={styles.label}>
              Go to shop <ArrowRight size={18} aria-hidden="true" />
            </span>
          </StatefulButton>
        )
      }
      onFavorite={preview ? undefined : favorite.change}
    />
  )
}

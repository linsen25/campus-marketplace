import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import card from '@/components/listings/welcome-demo-cards.module.css'
import { OverlappingSlider } from '@/components/overlapping-slider'

import { recommendedShopsDemo } from './recommended-shops-demo'
import { ShopCardPresentation } from './shop-card-presentation'
import { ShopDemoOpenAction } from './shop-demo-action'
import type { OpenDemoShop } from './shop-demo-action'
import styles from './shop-discovery.module.css'

export function RecommendedShopsSlider({
  onOpenLuna,
  lunaFavorite,
  onLunaFavorite,
  paused = false,
}: {
  paused?: boolean
  onOpenLuna?: OpenDemoShop
  lunaFavorite?: boolean
  onLunaFavorite?: (value: boolean) => void
}) {
  const [favorites, setFavorites] = useState<Record<string, boolean>>({})
  return (
    <section
      className={styles.recommended}
      aria-labelledby="recommended-shops-title"
    >
      <header className={styles.heading}>
        <h2 id="recommended-shops-title">Recommended Shops</h2>
        <p>Discover storefronts from the UU community.</p>
        <small>Demo preview &middot; Illustrative shops and figures</small>
      </header>
      <OverlappingSlider
        paused={paused}
        items={recommendedShopsDemo}
        renderItem={(shop) => (
          <ShopCardPresentation
            compact={true}
            demo={true}
            shop={shop}
            favorite={
              shop.id === 'demo-luna' && onLunaFavorite
                ? lunaFavorite
                : favorites[shop.id]
            }
            action={
              shop.id === 'demo-luna' && onOpenLuna ? (
                <ShopDemoOpenAction onOpen={onOpenLuna} />
              ) : (
                <button
                  type="button"
                  className={card.shopAction}
                  aria-label={`Go to ${shop.name} (demo only)`}
                  onClick={() => undefined}
                >
                  Go to shop <ArrowRight size={18} aria-hidden="true" />
                </button>
              )
            }
            onFavorite={(value) => {
              if (shop.id === 'demo-luna' && onLunaFavorite)
                onLunaFavorite(value)
              else setFavorites((current) => ({ ...current, [shop.id]: value }))
            }}
          />
        )}
      />
    </section>
  )
}

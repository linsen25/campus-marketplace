import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { ShopCardPresentation } from '@/components/shops/shop-card-presentation'
import { lunaStudioDemo } from '@/components/shops/shop-demo-data'

import styles from './welcome-demo-cards.module.css'

/** Local prototype; no public Shop or Favorite authority. */
export function WelcomeShopDemoCard() {
  const [favorite, setFavorite] = useState(false)
  return (
    <ShopCardPresentation
      welcome={true}
      demo={true}
      shop={{
        name: 'Luna Studio',
        tagline: 'Handmade jewelry & accessories',
        image: lunaStudioDemo.image,
        imageAlt: 'Necklace displayed on a jewelry stand',
        verified: true,
        figures: { rating: '4.9', reviews: 24, sold: 68 },
      }}
      favorite={favorite}
      action={
        <button
          className={styles.shopAction}
          type="button"
          aria-label="Go to shop (demo only)"
          onClick={() => undefined}
        >
          Go to shop <ArrowRight size={18} aria-hidden="true" />
        </button>
      }
      onFavorite={setFavorite}
    />
  )
}

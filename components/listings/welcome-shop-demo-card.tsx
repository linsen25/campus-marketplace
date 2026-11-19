import ShiningButton from '@/components/animata/button/shining-button'
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
        <div className={styles.shopActionWrapper}>
          <ShiningButton variant="green" onClick={() => undefined}>
            Go to shop
          </ShiningButton>
        </div>
      }
      onFavorite={setFavorite}
    />
  )
}

import { useEffect, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import profile from '@/components/home/profile.module.css'
import { shopPath } from '@/lib/shop-presentation'
import type { ShopPreview } from '@/types/shop'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop-surfaces.module.css'

export function ShopPublicURL({ username }: { username: string }) {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  return (
    <span className={styles.url}>
      {origin}
      {shopPath(username)}
    </span>
  )
}

export function ShopProfile({
  shop,
  username,
}: {
  shop?: ShopPreview
  username: string | null
}) {
  const active = Boolean(shop && username)
  return (
    <section
      className={`${profile.panel} ${styles.area}`}
      aria-label="Shop"
      data-shop-surface="profile"
      data-shop-active={active}
    >
      <header className={profile.panelHeader}>
        <h3>Shop</h3>
        <ShopProBadge />
      </header>
      {shop && username ? (
        <div className={styles.identity}>
          <h4>{shop.shopName}</h4>
          <p className={profile.caption}>{shop.category}</p>
          <p className={styles.description}>{shop.description}</p>
          <ShopPublicURL username={username} />
          <span className={styles.viewAction}>
            <ShiningButton variant="green" href={shopPath(username)}>
              View Shop
            </ShiningButton>
          </span>
        </div>
      ) : (
        <div className={styles.inactive}>
          <p>Your Shop isn&apos;t active yet.</p>
          <p className={profile.caption}>
            Create your own storefront and bring your listings together in one
            place.
          </p>
        </div>
      )}
    </section>
  )
}

import ShiningButton from '@/components/animata/button/shining-button'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ExpandableCard } from '@/components/velora/expandable-card'
import type { ShopPreview } from '@/types/shop'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop.module.css'

export function ShopCard({
  shop,
  preview = false,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  shop: ShopPreview
  /** Local landing demo only: do not navigate to a fictional public Shop. */
  preview?: boolean
  onOverlayActiveChange?: (active: boolean) => void
  overlayClassName?: string
  overlayStyle?: React.CSSProperties
}) {
  const visual = (
    <UserAvatar
      username={shop.shopName}
      userId={shop.sellerProfileId}
      image={shop.imageUrl || shop.avatarUrl}
      className={styles.visual}
    />
  )
  return (
    <ExpandableCard
      title={shop.shopName}
      expandedTitle={shop.shopName}
      triggerLabel={`Open shop: ${shop.shopName}`}
      media={visual}
      expandedEyebrow={null}
      collapsedContent={
        <span className={styles.summary}>
          <span className={styles.name}>{shop.shopName}</span>
          <span className={styles.category}>{shop.category}</span>
          <span className={styles.excerpt}>{shop.description}</span>
          <ShopProBadge />
        </span>
      }
      primaryAction={
        preview ? null : (
          <ShiningButton
            variant="green"
            desktopAppearance={true}
            href={`/shop/${encodeURIComponent(shop.username)}`}
          >
            View Shop
          </ShiningButton>
        )
      }
      overlayClassName={overlayClassName}
      overlayStyle={overlayStyle}
      onOverlayActiveChange={onOverlayActiveChange}
    >
      <div className={styles.details}>
        <p className={styles.category}>{shop.category}</p>
        <p>{shop.description}</p>
        <ShopProBadge />
      </div>
    </ExpandableCard>
  )
}

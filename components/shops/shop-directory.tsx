import type { CSSProperties } from 'react'

import { defaultShopDirectoryQuery } from '@/lib/shop-directory'
import type { ShopDirectoryQuery } from '@/lib/shop-directory'
import type { ShopPreview } from '@/types/shop'

import { ShopDirectoryWorkspace } from './shop-directory-workspace'
import discovery from './shop-discovery.module.css'
import { ShopProPromoBanner } from './shop-pro-promo-banner'

export function ShopDirectory({
  shops = [],
  query = defaultShopDirectoryQuery,
  demo = false,
  autoOpenDemo = false,
  targetDemoProductId,
  onDetailActiveChange,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  shops?: readonly ShopPreview[]
  query?: ShopDirectoryQuery
  demo?: boolean
  autoOpenDemo?: boolean
  targetDemoProductId?: string
  onDetailActiveChange?: (active: boolean) => void
  onOverlayActiveChange?: (active: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
}) {
  return (
    <div className={discovery.directory} style={{ overflowAnchor: 'none' }}>
      <ShopDirectoryWorkspace
        query={query}
        shops={shops}
        demo={demo}
        autoOpenDemo={autoOpenDemo}
        targetDemoProductId={demo ? targetDemoProductId : undefined}
        directoryHeader={<ShopProPromoBanner />}
        overlayClassName={overlayClassName}
        overlayStyle={overlayStyle}
        onDetailActiveChange={onDetailActiveChange}
        onOverlayActiveChange={onOverlayActiveChange}
      />
    </div>
  )
}

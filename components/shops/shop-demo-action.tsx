import { ArrowRight } from 'lucide-react'
import type { MouseEvent } from 'react'

import { StatefulButton } from '@/components/velora/stateful-button'

import styles from './shop-detail-demo.module.css'

export type OpenDemoShop = (
  event: MouseEvent<HTMLButtonElement>
) => Promise<void> | undefined

export function ShopDemoOpenAction({ onOpen }: { onOpen: OpenDemoShop }) {
  return (
    <StatefulButton
      className={styles.forward}
      successText="Go to shop"
      minLoadingMs={300}
      resetAfter={800}
      aria-label="Go to Luna Studio demo shop"
      onClick={onOpen}
    >
      <span className={styles.actionLabel}>
        Go to shop <ArrowRight size={18} aria-hidden="true" />
      </span>
    </StatefulButton>
  )
}

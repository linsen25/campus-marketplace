import {
  AnimatePresence,
  m,
  useIsPresent,
  useReducedMotion,
} from 'framer-motion'
import type { ReactNode } from 'react'

import { ShopDirectory } from '@/components/shops/shop-directory'
import { listingLayoutTransition } from '@/lib/listing-layout-motion'

import styles from './market-feed-viewport.module.css'

export type MarketMode = 'resale' | 'shop'

function FeedPanel({
  mode,
  children,
  reduced,
  direction,
}: {
  mode: MarketMode
  children: ReactNode
  reduced: boolean | null
  direction: number
}) {
  const present = useIsPresent()
  return (
    <m.div
      {...{ inert: present ? undefined : '' }}
      custom={direction}
      className={styles.panel}
      data-market-feed={mode}
      data-feed-present={present}
      aria-hidden={!present}
      style={{ pointerEvents: present ? 'auto' : 'none' }}
      variants={{
        enter: (travel: number) => ({
          x: reduced ? 0 : `${travel * 100}%`,
        }),
        active: { x: 0 },
        exit: (travel: number) => ({
          x: reduced ? 0 : `${travel * -100}%`,
        }),
      }}
      initial="enter"
      animate="active"
      exit="exit"
      transition={listingLayoutTransition(reduced)}
    >
      {children}
    </m.div>
  )
}

export function MarketFeedViewport({
  mode,
  resale,
  shop = <ShopDirectory />,
}: {
  mode: MarketMode
  resale: ReactNode
  shop?: ReactNode
}) {
  const reduced = useReducedMotion()
  const direction = mode === 'shop' ? 1 : -1
  return (
    <div className={styles.viewport} data-market-feed-viewport="true">
      <AnimatePresence
        initial={false}
        exitBeforeEnter={true}
        custom={direction}
      >
        <FeedPanel
          key={mode}
          mode={mode}
          reduced={reduced}
          direction={direction}
        >
          {mode === 'resale' ? resale : shop}
        </FeedPanel>
      </AnimatePresence>
    </div>
  )
}

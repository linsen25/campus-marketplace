import { useAtomValue } from 'jotai/utils'
import { useRouter } from 'next/router'
import { useState } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { loaderFinishedAtom } from '@/components/loader/loader'

import styles from './market-mobile-nav.module.css'

export function MarketMobileNavigation() {
  const router = useRouter()
  const ready = useAtomValue(loaderFinishedAtom)
  const [activeIndex, setActiveIndex] = useState(0)
  if (!ready || router.pathname !== '/listings') return null
  return (
    <FluidTabs
      className={styles.position}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
    >
      <FluidTabs.List aria-label="Home and Market navigation">
        <FluidTabs.Tab>
          <FluidTabs.Label>Market</FluidTabs.Label>
        </FluidTabs.Tab>
        <FluidTabs.Tab>
          <FluidTabs.Label>Home</FluidTabs.Label>
        </FluidTabs.Tab>
      </FluidTabs.List>
    </FluidTabs>
  )
}

import { useAtomValue } from 'jotai/utils'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { loaderFinishedAtom } from '@/components/loader/loader'
import {
  usePageSlide,
  usePendingDestination,
} from '@/components/navigation/desktop-route-transition'

import styles from './market-mobile-nav.module.css'

export function MarketMobileNavigation() {
  const router = useRouter()
  const navigate = usePageSlide()
  const pending = usePendingDestination()
  const [hasOpened, setHasOpened] = useState(false)
  const ready = useAtomValue(loaderFinishedAtom)
  useEffect(() => {
    if (ready) setHasOpened(true)
  }, [ready])
  const routes = ['/listings', '/home']
  const activeIndex = routes.indexOf(pending ?? router.pathname)
  if ((!ready && !hasOpened) || activeIndex === -1) return null
  return createPortal(
    <FluidTabs
      className={`${styles.position} ${pending ? styles.transitioning : ''}`}
      activeIndex={activeIndex}
      onActiveIndexChange={(index) => {
        const destination = routes[index]
        if (destination && destination !== router.pathname) {
          navigate(destination)
        }
      }}
    >
      <FluidTabs.List aria-label="Home and Market navigation">
        <FluidTabs.Tab>
          <FluidTabs.Label>Market</FluidTabs.Label>
        </FluidTabs.Tab>
        <FluidTabs.Tab>
          <FluidTabs.Label>Home</FluidTabs.Label>
        </FluidTabs.Tab>
      </FluidTabs.List>
    </FluidTabs>,
    document.body
  )
}

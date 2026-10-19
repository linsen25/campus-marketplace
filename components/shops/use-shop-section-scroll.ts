import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { useMarketScroll } from '@/hooks/use-market-scroll'

/** Reuse Market's document scroll owner/animation, targeting this section only. */
export function useShopSectionScroll(heading: RefObject<HTMLHeadingElement>) {
  const { animateTo, cancel } = useMarketScroll()
  const frame = useRef<number>()
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      cancel()
    },
    [cancel]
  )
  return useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    cancel()
    frame.current = requestAnimationFrame(() => {
      const target = heading.current
      if (!target) return
      const header = target.closest('main')?.querySelector('header')
      const inset = header ? header.getBoundingClientRect().height : 0
      target.focus({ preventScroll: true })
      animateTo(
        Math.max(
          0,
          window.scrollY + target.getBoundingClientRect().top - inset - 12
        )
      )
    })
  }, [heading, animateTo, cancel])
}

import { useCallback, useEffect, useRef } from 'react'

// Pagination owns its render delay; explicit utility actions start immediately.
export function useMarketScroll() {
  const frame = useRef<number>()
  const cancel = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [])
  useEffect(() => cancel, [cancel])
  const animateTo = useCallback(
    (destination: number) => {
      cancel()
      const start = window.scrollY
      const distance = destination - start
      if (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Math.abs(distance) < 1
      ) {
        window.scrollTo({
          top: destination,
          behavior: 'instant' as ScrollBehavior,
        })
        return
      }
      const duration = Math.min(650, Math.max(350, Math.abs(distance) * 0.4))
      const started = performance.now()
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / duration)
        window.scrollTo({
          top: start + distance * progress ** 3,
          behavior: 'instant' as ScrollBehavior,
        })
        frame.current = progress < 1 ? requestAnimationFrame(step) : undefined
      }
      frame.current = requestAnimationFrame(step)
    },
    [cancel]
  )
  return { animateTo, cancel }
}

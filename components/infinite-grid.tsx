// Vertical Market adaptation of supplied UseLayouts Infinite Grid (ec26e7a1).
// Original: 3x3 absolute tiles, pointer capture, deltaX/deltaY, inertial transforms,
// and wrapping both axes. Market: keep customContent + item boundaries; use native
// vertical scrolling and repeat batches, without canvas transforms or drag capture.
import type { ReactNode } from 'react'
import { forwardRef, useEffect, useRef, useState } from 'react'

import styles from './infinite-grid.module.css'

export interface GridItem {
  id: number | string
  title: string
  customContent: ReactNode
}
const InfiniteGrid = forwardRef<
  HTMLDivElement,
  { items: GridItem[]; repeat?: boolean }
>(function InfiniteGrid({ items, repeat = true }, ref) {
  const [batches, setBatches] = useState(1)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !items.length || (!repeat && batches * 15 >= items.length))
      return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setBatches((count) => count + 1)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [items.length, batches, repeat])
  return (
    <div ref={ref} className={styles.root} data-market-grid="true">
      <div className={styles.grid}>
        {Array.from({ length: repeat ? batches : 1 }, (_, batch) =>
          (repeat ? items : items.slice(0, batches * 15)).map((item) => (
            <div
              key={`${batch}-${item.id}`}
              className={styles.item}
              data-market-card="true"
            >
              {item.customContent}
            </div>
          ))
        )}
      </div>
      {items.length > 0 && (repeat || batches * 15 < items.length) && (
        <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      )}
    </div>
  )
})
export default InfiniteGrid

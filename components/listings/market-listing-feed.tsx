import type { GridItem } from '@/components/infinite-grid'
import InfiniteGrid from '@/components/infinite-grid'
import gridStyles from '@/components/infinite-grid.module.css'

import styles from './market-layout.module.css'
import { MarketPagination } from './market-pagination'

/** The existing Resale feed: native mobile batching and desktop pagination. */
export function MarketListingFeed({
  isApp,
  items,
  repeat = false,
  feedKey,
  pageNumber,
  onChangePage,
  onReturnToTop,
}: {
  isApp: boolean
  items: GridItem[]
  repeat?: boolean
  feedKey: string
  pageNumber: number
  onChangePage: (page: number) => void
  onReturnToTop: () => void
}) {
  return isApp ? (
    <InfiniteGrid key={feedKey} items={items} repeat={repeat} />
  ) : (
    <>
      <div
        className={gridStyles.root}
        data-market-grid="true"
        data-browsing="pagination"
      >
        <div className={`${gridStyles.grid} ${styles.resaleGrid}`}>
          {items.slice((pageNumber - 1) * 15, pageNumber * 15).map((item) => (
            <div
              key={item.id}
              className={gridStyles.item}
              data-market-card="true"
            >
              {item.customContent}
            </div>
          ))}
        </div>
      </div>
      <MarketPagination
        page={pageNumber}
        pageCount={Math.ceil(items.length / 15)}
        onChange={onChangePage}
        onReturnToTop={onReturnToTop}
      />
    </>
  )
}

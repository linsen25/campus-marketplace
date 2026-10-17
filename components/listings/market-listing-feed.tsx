import { ArrowUp } from 'lucide-react'

import WorkButton from '@/components/animata/button/work-button'
import type { GridItem } from '@/components/infinite-grid'
import InfiniteGrid from '@/components/infinite-grid'
import gridStyles from '@/components/infinite-grid.module.css'

import styles from './market-layout.module.css'

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
        <div className={gridStyles.grid}>
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
      <nav className={styles.pagination} aria-label="Listing pages">
        <WorkButton
          appearance="pagination"
          type="button"
          disabled={pageNumber === 1}
          onClick={() => onChangePage(pageNumber - 1)}
        >
          Previous
        </WorkButton>
        {Array.from({ length: Math.ceil(items.length / 15) }, (_, index) => (
          <WorkButton
            key={index + 1}
            appearance="pagination"
            aria-label={`Page ${index + 1}`}
            aria-current={pageNumber === index + 1 ? 'page' : undefined}
            onClick={() => onChangePage(index + 1)}
          >
            {index + 1}
          </WorkButton>
        ))}
        <span aria-live="polite">
          Page {pageNumber} of {Math.ceil(items.length / 15)}
        </span>
        <WorkButton
          appearance="pagination"
          type="button"
          disabled={pageNumber >= Math.ceil(items.length / 15)}
          onClick={() => onChangePage(pageNumber + 1)}
        >
          Next
        </WorkButton>
        <WorkButton
          appearance="pagination"
          aria-label="Return to top"
          className={styles.returnTop}
          onClick={() => {
            onReturnToTop()
          }}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </WorkButton>
      </nav>
    </>
  )
}

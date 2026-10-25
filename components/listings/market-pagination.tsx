import { ArrowUp } from 'lucide-react'
import { Fragment } from 'react'

import WorkButton from '@/components/animata/button/work-button'

import styles from './market-layout.module.css'

/** Existing Market controls, shared without changing the feed's paging authority. */
export function MarketPagination({
  page,
  pageCount,
  onChange,
  onReturnToTop,
  label = 'Listing pages',
  className = '',
  unknownTotal = false,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
  onReturnToTop: () => void
  label?: string
  className?: string
  unknownTotal?: boolean
}) {
  const pages =
    pageCount <= 7
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : Array.from(
          new Set(
            [1, page - 1, page, page + 1, pageCount].filter(
              (value) => value >= 1 && value <= pageCount
            )
          )
        ).sort((a, b) => a - b)
  return (
    <nav className={`${styles.pagination} ${className}`} aria-label={label}>
      <WorkButton
        appearance="pagination"
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </WorkButton>
      {pages.map((value, index) => (
        <Fragment key={value}>
          {index > 0 && value - pages[index - 1] > 1 && (
            <span aria-hidden="true">…</span>
          )}
          <WorkButton
            appearance="pagination"
            aria-label={`Page ${value}`}
            aria-current={page === value ? 'page' : undefined}
            onClick={() => onChange(value)}
          >
            {value}
          </WorkButton>
        </Fragment>
      ))}
      <span aria-live="polite">
        Page {page}
        {!unknownTotal && ` of ${pageCount}`}
      </span>
      <WorkButton
        appearance="pagination"
        type="button"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
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
  )
}

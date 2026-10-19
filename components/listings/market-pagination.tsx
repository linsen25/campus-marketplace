import { ArrowUp } from 'lucide-react'

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
      {Array.from({ length: pageCount }, (_, index) => (
        <WorkButton
          key={index + 1}
          appearance="pagination"
          aria-label={`Page ${index + 1}`}
          aria-current={page === index + 1 ? 'page' : undefined}
          onClick={() => onChange(index + 1)}
        >
          {index + 1}
        </WorkButton>
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

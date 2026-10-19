import { ArrowDownWideNarrow, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import FilterInteraction from '@/components/filter-interaction'
import { marketSorts } from '@/lib/market-taxonomy'

import { MarketControlGroup, MarketFocusBackdrop } from './market-control-group'
import MarketFilter from './market-filter'
import type { MarketFilterValues } from './market-filter'

export function ListingSortFilter({
  applied,
  sort,
  onSort,
  onFilter,
  mobileLabels = false,
  triggerClassName,
  panelClassName,
  showSort = true,
  overlaySelects = false,
}: {
  applied: MarketFilterValues
  sort: string
  onSort: (value: string) => void
  onFilter: (values: MarketFilterValues) => void
  mobileLabels?: boolean
  triggerClassName?: string
  panelClassName?: string
  showSort?: boolean
  overlaySelects?: boolean
}) {
  const [panel, setPanel] = useState<'filter' | 'sort' | null>(null)
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const toggle = useCallback((kind: 'filter' | 'sort', open: boolean) => {
    clearTimeout(timer.current)
    if (open) {
      setClosing(false)
      setPanel(kind)
    } else {
      setClosing(true)
      timer.current = setTimeout(() => {
        setPanel(null)
        setClosing(false)
      }, 220)
    }
  }, [])
  return (
    <MarketControlGroup>
      {panel &&
        createPortal(
          <MarketFocusBackdrop
            closing={closing}
            onClose={() => toggle(panel, false)}
          />,
          document.body
        )}
      {showSort && (
        <FilterInteraction
          label="Sort"
          triggerClassName={triggerClassName}
          triggerContent={
            triggerClassName ? (
              <>
                <ArrowDownWideNarrow size={16} />
                <span>
                  {marketSorts.find((item) => item.value === sort)?.label}
                </span>
                <ChevronDown size={14} />
              </>
            ) : undefined
          }
          mobileLabel={mobileLabels ? 'Sort' : undefined}
          options={[...marketSorts]}
          value={sort}
          isOpen={panel === 'sort'}
          isClosing={closing}
          onOpenChange={(open) => toggle('sort', open)}
          onChange={onSort}
        />
      )}
      <FilterInteraction
        label="Filter"
        panelClassName={panelClassName}
        topLayer={overlaySelects}
        triggerClassName={triggerClassName}
        mobileLabel={mobileLabels ? 'Filter' : undefined}
        isOpen={panel === 'filter'}
        isClosing={closing}
        onOpenChange={(open) => toggle('filter', open)}
      >
        <MarketFilter
          key={JSON.stringify(applied)}
          applied={applied}
          includeCondition={true}
          overlaySelects={overlaySelects}
          onCancel={() => toggle('filter', false)}
          onConfirm={(values) => {
            onFilter(values)
            toggle('filter', false)
          }}
        />
      </FilterInteraction>
    </MarketControlGroup>
  )
}

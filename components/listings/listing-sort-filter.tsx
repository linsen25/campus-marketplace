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
}: {
  applied: MarketFilterValues
  sort: string
  onSort: (value: string) => void
  onFilter: (values: MarketFilterValues) => void
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
      <FilterInteraction
        label="Sort"
        options={[...marketSorts]}
        value={sort}
        isOpen={panel === 'sort'}
        isClosing={closing}
        onOpenChange={(open) => toggle('sort', open)}
        onChange={onSort}
      />
      <FilterInteraction
        label="Filter"
        isOpen={panel === 'filter'}
        isClosing={closing}
        onOpenChange={(open) => toggle('filter', open)}
      >
        <MarketFilter
          key={JSON.stringify(applied)}
          applied={applied}
          includeCondition={true}
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

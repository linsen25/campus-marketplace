import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import {
  MarketControlGroup,
  MarketFocusBackdrop,
} from '@/components/listings/market-control-group'
import styles from '@/components/listings/market-filter.module.css'
import { SHOP_CATEGORIES, shopDirectorySorts } from '@/lib/shop-directory'
import type { ShopCategory, ShopDirectoryQuery } from '@/lib/shop-directory'

function CategoryFilter({
  applied,
  onApply,
}: {
  applied: ShopCategory[]
  onApply: (categories: ShopCategory[]) => void
}) {
  const [draft, setDraft] = useState(applied)
  return (
    <form
      className={styles.form}
      aria-label="Shop category filter"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(draft)
      }}
    >
      <fieldset className={styles.places}>
        <legend>Category</legend>
        <div>
          {SHOP_CATEGORIES.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={draft.includes(category)}
                onChange={(e) =>
                  setDraft((current) =>
                    e.target.checked
                      ? [...current, category]
                      : current.filter((value) => value !== category)
                  )
                }
              />
              <span>{category}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.actions}>
        <button
          className={styles.cancel}
          type="button"
          onClick={() => {
            setDraft([])
            onApply([])
          }}
        >
          <span>Clear</span>
        </button>
        <ShiningButton
          variant="green"
          desktopAppearance={true}
          onClick={() => onApply(draft)}
        >
          Apply
        </ShiningButton>
      </div>
    </form>
  )
}
export function ShopDirectoryControls({
  query,
  onChange,
}: {
  query: ShopDirectoryQuery
  onChange: (query: ShopDirectoryQuery) => void
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
  const openSort = useCallback(
    (open: boolean) => toggle('sort', open),
    [toggle]
  )
  const openFilter = useCallback(
    (open: boolean) => toggle('filter', open),
    [toggle]
  )
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
        value={query.sort}
        options={shopDirectorySorts.filter(
          (option) => option.value === 'newest'
        )}
        isOpen={panel === 'sort'}
        isClosing={closing}
        onOpenChange={openSort}
        onChange={(sort) =>
          onChange({ ...query, sort: sort as ShopDirectoryQuery['sort'] })
        }
      />
      <FilterInteraction
        label="Filter"
        isOpen={panel === 'filter'}
        isClosing={closing}
        onOpenChange={openFilter}
      >
        <CategoryFilter
          key={JSON.stringify(query.categories)}
          applied={query.categories}
          onApply={(categories) => {
            onChange({ ...query, categories })
            toggle('filter', false)
          }}
        />
      </FilterInteraction>
    </MarketControlGroup>
  )
}

import { X } from 'lucide-react'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import GlideSelect from '@/components/ui/GlideSelect'
import { listingConditions } from '@/lib/listing-metadata'
import { marketCategories, marketTaxonomy } from '@/lib/market-taxonomy'
import type { MarketCategory } from '@/lib/market-taxonomy'

import styles from './market-filter.module.css'

export type MarketFilterValues = {
  category: string
  subcategory: string
  place: string
  condition?: string
}
export default function MarketFilter({
  applied,
  onDismiss,
  onConfirm,
  includeCondition = false,
  overlaySelects = false,
}: {
  applied: MarketFilterValues
  onDismiss: () => void
  onConfirm: (values: MarketFilterValues) => void
  includeCondition?: boolean
  overlaySelects?: boolean
}) {
  const [draft, setDraft] = useState(applied)
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        onConfirm(draft)
      }}
    >
      <header className={styles.header}>
        <h2>Filters</h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close filters"
          onClick={onDismiss}
        >
          <X size={18} aria-hidden={true} />
        </button>
      </header>
      <div className={styles.divider} data-filter-divider="header" />
      <div className={styles.body}>
        <div className={styles.field}>
          <span>Category</span>
          <GlideSelect
            overlay={overlaySelects}
            ariaLabel="Category"
            size="lg"
            surfaceColor="#2a2134"
            highlightColor="#443451"
            options={[
              { value: '', label: 'All categories' },
              ...marketCategories,
            ]}
            value={draft.category}
            onChange={(category) =>
              setDraft({ ...draft, category, subcategory: '' })
            }
          />
        </div>
        {draft.category && (
          <div className={styles.field}>
            <span>Subcategory</span>
            <GlideSelect
              overlay={overlaySelects}
              key={draft.category}
              ariaLabel="Subcategory"
              size="lg"
              surfaceColor="#2a2134"
              highlightColor="#443451"
              options={[
                { value: '', label: 'All subcategories' },
                ...marketTaxonomy[draft.category as MarketCategory],
              ]}
              value={draft.subcategory}
              onChange={(subcategory) => setDraft({ ...draft, subcategory })}
            />
          </div>
        )}
        {includeCondition && (
          <div className={styles.field}>
            <span>Condition</span>
            <GlideSelect
              overlay={overlaySelects}
              ariaLabel="Condition"
              size="lg"
              surfaceColor="#2a2134"
              highlightColor="#443451"
              options={[
                { value: '', label: 'All conditions' },
                ...listingConditions,
              ]}
              value={draft.condition || ''}
              onChange={(condition) => setDraft({ ...draft, condition })}
            />
          </div>
        )}
        <fieldset className={styles.places}>
          <legend>Place</legend>
          <div>
            {[
              { value: '', label: 'All places' },
              { value: 'ON_CAMPUS', label: 'On campus' },
              { value: 'OTHER', label: 'Other' },
            ].map(({ value, label }) => (
              <label key={value}>
                <input
                  type="radio"
                  name="market-place"
                  value={value}
                  checked={draft.place === value}
                  onChange={() => setDraft({ ...draft, place: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className={styles.divider} data-filter-divider="actions" />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reset}
          onClick={() =>
            setDraft({
              category: '',
              subcategory: '',
              place: '',
              condition: '',
            })
          }
        >
          Reset
        </button>
        <ShiningButton
          variant="purple"
          showArrow={false}
          desktopAppearance={true}
          onClick={() => onConfirm(draft)}
        >
          Apply filters
        </ShiningButton>
      </div>
    </form>
  )
}

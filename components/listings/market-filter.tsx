import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import GlideSelect from '@/components/ui/GlideSelect'
import { listingConditions } from '@/lib/listing-metadata'
import {
  marketCategories,
  marketLocations,
  marketTaxonomy,
} from '@/lib/market-taxonomy'
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
  onCancel,
  onConfirm,
  includeCondition = false,
}: {
  applied: MarketFilterValues
  onCancel: () => void
  onConfirm: (values: MarketFilterValues) => void
  includeCondition?: boolean
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
      <div className={styles.field}>
        <span>Category</span>
        <GlideSelect
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
          {['', ...marketLocations].map((place) => (
            <label key={place}>
              <input
                type="radio"
                name="market-place"
                value={place}
                checked={draft.place === place}
                onChange={() => setDraft({ ...draft, place })}
              />
              <span>{place || 'All places'}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <span>Cancel</span>
        </button>
        <ShiningButton
          variant="green"
          desktopAppearance={true}
          onClick={() => onConfirm(draft)}
        >
          Confirm
        </ShiningButton>
      </div>
    </form>
  )
}

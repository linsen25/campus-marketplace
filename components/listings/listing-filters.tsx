import type { ListingFilterValues } from '@/lib/listing-filters'
import {
  listingCategories,
  listingConditions,
  listingSorts,
} from '@/lib/listing-metadata'
import { Input } from '@ui/input/input'
import { Link } from '@ui/link/link'

export type ListingFiltersProps = {
  values: ListingFilterValues
}

export function ListingFilters({ values }: ListingFiltersProps) {
  const fieldClass = 'flex min-w-0 flex-col gap-2'
  const controlClass =
    'input focus-visible:ring-2 focus-visible:ring-brand-black'

  return (
    <form
      action="/listings"
      method="get"
      className="flex flex-col gap-4"
      aria-label="Filter listings"
    >
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2 laptop:grid-cols-3">
        <label className={fieldClass}>
          <span className="small-bold">Search</span>
          <Input
            name="search"
            type="search"
            defaultValue={values.search}
            placeholder="Search listings"
            className={controlClass}
          />
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Category</span>
          <select
            name="category"
            defaultValue={values.category}
            className={controlClass}
          >
            <option value="">All categories</option>
            {listingCategories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Condition</span>
          <select
            name="condition"
            defaultValue={values.condition}
            className={controlClass}
          >
            <option value="">Any condition</option>
            {listingConditions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Minimum price (CA$)</span>
          <Input
            name="minPrice"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            defaultValue={values.minPrice}
            placeholder="No minimum"
            className={controlClass}
          />
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Maximum price (CA$)</span>
          <Input
            name="maxPrice"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            defaultValue={values.maxPrice}
            placeholder="No maximum"
            className={controlClass}
          />
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Sort</span>
          <select
            name="sort"
            defaultValue={values.sort}
            className={controlClass}
          >
            {listingSorts.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary btn-small">
          Apply filters
        </button>
        <Link href="/listings" className="underline">
          Clear filters
        </Link>
      </div>
    </form>
  )
}

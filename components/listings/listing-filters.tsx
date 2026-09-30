/* eslint jsx-a11y/no-onchange: off -- Native selects retain focus; filter changes are drafts and sorting updates results in place. */
import { useRouter } from 'next/router'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { ListingFilterValues } from '@/lib/listing-filters'
import { listingFiltersUrl, parseListingFilters } from '@/lib/listing-filters'
import {
  listingCategories,
  listingConditions,
  listingSorts,
} from '@/lib/listing-metadata'
import { Input } from '@ui/input/input'

import styles from './listing-filters.module.css'
import { MarketplaceSearch } from './marketplace-search'

export type ListingFiltersProps = { values: ListingFilterValues }

export function ListingFilters({ values }: ListingFiltersProps) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(values)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fieldClass = 'flex min-w-0 flex-col gap-2'
  const controlClass =
    'input focus-visible:ring-2 focus-visible:ring-brand-black'
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
  async function navigate(next: ListingFilterValues) {
    setBusy(true)
    setError('')
    try {
      dialog.current?.close()
      const url = listingFiltersUrl(next).replace(
        '/listings',
        router.pathname === '/' ? '/' : '/listings'
      )
      await router.push(url, undefined, {
        scroll: false,
      })
    } catch {
      setError('Unable to update listings. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = { ...draft, search: values.search, sort: values.sort }
    const parsed = parseListingFilters(next)
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    navigate(parsed.values)
  }
  const chips = [
    { key: 'search', label: values.search && `Search: ${values.search}` },
    {
      key: 'category',
      label:
        listingCategories.find((item) => item.value === values.category)
          ?.label || values.category,
    },
    {
      key: 'condition',
      label:
        listingConditions.find((item) => item.value === values.condition)
          ?.label || values.condition,
    },
    { key: 'minPrice', label: values.minPrice && `Min CA$${values.minPrice}` },
    { key: 'maxPrice', label: values.maxPrice && `Max CA$${values.maxPrice}` },
    {
      key: 'status',
      label:
        values.status !== 'available' &&
        (values.status === 'all' ? 'All statuses' : 'Sold'),
    },
  ].filter((chip) => chip.label)
  return (
    <div className="flex flex-col gap-3" aria-busy={busy}>
      <MarketplaceSearch
        query={values.search}
        onSearch={(search) => navigate({ ...values, search })}
      />
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          aria-label="Active filters"
        >
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              disabled={busy}
              className="rounded-full border border-neutral-light px-3 py-2 text-sm"
              aria-label={`Remove ${chip.label} filter`}
              onClick={() =>
                navigate({
                  ...values,
                  [chip.key]: chip.key === 'status' ? 'available' : '',
                })
              }
            >
              {chip.label} <span aria-hidden="true">&times;</span>
            </button>
          ))}
          {chips.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className="text-sm underline"
              onClick={() => navigate(parseListingFilters({}).values)}
            >
              Clear all
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-small shrink-0"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="listing-filter-dialog"
          onClick={() => {
            setDraft(values)
            setError('')
            dialog.current?.showModal()
            setOpen(true)
          }}
        >
          Filter
        </button>
      </div>
      <label className="flex items-center gap-3 self-end">
        <span id="listing-sort-label" className="small-bold">
          Sort
        </span>
        <select
          aria-labelledby="listing-sort-label"
          name="sort"
          value={values.sort}
          disabled={busy}
          className={controlClass}
          onChange={(event) =>
            navigate({ ...values, sort: event.target.value })
          }
        >
          {listingSorts.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {busy && <p role="status">Updating listings...</p>}
      {error && !open && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        id="listing-filter-dialog"
        className={styles.panel}
        aria-labelledby="listing-filter-title"
        onClose={() => setOpen(false)}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => apply(event)}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 id="listing-filter-title" className="text-xl font-bold">
              Filter listings
            </h2>
            <button
              type="button"
              className="underline"
              onClick={() => dialog.current?.close()}
            >
              Close
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          <label className={fieldClass}>
            <span id="listing-category-label" className="small-bold">
              Category
            </span>
            <select
              aria-labelledby="listing-category-label"
              name="category"
              value={draft.category}
              className={controlClass}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value })
              }
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
            <span id="listing-condition-label" className="small-bold">
              Condition
            </span>
            <select
              aria-labelledby="listing-condition-label"
              name="condition"
              value={draft.condition}
              className={controlClass}
              onChange={(event) =>
                setDraft({ ...draft, condition: event.target.value })
              }
            >
              <option value="">Any condition</option>
              {listingConditions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={fieldClass}>
              <span className="small-bold">Min price (CA$)</span>
              <Input
                name="minPrice"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={draft.minPrice}
                className={controlClass}
                onChange={(event) =>
                  setDraft({ ...draft, minPrice: event.target.value })
                }
              />
            </label>
            <label className={fieldClass}>
              <span className="small-bold">Max price (CA$)</span>
              <Input
                name="maxPrice"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={draft.maxPrice}
                className={controlClass}
                onChange={(event) =>
                  setDraft({ ...draft, maxPrice: event.target.value })
                }
              />
            </label>
          </div>
          <label className={fieldClass}>
            <span id="listing-status-label" className="small-bold">
              Status
            </span>
            <select
              aria-labelledby="listing-status-label"
              name="status"
              value={draft.status}
              className={controlClass}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value })
              }
            >
              <option value="available">Available</option>
              <option value="sold">Sold</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary btn-small"
            >
              Apply filters
            </button>
            <button
              type="button"
              disabled={busy}
              className="underline"
              onClick={() => {
                setDraft({
                  ...values,
                  category: '',
                  condition: '',
                  minPrice: '',
                  maxPrice: '',
                  status: 'available',
                })
                setError('')
              }}
            >
              Reset filters
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}

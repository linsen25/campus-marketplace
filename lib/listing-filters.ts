import {
  listingCategories,
  listingConditions,
  listingSorts,
} from '@/lib/listing-metadata'
import { isMarketFilterPair, isMarketSubcategory } from '@/lib/market-taxonomy'
import type { ListingQuery } from '@/types/listing'
import { parseListingPrice } from '@/utils/parse-listing-price'

export type ListingFilterValues = {
  search: string
  category: string
  subcategory: string
  condition: string
  minPrice: string
  maxPrice: string
  sort: string
  status: string
}

export function listingFiltersUrl(values: ListingFilterValues): string {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (
      !value ||
      (key === 'sort' && value === 'newest') ||
      (key === 'status' && value === 'available')
    )
      return
    const category =
      key === 'category'
        ? listingCategories.find((item) => item.value === value)
        : undefined
    params.set(key, category?.label || value)
  })
  return `/listings${params.toString() ? `?${params.toString()}` : ''}`
}

// URL/form prices are CAD dollars; the domain boundary always receives cents.
function parsePrice(value: string): number | undefined {
  if (!value) return undefined
  return parseListingPrice(value)
}

export function parseListingFilters(
  params: Record<string, string[] | string | undefined>
): { values: ListingFilterValues; query: ListingQuery; error: string | null } {
  const read = (name: string) => {
    const value = params[name]
    return (Array.isArray(value) ? value[0] : value)?.trim() || ''
  }
  const values: ListingFilterValues = {
    search: read('search'),
    category: read('category'),
    subcategory: read('subcategory'),
    condition: read('condition'),
    minPrice: read('minPrice'),
    maxPrice: read('maxPrice'),
    sort: read('sort') || 'newest',
    status: read('status') || 'available',
  }
  const category = listingCategories.find(
    (item) => item.value === values.category
  )
  if (category) values.category = category.value
  const condition = listingConditions.find(
    (item) => item.value === values.condition
  )
  const sort = listingSorts.find((item) => item.value === values.sort)
  const query: ListingQuery = {
    search: values.search,
    category: category?.value,
    subcategory: isMarketSubcategory(values.subcategory)
      ? values.subcategory
      : undefined,
    condition: condition?.value,
    sort: sort?.value || 'newest',
    status: values.status === 'sold' ? 'sold' : 'available',
  }
  if (values.status === 'all') query.status = undefined

  try {
    if (
      !isMarketFilterPair(
        values.category || undefined,
        values.subcategory || undefined
      ) ||
      (values.condition && !condition) ||
      !sort ||
      !['available', 'sold', 'all'].includes(values.status)
    ) {
      throw new Error(
        'Choose a valid category, condition, status, and sort option.'
      )
    }
    query.minPrice = parsePrice(values.minPrice)
    query.maxPrice = parsePrice(values.maxPrice)
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new Error('Minimum price must not exceed maximum price.')
    }
    return { values, query, error: null }
  } catch (error) {
    return {
      values,
      query,
      error:
        error instanceof Error ? error.message : 'Check the selected filters.',
    }
  }
}

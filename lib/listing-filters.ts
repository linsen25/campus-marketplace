import {
  listingCategories,
  listingConditions,
  listingSorts,
} from '@/lib/listing-metadata'
import type { ListingQuery } from '@/types/listing'
import { parseListingPrice } from '@/utils/parse-listing-price'

export type ListingFilterValues = {
  search: string
  category: string
  condition: string
  minPrice: string
  maxPrice: string
  sort: string
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
    condition: read('condition'),
    minPrice: read('minPrice'),
    maxPrice: read('maxPrice'),
    sort: read('sort') || 'newest',
  }
  const category = listingCategories.find(
    (item) => item.value === values.category
  )
  const condition = listingConditions.find(
    (item) => item.value === values.condition
  )
  const sort = listingSorts.find((item) => item.value === values.sort)
  const query: ListingQuery = {
    search: values.search,
    category: category?.value,
    condition: condition?.value,
    sort: sort?.value || 'newest',
    status: 'available',
  }

  try {
    if (
      (values.category && !category) ||
      (values.condition && !condition) ||
      !sort
    ) {
      throw new Error('Choose a valid category, condition, and sort option.')
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

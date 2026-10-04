export interface SearchableListing {
  id: string
  title: string
  subcategory: string
  category: string
  description: string
}

export type SearchSuggestion =
  | { kind: 'category'; label: string; category: string; subcategory: string }
  | { kind: 'listing'; label: string; id: string }
  | { kind: 'search'; label: string; query: string }

export function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Match at word boundaries, including prefixes; never inside unrelated words.
function phraseMatch(value: string, query: string) {
  const text = normalizeSearchQuery(value)
  let index = text.indexOf(query)
  while (index >= 0) {
    if (index === 0 || !/[a-z0-9]/i.test(text[index - 1])) return true
    index = text.indexOf(query, index + 1)
  }
  return false
}

export function listingSearchRank(listing: SearchableListing, value: string) {
  const query = normalizeSearchQuery(value)
  if (!query) return 0
  const title = normalizeSearchQuery(listing.title)
  if (title === query) return 0
  if (
    !query.includes(' ') &&
    title.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))
  )
    return 1
  if (phraseMatch(title, query)) return 2
  if (phraseMatch(listing.subcategory, query)) return 3
  if (phraseMatch(listing.category, query)) return 4
  if (phraseMatch(listing.description, query)) return 5
  return null
}

export function searchListings<T extends SearchableListing>(
  listings: readonly T[],
  query: string
): T[] {
  return listings
    .map((listing, index) => ({
      listing,
      index,
      rank: listingSearchRank(listing, query),
    }))
    .filter(
      (item): item is typeof item & { rank: number } => item.rank !== null
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.listing)
}

export function searchSuggestions(
  listings: readonly SearchableListing[],
  value: string
): SearchSuggestion[] {
  const query = normalizeSearchQuery(value)
  if (!query) return []
  const pool: Array<{
    suggestion: SearchSuggestion
    rank: number
    index: number
  }> = []
  const categories = new Set<string>()
  listings.forEach((listing, index) => {
    const rank = listingSearchRank(listing, query)
    if (rank !== null)
      pool.push({
        suggestion: { kind: 'listing', label: listing.title, id: listing.id },
        rank,
        index,
      })
    const categoryOptions = ['', listing.subcategory]
    categoryOptions.forEach((subcategory) => {
      const key = `${listing.category}/${subcategory}`
      const label = subcategory
        ? `${listing.category} — ${subcategory}`
        : listing.category
      if (categories.has(key)) return
      categories.add(key)
      let categoryRank: number | null = null
      if (subcategory && phraseMatch(subcategory, query)) categoryRank = 3
      else if (phraseMatch(listing.category, query)) categoryRank = 4
      if (categoryRank !== null)
        pool.push({
          suggestion: {
            kind: 'category',
            label,
            category: listing.category,
            subcategory,
          },
          rank: categoryRank,
          index,
        })
    })
  })
  pool.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return [
    { kind: 'search', label: `Search for "${query}"`, query },
    ...pool.slice(0, 4).map((item) => item.suggestion),
  ]
}

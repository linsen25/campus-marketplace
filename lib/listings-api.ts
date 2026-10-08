import type { MarketplaceContext } from '@/lib/supabase/server'
import type {
  CreateListingInput,
  Listing,
  ListingQuery,
  UpdateListingInput,
} from '@/types/listing'

async function repository(context?: MarketplaceContext) {
  if (!context)
    throw new Error(
      'A request context is required for server-side listing access.'
    )
  const { createSupabaseListingsRepository } = await import(
    /* webpackChunkName: 'supabase-listings-repository' */ '@/lib/server/supabase-listings-repository'
  )
  return createSupabaseListingsRepository(context)
}

export async function marketplaceRequest<T>(
  path: string,
  method: string,
  input?: unknown
): Promise<T> {
  if (path === '/api/auth/sign-out' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('marketplace-session-ended'))
    try {
      localStorage.setItem('marketplace-session-ended', String(Date.now()))
    } catch {
      /* No persistent credentials. */
    }
  }
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Marketplace-Request': '1',
    },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      body?.error || 'Unable to complete the request. Please try again.'
    )
  if (path === '/api/auth/sign-out' && typeof window !== 'undefined')
    window.dispatchEvent(new Event('marketplace-session-ended'))
  return body
}

export async function getListings(
  query: ListingQuery = {},
  context: MarketplaceContext | undefined = undefined
): Promise<Listing[]> {
  if (typeof window === 'undefined')
    return (await repository(context)).getListings(query)
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value))
  })
  return marketplaceRequest(`/api/listings?${params}`, 'GET')
}
export async function getListing(
  id: string,
  context?: MarketplaceContext
): Promise<Listing | null> {
  if (typeof window === 'undefined')
    return (await repository(context)).getListing(id)
  return marketplaceRequest(`/api/listings/${encodeURIComponent(id)}`, 'GET')
}
export async function createListing(
  input: CreateListingInput,
  context?: MarketplaceContext
): Promise<Listing> {
  if (typeof window === 'undefined')
    return (await repository(context)).createListing(input)
  return marketplaceRequest('/api/listings', 'POST', input)
}
export async function updateListing(
  id: string,
  input: UpdateListingInput,
  context?: MarketplaceContext
): Promise<Listing> {
  if (typeof window === 'undefined')
    return (await repository(context)).updateListing(id, input)
  return marketplaceRequest(
    `/api/listings/${encodeURIComponent(id)}`,
    'PATCH',
    input
  )
}
export async function deleteListing(
  id: string,
  context?: MarketplaceContext
): Promise<void> {
  if (typeof window === 'undefined')
    await (await repository(context)).deleteListing(id)
  else
    await marketplaceRequest(
      `/api/listings/${encodeURIComponent(id)}`,
      'DELETE'
    )
}
export async function markListingSold(
  id: string,
  context?: MarketplaceContext
): Promise<Listing> {
  if (typeof window === 'undefined')
    return (await repository(context)).markListingSold(id)
  return marketplaceRequest(
    `/api/listings/${encodeURIComponent(id)}/sold`,
    'POST'
  )
}
export async function getMyListings(
  context?: MarketplaceContext
): Promise<Listing[]> {
  if (typeof window === 'undefined')
    return (await repository(context)).getMyListings()
  return marketplaceRequest('/api/listings?mine=true', 'GET')
}

export async function uploadListingImage(
  id: string,
  file: File
): Promise<Listing> {
  const { validateListingImage } = await import(
    /* webpackChunkName: 'listing-image-validation' */ '@/lib/listing-images'
  )
  validateListingImage(file)
  const response = await fetch(
    `/api/listing-images/${encodeURIComponent(id)}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': file.type, 'X-Marketplace-Request': '1' },
      body: file,
    }
  )
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error || 'Image upload failed. Please try again.')
  return body
}
export function removeListingImage(id: string, url: string): Promise<Listing> {
  return marketplaceRequest(
    `/api/listing-images/${encodeURIComponent(id)}?url=${encodeURIComponent(
      url
    )}`,
    'DELETE'
  )
}

export async function finalizeListing(
  id: string,
  context?: MarketplaceContext
): Promise<Listing> {
  if (typeof window === 'undefined')
    return (await repository(context)).finalizeListing(id)
  return marketplaceRequest(
    `/api/listings/${encodeURIComponent(id)}/finalize`,
    'POST'
  )
}
export async function abandonListing(
  id: string,
  context?: MarketplaceContext
): Promise<void> {
  if (typeof window === 'undefined')
    return (await repository(context)).abandonListing(id)
  return marketplaceRequest(
    `/api/listings/${encodeURIComponent(id)}/abandon`,
    'POST'
  )
}

/** Owner-only reconciliation, including unpublished creation state. */
export async function getCreationListing(
  id: string,
  context?: MarketplaceContext
): Promise<Listing> {
  if (typeof window === 'undefined')
    return (await repository(context)).getCreationListing(id)
  return marketplaceRequest(
    `/api/listings/${encodeURIComponent(id)}/creation`,
    'GET'
  )
}

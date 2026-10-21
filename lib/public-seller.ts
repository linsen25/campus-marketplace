import type { Listing } from '@/types/listing'

// UUID routes stay stable; username aliases follow the existing username rules.
import { validUsername } from './auth-username'

export const publicSellerIdentifierPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function publicSellerPath(identifier: string) {
  if (
    !publicSellerIdentifierPattern.test(identifier) &&
    !validUsername(identifier)
  )
    throw new Error('Invalid public seller identifier')
  return `/seller/${identifier.toLowerCase()}`
}

export type PublicSellerListing = Listing

export type PublicSeller = {
  identifier: string
  username: string
  // Current canonical avatar API URL only; never a local blob or arbitrary URL.
  avatarUrl: string | null
  listings: PublicSellerListing[]
  page: number
  hasNextPage: boolean
}

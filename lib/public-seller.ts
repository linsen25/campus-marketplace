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

export type PublicSellerListing = {
  id: string
  title: string
  priceCents: number
  imageUrl: string | null
}

export type PublicSeller = {
  identifier: string
  username: string
  // No persisted public avatar exists yet. Never publish local blob previews.
  avatarUrl: string | null
  listings: PublicSellerListing[]
  page: number
  hasNextPage: boolean
}

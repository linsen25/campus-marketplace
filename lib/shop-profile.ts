import { ListingApiError, listingInputRecord } from '@/lib/listing-validation'
import { shopIdentityError } from '@/lib/shop-presentation'
import type {
  CreateShopProfileInput,
  OwnerShop,
  UpdateShopProfileInput,
} from '@/types/shop'

/** Explicit creation, with no defaults or client-supplied authority. */
export function validateCreateShopProfile(
  input: unknown
): CreateShopProfileInput {
  const fields = listingInputRecord(input)
  const allowed = ['name', 'category', 'description'] as const
  if (
    Object.keys(fields).some(
      (key) => !allowed.includes(key as typeof allowed[number])
    ) ||
    allowed.some((key) => !Object.prototype.hasOwnProperty.call(fields, key))
  )
    throw new ListingApiError('Provide only name, category, and description.')
  if (allowed.some((key) => typeof fields[key] !== 'string'))
    throw new ListingApiError('Shop profile fields must be text.')
  const profile = {
    name: (fields.name as string).trim(),
    category: fields.category as string,
    description: (fields.description as string).trim(),
  }
  const error = shopIdentityError({
    shopName: profile.name,
    category: profile.category,
    description: profile.description,
  })
  if (error) throw new ListingApiError(error)
  return profile
}

/** Same identity rules as the current Shop editor; never accepts authority fields. */
export function validateShopProfilePatch(
  input: unknown,
  current: Pick<OwnerShop, 'category' | 'description' | 'name'>
): UpdateShopProfileInput {
  const fields = listingInputRecord(input)
  const allowed = ['name', 'category', 'description'] as const
  if (
    !Object.keys(fields).length ||
    Object.keys(fields).some(
      (key) => !allowed.includes(key as typeof allowed[number])
    )
  )
    throw new ListingApiError(
      'Only Shop name, category, and description may be changed.'
    )
  const patch: UpdateShopProfileInput = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      if (typeof fields[key] !== 'string')
        throw new ListingApiError('Shop profile fields must be text.')
      patch[key] = (fields[key] as string).trim()
    }
  }
  const merged = { ...current, ...patch }
  const error = shopIdentityError({
    shopName: merged.name,
    category: merged.category,
    description: merged.description,
  })
  if (error) throw new ListingApiError(error)
  return patch
}

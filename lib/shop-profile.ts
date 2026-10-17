import { ListingApiError, listingInputRecord } from '@/lib/listing-validation'
import { shopIdentityError } from '@/lib/shop-presentation'
import type { OwnerShop, UpdateShopProfileInput } from '@/types/shop'

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

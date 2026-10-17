import type { CreateListingInput, UpdateListingInput } from '@/types/listing'

// Compile-time guard: extending the read DTO must never expand write authority.
function channelWriteTypeAssertions(
  create: CreateListingInput,
  patch: UpdateListingInput
) {
  // @ts-expect-error Channel is server/database creation authority, not form input.
  create.listingChannel = 'shop'
  // @ts-expect-error Channel is not an ordinary editable Listing term.
  patch.listingChannel = 'shop'
}
export { channelWriteTypeAssertions }

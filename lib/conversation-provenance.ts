import { ListingApiError } from '@/lib/listing-validation'
import type { ConversationListingProvenance } from '@/types/conversation'

export function conversationProvenance(
  channel?: string | null,
  shopName?: string | null
): ConversationListingProvenance {
  if (channel !== 'shop') return { channel: 'resale' }
  if (!shopName?.trim())
    throw new ListingApiError('Conversation provenance unavailable.', 503)
  return { channel: 'shop', shopName }
}

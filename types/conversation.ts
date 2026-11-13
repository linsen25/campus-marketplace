import type { Listing } from './listing'

export type ConversationListingProvenance =
  | { channel: 'resale' }
  | { channel: 'shop'; shopName: string }

/** Historical context is deliberately smaller than a live Marketplace Listing. */
export type ChatListing = {
  provenance?: ConversationListingProvenance
  id: string
  liveId: string | null
  title: string
  price: number
  currency: 'CAD'
  category: string
  photoUrls: string[]
  availability:
    | 'available'
    | 'deleted'
    | 'pending'
    | 'reserved'
    | 'sold'
    | 'unavailable'
  live?: Listing
}

export type Conversation = {
  id: string
  role: 'buying' | 'selling'
  person: {
    id: string
    name: string
    avatar?: string
    uwoEmailVerified?: boolean
  }
  listing: ChatListing
  lastMessage: string
  createdAt: string
  lastMessageAt: string | null
  activityAt: string
  lastMessageSequence: number
  lastReadSequence: number
  unreadCount: number
  time?: string
  imageSendingEnabled?: boolean
}

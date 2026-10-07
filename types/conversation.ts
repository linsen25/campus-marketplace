import type { Listing } from './listing'

/** Historical context is deliberately smaller than a live Marketplace Listing. */
export type ChatListing = {
  id: string
  liveId: string | null
  title: string
  price: number
  currency: 'CAD'
  category: string
  photoUrls: string[]
  availability: 'available' | 'deleted' | 'sold' | 'unavailable'
  live?: Listing
}

export type Conversation = {
  id: string
  role: 'buying' | 'selling'
  person: { id: string; name: string; avatar?: string }
  listing: ChatListing
  lastMessage: string
  createdAt: string
  lastMessageAt: string | null
  activityAt: string
  lastMessageSequence: number
  lastReadSequence: number
  unreadCount: number
  time?: string
}

import { marketplaceRequest } from '@/lib/listings-api'
import type { Conversation } from '@/types/conversation'
import type { TextMessage } from '@/types/message'

const base = '/api/messages/conversations'
export const listConversations = (role: string, cursor?: string) =>
  marketplaceRequest<{
    conversations: Conversation[]
    nextCursor: string | null
  }>(
    `${base}?${new URLSearchParams({ role, ...(cursor ? { cursor } : {}) })}`,
    'GET'
  )
export const getConversation = (id: string) =>
  marketplaceRequest<Conversation>(`${base}/${encodeURIComponent(id)}`, 'GET')
export const findConversation = (listingId: string) =>
  marketplaceRequest<Conversation>(base, 'POST', { listingId })
export const getMessageHistory = (id: string, before?: number) =>
  marketplaceRequest<{ messages: TextMessage[]; nextBefore: number | null }>(
    `${base}/${encodeURIComponent(id)}/messages${
      before ? `?before=${before}` : ''
    }`,
    'GET'
  )
export const sendText = (
  id: string,
  content: string,
  clientMessageId: string
) =>
  marketplaceRequest<TextMessage>(
    `${base}/${encodeURIComponent(id)}/messages`,
    'POST',
    { type: 'TEXT', content, clientMessageId }
  )
export const readConversation = (id: string, throughSequence: number) =>
  marketplaceRequest<{
    conversationId: string
    unreadCount: number
    lastReadSequence: number
  }>(`${base}/${encodeURIComponent(id)}/read`, 'POST', { throughSequence })

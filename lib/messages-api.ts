import { marketplaceRequest } from '@/lib/listings-api'
import type { Conversation } from '@/types/conversation'
import type { Message, TextMessage, ImageAttachment } from '@/types/message'

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
  marketplaceRequest<{ messages: Message[]; nextBefore: number | null }>(
    `${base}/${encodeURIComponent(id)}/messages${
      before ? `?before=${before}` : ''
    }`,
    'GET'
  )

export type ImageSubmission = {
  id: string
  state: 'abandoned' | 'finalized' | 'pending'
  manifest: Array<{ id: string; position: number }>
  expiresAt: string
}
const imageBase = '/api/messages/images'
export const refreshMessageImages = (messageId: string) =>
  marketplaceRequest<{ images: ImageAttachment[] }>(
    `${imageBase}/${encodeURIComponent(messageId)}`,
    'GET'
  )
export const cancelImageSubmission = (id: string) =>
  marketplaceRequest(
    `${imageBase}/${encodeURIComponent(id)}/cancel`,
    'POST',
    {}
  )
export async function prepareImageSubmission(
  conversationId: string,
  files: File[],
  nonce: string
): Promise<ImageSubmission> {
  const images = await Promise.all(
    files.map(async (file) => ({
      original_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      sha256: Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
        )
      )
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    }))
  )
  return marketplaceRequest(
    `${imageBase}/${encodeURIComponent(conversationId)}/prepare`,
    'POST',
    { clientMessageId: nonce, images }
  )
}
export async function uploadImageSlot(
  submissionId: string,
  imageId: string,
  file: File,
  signal: AbortSignal
) {
  const response = await fetch(
    `/api/messages/image-upload/${encodeURIComponent(
      submissionId
    )}/${encodeURIComponent(imageId)}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': file.type, 'X-Marketplace-Request': '1' },
      body: file,
    }
  )
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      data?.error || 'Upload could not be confirmed. Retry the same photos.'
    )
}
export const finalizeImageSubmission = (id: string) =>
  marketplaceRequest<Message>(
    `${imageBase}/${encodeURIComponent(id)}/finalize`,
    'POST',
    {}
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

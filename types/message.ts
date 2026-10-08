/** Shared renderer model. Persisted TEXT includes its database sequence and retry ID. */
type MessageBase = {
  id: string
  conversationId: string
  senderId: string
  createdAt: string
  sequence?: number
  clientMessageId?: string
}

export type TextMessage = MessageBase & {
  type: 'TEXT'
  content: string
  sequence?: number
  clientMessageId?: string
}

export type ImageAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  previewUrl: string
  expiresAt?: string
}

export type ImageMessage = MessageBase & {
  type: 'IMAGE'
  images: ImageAttachment[]
}

export type Message = ImageMessage | TextMessage

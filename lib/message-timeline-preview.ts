import type { Message } from '../types/message'
import type { Offer } from '../types/offer'

import { groupMessages } from './message-presentation'
import type {
  PreviewRequest,
  PreviewConversationEvent,
} from './order-interaction-preview'

type DurableTimelineItem = {
  kind: 'message'
  id: string
  createdAt: string
  message: Message
}
type RequestTimelineItem = {
  kind: 'order-request'
  id: string
  createdAt: string
  request: PreviewRequest
}
type EventTimelineItem = {
  kind: 'event'
  id: string
  createdAt: string
  event: PreviewConversationEvent
}
type OfferTimelineItem = {
  kind: 'offer'
  id: string
  createdAt: string
  offer: Offer
}
export type MessageTimelineItem =
  | DurableTimelineItem
  | EventTimelineItem
  | OfferTimelineItem
  | RequestTimelineItem

/** Render-only merge. Local requests never acquire a durable message sequence. */
export function mergeMessageTimeline(
  messages: readonly Message[],
  requests: readonly PreviewRequest[],
  events: readonly PreviewConversationEvent[] = [],
  formalRequests = false,
  offers: readonly Offer[] = []
): MessageTimelineItem[] {
  return [
    ...offers.map((offer) => ({
      kind: 'offer' as const,
      id: `offer:${offer.id}`,
      createdAt: offer.createdAt,
      offer,
    })),
    ...events
      .filter((event) => !formalRequests || event.kind === 'request-cancelled')
      .map((event) => ({
        kind: 'event' as const,
        id: `event:${event.id}`,
        createdAt: event.createdAt,
        event,
      })),
    ...messages.map((message) => ({
      kind: 'message' as const,
      id: `message:${message.id}`,
      createdAt: message.createdAt,
      message,
    })),
    ...requests.map((request) => ({
      kind: 'order-request' as const,
      id: `request:${request.id}`,
      createdAt: request.createdAt,
      request,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id)
  )
}

/** Keep existing consecutive message grouping, with requests at their actual boundary. */
export function groupMessageTimeline(timeline: readonly MessageTimelineItem[]) {
  const groups: Array<
    | Extract<
        MessageTimelineItem,
        { kind: 'event' | 'offer' | 'order-request' }
      >
    | { kind: 'messages'; messages: Message[] }
  > = []
  let pending: Message[] = []
  const flush = () => {
    groups.push(
      ...groupMessages(pending).map((messages) => ({
        kind: 'messages' as const,
        messages,
      }))
    )
    pending = []
  }
  for (const item of timeline) {
    if (item.kind === 'message') {
      // Preserve sender grouping, but expose every new minute to the shared separator.
      const previous = pending[pending.length - 1]
      if (
        previous &&
        Math.floor(Date.parse(previous.createdAt) / 60000) !==
          Math.floor(Date.parse(item.createdAt) / 60000)
      )
        flush()
      pending.push(item.message)
    } else {
      flush()
      groups.push(item)
    }
  }
  flush()
  const minute = (group: typeof groups[number]) =>
    Math.floor(
      Date.parse(
        group.kind === 'messages'
          ? group.messages[0].createdAt
          : group.createdAt
      ) / 60000
    )
  return groups.map((group, index) => ({
    ...group,
    showTimestamp: index === 0 || minute(group) !== minute(groups[index - 1]),
  }))
}

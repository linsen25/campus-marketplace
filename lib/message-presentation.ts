import type { Message } from '@/types/message'

/** Histories arrive oldest first. Consecutive same-sender messages stay together. */
export function groupMessages(messages: readonly Message[]): Message[][] {
  const groups: Message[][] = []
  for (const message of messages) {
    const previous = groups[groups.length - 1]
    if (previous && previous[0].senderId === message.senderId) {
      previous.push(message)
    } else {
      groups.push([message])
    }
  }
  return groups
}

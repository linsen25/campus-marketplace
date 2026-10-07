import type { Conversation } from '@/components/client-card'

type Activity = Pick<Conversation, 'createdAt' | 'lastMessageAt'>

export function getConversationActivityAt(conversation: Activity): number {
  return Date.parse(conversation.lastMessageAt ?? conversation.createdAt)
}

/** Newest first, with a stable ID tie-break; never mutate the source collection. */
export function sortConversationsByRecent<T extends Activity & { id: string }>(
  conversations: readonly T[]
): T[] {
  return [...conversations].sort((a, b) => {
    const difference =
      getConversationActivityAt(b) - getConversationActivityAt(a)
    if (difference) return difference
    // PostgreSQL timestamps preserve microseconds; Date.parse only preserves ms.
    const fraction = (item: Activity) =>
      (
        (item.lastMessageAt ?? item.createdAt).match(/\.(\d+)/)?.[1] || ''
      ).padEnd(9, '0')
    const submillisecond = fraction(b).localeCompare(fraction(a))
    if (submillisecond) return submillisecond
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}

/* eslint-disable no-continue -- Bounded map reconciliation and dirty-scope scheduler skip ineligible entries. */
/* eslint-disable @typescript-eslint/no-use-before-define -- The batching timer and flush completion schedule each other. */
import type { Message } from '@/types/message'

// Keep durable identity and the freshest authorized IMAGE lease across racing reads.
export function mergeCanonicalMessages(
  a: readonly Message[],
  b: readonly Message[]
): Message[] {
  const map = new Map(a.map((message) => [message.id, message]))
  for (const message of b) {
    const previous = map.get(message.id)
    let next = message
    if (previous?.type === 'IMAGE' && message.type === 'IMAGE') {
      next = {
        ...message,
        images: message.images.map((image) => {
          const older = previous.images.find((entry) => entry.id === image.id)
          return older &&
            Date.parse(older.expiresAt || '') >
              Date.parse(image.expiresAt || '')
            ? older
            : image
        }),
      }
    }
    map.set(
      message.id,
      previous && JSON.stringify(previous) === JSON.stringify(next)
        ? previous
        : next
    )
  }
  const sequences = new Map<number, string>()
  for (const message of Array.from(map.values())) {
    if (!message.sequence) continue
    if (
      sequences.has(message.sequence) &&
      sequences.get(message.sequence) !== message.id
    )
      throw new Error('Unable to reconcile message history. Please refresh.')
    sequences.set(message.sequence, message.id)
  }
  return Array.from(map.values()).sort(
    (left, right) => (left.sequence || 0) - (right.sequence || 0)
  )
}

export type RefreshScope = 'buying' | 'history' | 'selling'

type HistoryPage = { messages: Message[]; nextBefore: number | null }
export async function fetchCanonicalCatchUp(
  previous: readonly Message[],
  fetchPage: (before?: number) => Promise<HistoryPage>
) {
  const horizon = previous[previous.length - 1]?.sequence || 0
  let page = await fetchPage()
  let incoming = page.messages
  let pages = 1
  if (horizon > 0)
    while (
      page.nextBefore &&
      (incoming[0]?.sequence || 0) > horizon &&
      pages < 5
    ) {
      page = await fetchPage(page.nextBefore)
      incoming = mergeCanonicalMessages(page.messages, incoming)
      pages += 1
    }
  return {
    messages: incoming,
    nextBefore: page.nextBefore,
    gap: Boolean(horizon && (incoming[0]?.sequence || 0) > horizon + 1),
    pages,
  }
}

// Constant-size dirty flags; one job per scope, two concurrent jobs, one trailing pass.
export function createMessageRefreshQueue(
  job: (scope: RefreshScope) => Promise<void>,
  delay = 100
) {
  const dirty = new Set<RefreshScope>()
  const busy = new Set<RefreshScope>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const schedule = () => {
    if (!stopped && !timer) timer = setTimeout(flush, delay)
  }
  const flush = () => {
    timer = undefined
    if (stopped) return
    for (const scope of Array.from(dirty)) {
      if (busy.size >= 2) break
      if (busy.has(scope)) continue
      dirty.delete(scope)
      busy.add(scope)
      Promise.resolve()
        .then(() => job(scope))
        .catch(() => {})
        .finally(() => {
          busy.delete(scope)
          if (dirty.size) schedule()
        })
    }
  }
  return {
    dirty(scope: RefreshScope) {
      if (!stopped) {
        dirty.add(scope)
        schedule()
      }
    },
    stop() {
      stopped = true
      dirty.clear()
      if (timer) clearTimeout(timer)
    },
  }
}

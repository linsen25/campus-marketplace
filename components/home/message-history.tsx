/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The history viewport must support keyboard scrolling. */
import { useLayoutEffect, useRef } from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import { groupMessages } from '@/lib/message-presentation'
import type { Message } from '@/types/message'

import { MessagePhotos } from './message-photos'
import styles from './messages-chat.module.css'

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
})

export function MessageHistory({
  conversationId,
  messages,
  currentUserId,
  name,
  image,
  active,
  onRendered,
  status,
  olderControl,
}: {
  conversationId: string
  messages: readonly Message[]
  currentUserId: string
  name: string
  image?: string
  active: boolean
  onRendered?: (sequence: number) => void
  status?: React.ReactNode
  olderControl?: React.ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  const previous = useRef({
    conversationId: '',
    lastId: '',
    height: 0,
    active: false,
  })
  useLayoutEffect(() => {
    const viewport = body.current
    if (!viewport) return
    const lastId = messages[messages.length - 1]?.id || ''
    if (active) {
      if (
        previous.current.conversationId !== conversationId ||
        !previous.current.active ||
        previous.current.lastId !== lastId
      )
        viewport.scrollTop = viewport.scrollHeight
      else if (viewport.scrollHeight > previous.current.height)
        viewport.scrollTop += viewport.scrollHeight - previous.current.height
    }
    previous.current = {
      conversationId,
      lastId,
      height: viewport.scrollHeight,
      active,
    }
  }, [conversationId, messages, active])

  const highest = messages.reduce(
    (sequence, item) => Math.max(sequence, item.sequence || 0),
    0
  )
  useLayoutEffect(() => {
    if (active && highest > 0) onRendered?.(highest)
  }, [active, highest, conversationId, onRendered, messages])

  return (
    <div
      ref={body}
      className={styles.body}
      aria-label="Chat messages"
      role="region"
      data-message-history={conversationId}
      tabIndex={0}
    >
      {status}
      {olderControl}
      {groupMessages(messages).map((group) => (
        <section
          className={styles.messageGroup}
          key={group[0].id}
          data-message-group="true"
        >
          <time className={styles.groupTime} dateTime={group[0].createdAt}>
            {timeFormat.format(new Date(group[0].createdAt))}
          </time>
          {group.map((message) => {
            const sent = message.senderId === currentUserId
            return (
              <div
                key={message.id}
                className={styles.messageRow}
                data-message-id={message.id}
                data-sent={sent}
              >
                {!sent && (
                  <div className={styles.messageAvatar}>
                    <UserAvatar username={name} image={image} tone="purple" />
                  </div>
                )}
                {message.type === 'TEXT' && (
                  <p className={styles.bubble}>{message.content}</p>
                )}
                {message.type === 'IMAGE' && (
                  <MessagePhotos message={message} />
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

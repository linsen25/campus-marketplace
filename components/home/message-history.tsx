/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The history viewport must support keyboard scrolling. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from 'react'

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
  const following = useRef(true)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const [newMessages, setNewMessages] = useState(false)
  const painted = useRef<ReturnType<typeof requestAnimationFrame>>()
  const observe = useCallback(() => {
    const viewport = body.current
    if (!viewport) return
    following.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
    const bounds = viewport.getBoundingClientRect()
    const visible = Array.from(
      viewport.querySelectorAll<HTMLElement>('[data-message-id]')
    ).filter((row) => {
      const box = row.getBoundingClientRect()
      return box.bottom > bounds.top && box.top < bounds.bottom
    })
    const first = visible[0]
    anchor.current = first
      ? {
          id: first.dataset.messageId || '',
          top: first.getBoundingClientRect().top - bounds.top,
        }
      : null
    if (following.current) setNewMessages(false)
    if (painted.current) cancelAnimationFrame(painted.current)
    if (
      !active ||
      !onRendered ||
      document.visibilityState !== 'visible' ||
      !viewport.getBoundingClientRect().width
    )
      return
    const highest = visible.reduce(
      (sequence, row) =>
        Math.max(sequence, Number(row.dataset.messageSequence || 0)),
      0
    )
    painted.current = requestAnimationFrame(() => {
      if (document.visibilityState === 'visible' && highest) onRendered(highest)
    })
  }, [active, onRendered])
  useLayoutEffect(() => {
    const viewport = body.current
    if (!viewport) return
    const last = messages[messages.length - 1]
    const changed = previous.current.lastId !== (last?.id || '')
    const initial =
      previous.current.conversationId !== conversationId ||
      !previous.current.active
    if (active) {
      if (
        initial ||
        following.current ||
        (changed && last?.senderId === currentUserId)
      ) {
        viewport.scrollTop = viewport.scrollHeight
      } else {
        const row = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-message-id]')
        ).find((item) => item.dataset.messageId === anchor.current?.id)
        if (row && anchor.current)
          viewport.scrollTop +=
            row.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            anchor.current.top
        if (changed) setNewMessages(true)
      }
    }
    previous.current = {
      conversationId,
      lastId: last?.id || '',
      height: viewport.scrollHeight,
      active,
    }
    observe()
  }, [conversationId, messages, active, currentUserId, observe, newMessages])
  useEffect(() => {
    const viewport = body.current
    if (!viewport) return undefined
    viewport.addEventListener('scroll', observe)
    document.addEventListener('visibilitychange', observe)
    const resize = new ResizeObserver(() => {
      if (following.current && active)
        viewport.scrollTop = viewport.scrollHeight
      else {
        const row = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-message-id]')
        ).find((item) => item.dataset.messageId === anchor.current?.id)
        if (row && anchor.current)
          viewport.scrollTop +=
            row.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            anchor.current.top
      }
      observe()
    })
    Array.from(viewport.children).forEach((child) => resize.observe(child))
    return () => {
      viewport.removeEventListener('scroll', observe)
      document.removeEventListener('visibilitychange', observe)
      resize.disconnect()
      if (painted.current) cancelAnimationFrame(painted.current)
    }
  }, [observe, messages, active])

  return (
    <div
      ref={body}
      className={styles.body}
      aria-label="Chat messages"
      role="region"
      data-message-history={conversationId}
      tabIndex={0}
    >
      {newMessages && (
        <button
          type="button"
          style={{ position: 'sticky', top: 0, zIndex: 1 }}
          onClick={() => {
            if (body.current) body.current.scrollTop = body.current.scrollHeight
            observe()
          }}
        >
          New messages ? Jump to latest
        </button>
      )}
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
                data-message-sequence={message.sequence}
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

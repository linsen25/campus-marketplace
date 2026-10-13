/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The history viewport must support keyboard scrolling. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import {
  mergeMessageTimeline,
  groupMessageTimeline,
} from '@/lib/message-timeline-preview'
import { withdrawMessage } from '@/lib/messages-api'
import type {
  PreviewRequest,
  PreviewConversationEvent,
} from '@/lib/order-interaction-preview'
import type { Message } from '@/types/message'
import type { Agreement, Offer } from '@/types/offer'

import { MessagePhotos } from './message-photos'
import styles from './messages-chat.module.css'
import { WithdrawContext } from './withdraw-context'

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
})

function TimelineTimestamp({
  createdAt,
  show,
}: {
  createdAt: string
  show: boolean
}) {
  return show ? (
    <time
      className={styles.groupTime}
      dateTime={createdAt}
      data-time-separator="true"
    >
      {timeFormat.format(new Date(createdAt))}
    </time>
  ) : null
}

/** Shared sender/viewer alignment for plain messages and rich local previews. */
export function MessageRow({
  senderId,
  currentUserId,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  senderId: string
  currentUserId: string
  children: React.ReactNode
}) {
  return (
    <div
      {...props}
      className={styles.messageRow}
      data-sent={senderId === currentUserId}
    >
      {children}
    </div>
  )
}

const emptyEvents: readonly PreviewConversationEvent[] = []
const emptyRequests: readonly PreviewRequest[] = []
const requestEventTitles = {
  'request-cancelled': 'Order Request cancelled',
  'request-replaced': 'Order Request replaced',
  'request-expired': 'Order Request expired',
}

export function MessageHistory({
  conversationId,
  messages,
  currentUserId,
  perspectiveUserId = currentUserId,
  name,
  image,
  active,
  onRendered,
  status,
  olderControl,
  orderRequests = emptyRequests,
  orderRequestSenderId,
  renderOrderRequest,
  previewEvents = emptyEvents,
  formalRequests = false,
  offers = [],
  renderOffer,
  agreements = [],
  renderAgreement,
}: {
  conversationId: string
  messages: readonly Message[]
  currentUserId: string
  perspectiveUserId?: string
  name: string
  image?: string
  active: boolean
  onRendered?: (sequence: number) => void
  status?: React.ReactNode
  olderControl?: React.ReactNode
  orderRequests?: readonly PreviewRequest[]
  orderRequestSenderId?: string
  previewEvents?: readonly PreviewConversationEvent[]
  offers?: readonly Offer[]
  renderOffer?: (offer: Offer) => React.ReactNode
  agreements?: readonly Agreement[]
  renderAgreement?: (agreement: Agreement) => React.ReactNode
  formalRequests?: boolean
  renderOrderRequest?: (request: PreviewRequest) => React.ReactNode
}) {
  // A server-issued withdrawal receipt redacts stale history while refetch recovers.
  const [withdrawalReceipts, setWithdrawalReceipts] = useState<
    Record<string, Message>
  >({})
  useEffect(() => setWithdrawalReceipts({}), [conversationId, currentUserId])
  const timeline = useMemo(
    () =>
      mergeMessageTimeline(
        messages,
        orderRequests,
        previewEvents,
        formalRequests,
        offers,
        agreements
      ),
    [messages, orderRequests, previewEvents, formalRequests, offers, agreements]
  )
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
      viewport.querySelectorAll<HTMLElement>('[data-timeline-id]')
    ).filter((row) => {
      const box = row.getBoundingClientRect()
      return box.bottom > bounds.top && box.top < bounds.bottom
    })
    const first = visible[0]
    anchor.current = first
      ? {
          id: first.dataset.timelineId || '',
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
    const last = timeline[timeline.length - 1]
    let lastSender = orderRequestSenderId
    if (last?.kind === 'message') lastSender = last.message.senderId
    if (last?.kind === 'offer') lastSender = last.offer.senderId
    const changed = previous.current.lastId !== (last?.id || '')
    const initial =
      previous.current.conversationId !== conversationId ||
      !previous.current.active
    if (active) {
      if (
        initial ||
        following.current ||
        (changed && lastSender === currentUserId)
      ) {
        viewport.scrollTop = viewport.scrollHeight
      } else {
        const row = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-timeline-id]')
        ).find((item) => item.dataset.timelineId === anchor.current?.id)
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
  }, [
    conversationId,
    messages,
    timeline,
    active,
    currentUserId,
    orderRequestSenderId,
    observe,
    newMessages,
  ])
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
          viewport.querySelectorAll<HTMLElement>('[data-timeline-id]')
        ).find((item) => item.dataset.timelineId === anchor.current?.id)
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
  }, [observe, messages, orderRequests, active])

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
      {groupMessageTimeline(timeline).map((item) => {
        if (item.kind === 'agreement')
          return (
            <section
              key={item.id}
              className={styles.messageGroup}
              data-timeline-agreement={item.agreement.id}
            >
              <TimelineTimestamp
                createdAt={item.createdAt}
                show={item.showTimestamp}
              />
              <div className={styles.systemEvent}>
                {renderAgreement?.(item.agreement)}
              </div>
            </section>
          )
        if (item.kind === 'offer')
          return (
            <section
              key={item.id}
              className={styles.messageGroup}
              data-timeline-offer={item.offer.id}
              data-timeline-created-at={item.createdAt}
            >
              <TimelineTimestamp
                createdAt={item.createdAt}
                show={item.showTimestamp}
              />
              <MessageRow
                senderId={item.offer.senderId}
                currentUserId={currentUserId}
                data-timeline-id={item.id}
              >
                {renderOffer?.(item.offer)}
              </MessageRow>
            </section>
          )
        if (item.kind === 'event' && formalRequests)
          return (
            <section
              key={item.id}
              className={styles.messageGroup}
              data-timeline-event={item.event.id}
              data-timeline-created-at={item.createdAt}
            >
              <TimelineTimestamp
                createdAt={item.createdAt}
                show={item.showTimestamp}
              />
              <MessageRow
                senderId={item.event.actorId || orderRequestSenderId || ''}
                currentUserId={currentUserId}
                data-timeline-id={item.id}
                data-automatic-notification="request-cancelled"
              >
                <div
                  className={`${styles.bubble} ${styles.automaticNotification}`}
                >
                  <span className={styles.automaticLabel}>Order update</span>
                  <strong>Order Request cancelled</strong>
                  {item.event.cancellation && (
                    <p>Reason: {item.event.cancellation.cancelReason}</p>
                  )}
                  {item.event.cancellation?.cancelNote && (
                    <p>{item.event.cancellation.cancelNote}</p>
                  )}
                </div>
              </MessageRow>
            </section>
          )
        if (item.kind === 'event')
          return (
            <section
              key={item.id}
              className={styles.messageGroup}
              data-timeline-event={item.event.id}
              data-timeline-created-at={item.createdAt}
            >
              <TimelineTimestamp
                createdAt={item.createdAt}
                show={item.showTimestamp}
              />
              <div className={styles.systemEvent} data-timeline-id={item.id}>
                <strong>
                  {item.event.kind === 'order-cancelled'
                    ? `Order cancelled by ${item.event.cancellation?.cancelledBy}`
                    : requestEventTitles[item.event.kind]}
                </strong>
                <p>
                  {item.event.kind === 'request-cancelled' &&
                    'Seller cancelled this request.'}
                </p>
                {item.event.cancellation && (
                  <p>Reason: {item.event.cancellation.cancelReason}</p>
                )}
                {item.event.cancellation?.cancelNote && (
                  <p>{item.event.cancellation.cancelNote}</p>
                )}
              </div>
            </section>
          )
        if (item.kind === 'order-request')
          return (
            <section
              key={item.id}
              className={styles.messageGroup}
              data-timeline-request={item.request.id}
              data-timeline-created-at={item.createdAt}
            >
              <TimelineTimestamp
                createdAt={item.createdAt}
                show={item.showTimestamp}
              />
              <MessageRow
                senderId={orderRequestSenderId || ''}
                currentUserId={perspectiveUserId}
                data-timeline-id={item.id}
              >
                {renderOrderRequest?.(item.request)}
              </MessageRow>
            </section>
          )
        return (() => {
          const group = item.messages
          return (
            <section
              className={styles.messageGroup}
              key={group[0].id}
              data-message-group="true"
              data-timeline-created-at={group[0].createdAt}
            >
              <TimelineTimestamp
                createdAt={group[0].createdAt}
                show={item.showTimestamp}
              />
              {group.map((source) => {
                const message = withdrawalReceipts[source.id] || source
                const sent = message.senderId === perspectiveUserId
                return (
                  <MessageRow
                    key={message.id}
                    senderId={message.senderId}
                    currentUserId={perspectiveUserId}
                    data-timeline-id={`message:${message.id}`}
                    data-message-id={message.id}
                    data-message-sequence={message.sequence}
                  >
                    {!sent && (
                      <div className={styles.messageAvatar}>
                        <UserAvatar
                          username={name}
                          image={image}
                          tone="purple"
                        />
                      </div>
                    )}
                    {message.withdrawnAt ? (
                      <small>{sent ? 'You' : name} withdrew a message.</small>
                    ) : (
                      <WithdrawContext
                        enabled={sent && Boolean(message.canWithdraw)}
                        createdAt={message.createdAt}
                        onWithdraw={async () => {
                          const receipt = await withdrawMessage(message.id)
                          setWithdrawalReceipts((receipts) => ({
                            ...receipts,
                            [message.id]: receipt,
                          }))
                          window.dispatchEvent(
                            new CustomEvent(
                              'marketplace-messages-invalidated',
                              { detail: { conversationId } }
                            )
                          )
                        }}
                      >
                        {message.type === 'TEXT' && (
                          <p className={styles.bubble}>{message.content}</p>
                        )}
                        {message.type === 'IMAGE' && (
                          <MessagePhotos message={message} />
                        )}
                      </WithdrawContext>
                    )}
                  </MessageRow>
                )
              })}
            </section>
          )
        })()
      })}
    </div>
  )
}

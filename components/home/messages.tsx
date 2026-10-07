'use client'

import { useRouter } from 'next/router'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import {
  ClientCard,
  ClientCardBack,
  ConversationList,
} from '@/components/client-card'
import type { Conversation } from '@/components/client-card'
import clientStyles from '@/components/client-card.module.css'
import styles from '@/components/listings/listing-workspace.module.css'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import { sortConversationsByRecent } from '@/lib/conversation-state'
import {
  listConversations,
  getConversation,
  getMessageHistory,
  sendText,
  readConversation,
} from '@/lib/messages-api'
import { pageSlideOptions } from '@/lib/page-slide'
import type { Message } from '@/types/message'

import { MessagesChat } from './messages-chat'
import messageStyles from './messages.module.css'

const emptyCollections = {
  buying: [] as Conversation[],
  selling: [] as Conversation[],
}
const mergeMessages = (a: readonly Message[], b: readonly Message[]) =>
  Array.from(
    new Map([...a, ...b].map((item) => [item.id, item])).values()
  ).sort(
    (left, right) =>
      (left.type === 'TEXT' ? left.sequence || 0 : 0) -
      (right.type === 'TEXT' ? right.sequence || 0 : 0)
  )

// eslint-disable-next-line complexity -- Owns the existing two responsive screens and their async lifecycle.
export function Messages({
  destination,
  mobile = false,
}: {
  destination: string
  mobile?: boolean
}) {
  const active = destination === 'selling' ? 'selling' : 'buying'
  const router = useRouter()
  const { seller, loading: sessionLoading } = useMarketplaceSession()
  const userId = seller?.id
  const [collections, setCollections] = useState(emptyCollections)
  const [histories, setHistories] = useState<Record<string, Message[]>>({})
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [before, setBefore] = useState<Record<string, number | null>>({})
  const [cursor, setCursor] = useState<Record<string, string | null>>({})
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [retry, setRetry] = useState(0)
  const [detailDestination, setDetailDestination] = useState<string | null>(
    null
  )
  const [selectedIds, setSelectedIds] = useState<
    Record<'buying' | 'selling', string | null>
  >({ buying: null, selling: null })
  const consumedEntry = useRef<string | null>(null)
  const account = useRef(userId)
  account.current = userId
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    consumedEntry.current = null
    setCollections(emptyCollections)
    setHistories({})
    setLoaded({})
    setBefore({})
    setCursor({})
    setSelectedIds({ buying: null, selling: null })
    setDetailDestination(null)
  }, [userId])
  useEffect(() => setDetailDestination(null), [active])
  const showDetail = detailDestination === active
  const updateConversation = useCallback((item: Conversation) => {
    setCollections((current) => ({
      ...current,
      [item.role]: [
        ...current[item.role].filter((entry) => entry.id !== item.id),
        item,
      ],
    }))
  }, [])
  useEffect(() => {
    if (!userId) {
      setListLoading(sessionLoading)
      return undefined
    }
    let valid = true
    setListLoading(true)
    setError('')
    listConversations(active)
      .then(async (page) => {
        if (!valid) return
        let entries = page.conversations
        const requested =
          router.query.section === 'messages' &&
          typeof router.query.conversation === 'string'
            ? router.query.conversation
            : null
        if (requested && consumedEntry.current !== requested) {
          const item =
            entries.find((entry) => entry.id === requested) ||
            (await getConversation(requested))
          if (!valid) return
          if (item.role === active) {
            if (!entries.some((entry) => entry.id === item.id))
              entries = [...entries, item]
            setSelectedIds((ids) => ({ ...ids, [active]: item.id }))
            consumedEntry.current = requested
            setDetailDestination(active)
          }
        }
        if (!mobile)
          setSelectedIds((ids) => ({
            ...ids,
            [active]: ids[active] || entries[0]?.id || null,
          }))
        setCollections((current) => ({ ...current, [active]: entries }))
        setCursor((current) => ({ ...current, [active]: page.nextCursor }))
      })
      .catch((reason) => {
        if (valid) setError(reason.message)
      })
      .finally(() => {
        if (valid) setListLoading(false)
      })
    return () => {
      valid = false
    }
  }, [
    active,
    mobile,
    userId,
    sessionLoading,
    retry,
    router.query.section,
    router.query.conversation,
  ])
  const conversations = sortConversationsByRecent(collections[active])
  const selected =
    conversations.find((item) => item.id === selectedIds[active]) ||
    conversations[0]
  const selectedId = selected?.id
  const chatActive = !mobile || showDetail
  useEffect(() => {
    if (!selectedId || !chatActive || !userId) return undefined
    let valid = true
    setHistoryError('')
    getMessageHistory(selectedId)
      .then((page) => {
        if (!valid) return
        setHistories((current) => ({
          ...current,
          [selectedId]: mergeMessages(current[selectedId] || [], page.messages),
        }))
        setBefore((current) => ({ ...current, [selectedId]: page.nextBefore }))
        setLoaded((current) => ({ ...current, [selectedId]: true }))
      })
      .catch((reason) => {
        if (valid) setHistoryError(reason.message)
      })
    return () => {
      valid = false
    }
  }, [selectedId, chatActive, userId, retry])
  const acknowledged = useRef<Record<string, number>>({})
  useEffect(() => {
    acknowledged.current = {}
  }, [userId])
  const markRendered = useCallback(
    (sequence: number) => {
      if (
        !selectedId ||
        !chatActive ||
        !userId ||
        sequence <= (acknowledged.current[selectedId] || 0)
      )
        return
      const id = selectedId
      acknowledged.current[id] = sequence
      readConversation(id, sequence)
        .then((result) => {
          if (!mounted.current || account.current !== userId) return
          setCollections((current) => ({
            ...current,
            [active]: current[active].map((item) =>
              item.id === id && result.lastReadSequence >= item.lastReadSequence
                ? {
                    ...item,
                    unreadCount: result.unreadCount,
                    lastReadSequence: result.lastReadSequence,
                  }
                : item
            ),
          }))
        })
        .catch((reason) => {
          if (!mounted.current || account.current !== userId) return
          delete acknowledged.current[id]
          setHistoryError(reason.message)
        })
    },
    [selectedId, chatActive, userId, active]
  )
  const select = (conversation: Conversation) =>
    setSelectedIds((current) => ({ ...current, [active]: conversation.id }))
  const send = async (content: string, clientMessageId: string) => {
    if (!selectedId || !userId)
      throw new Error('Open a conversation before sending.')
    const id = selectedId
    const message = await sendText(id, content, clientMessageId)
    if (!mounted.current || account.current !== userId) return
    setHistories((current) => ({
      ...current,
      [id]: mergeMessages(current[id] || [], [message]),
    }))
    // Canonical activity/read data comes from the server, never a local clock.
    // A detail-refresh failure must not report an already committed send as failed.
    try {
      const item = await getConversation(id)
      if (mounted.current && account.current === userId)
        updateConversation(item)
    } catch (reason) {
      if (mounted.current && account.current === userId)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to refresh conversation.'
        )
    }
  }
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadOlder = async () => {
    if (!selectedId || !before[selectedId] || loadingOlder) return
    const id = selectedId
    setLoadingOlder(true)
    try {
      const page = await getMessageHistory(id, before[id] || undefined)
      if (!mounted.current || account.current !== userId) return
      setHistories((current) => ({
        ...current,
        [id]: mergeMessages(current[id] || [], page.messages),
      }))
      setBefore((current) => ({ ...current, [id]: page.nextBefore }))
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : 'Unable to load older messages.'
      )
    } finally {
      setLoadingOlder(false)
    }
  }
  // eslint-disable-next-line no-nested-ternary
  const status = historyError ? (
    <p role="alert">
      {historyError}{' '}
      <button type="button" onClick={() => setRetry((value) => value + 1)}>
        Retry
      </button>
    </p>
  ) : selectedId && !loaded[selectedId] ? (
    <p role="status">Loading messages...</p>
  ) : undefined
  const chat =
    selected && userId ? (
      <MessagesChat
        key={`${active}-${selected.id}`}
        conversationId={selected.id}
        messages={histories[selected.id] || []}
        currentUserId={userId}
        name={selected.person.name}
        image={selected.person.avatar}
        time={selected.time}
        destination={active}
        listing={selected.listing}
        active={chatActive}
        historyStatus={status}
        olderControl={
          before[selected.id] ? (
            <button type="button" disabled={loadingOlder} onClick={loadOlder}>
              Load older messages
            </button>
          ) : undefined
        }
        onSend={send}
        onRendered={markRendered}
      />
    ) : null
  const track = useRef<HTMLDivElement>(null)
  const previousDetail = useRef(false)
  const [sliding, setSliding] = useState(false)
  useLayoutEffect(() => {
    const element = track.current
    if (!mobile || !element) return undefined
    const target = showDetail ? 'translateX(-100%)' : 'translateX(0)'
    const previous = previousDetail.current
    previousDetail.current = showDetail
    element.style.transform = target
    for (const screen of Array.from(element.children)) {
      const inactive =
        screen.getAttribute('data-mobile-message-screen') !==
        (showDetail ? 'detail' : 'list')
      screen.toggleAttribute('inert', inactive)
    }
    if (previous === showDetail) return undefined
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    setSliding(!reduced)
    const source = previous ? 'translateX(-100%)' : 'translateX(0)'
    const animation = element.animate(
      [
        {
          transform: reduced ? target : source,
        },
        { transform: target },
      ],
      pageSlideOptions(true, reduced)
    )
    animation.onfinish = () => setSliding(false)
    return () => animation.cancel()
  }, [mobile, showDetail])
  return (
    <section className={styles.workspace} aria-label="Messages">
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {listLoading && !conversations.length && (
        <p role="status">Loading conversations...</p>
      )}
      {!listLoading && !error && !conversations.length && (
        <WorkspaceEmpty>
          {userId
            ? 'No conversations yet.'
            : 'Sign in with your Western account to view Messages.'}
        </WorkspaceEmpty>
      )}
      {cursor[active] && (
        <button
          type="button"
          onClick={async () => {
            try {
              const page = await listConversations(
                active,
                cursor[active] || undefined
              )
              if (account.current !== userId || !mounted.current) return
              setCollections((current) => ({
                ...current,
                [active]: Array.from(
                  new Map(
                    [...current[active], ...page.conversations].map((item) => [
                      item.id,
                      item,
                    ])
                  ).values()
                ),
              }))
              setCursor((current) => ({
                ...current,
                [active]: page.nextCursor,
              }))
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Unable to load conversations.'
              )
            }
          }}
        >
          Load more conversations
        </button>
      )}
      {conversations.length > 0 && (
        <div className={messageStyles.conversations}>
          {mobile ? (
            <div
              className={`${clientStyles.wrapper} ${messageStyles.mobileSurface}`}
              data-mobile-messages="true"
            >
              <div
                className={messageStyles.mobileViewport}
                data-messages-viewport="true"
              >
                <div
                  ref={track}
                  className={messageStyles.mobileTrack}
                  data-messages-track="true"
                  data-sliding={sliding}
                >
                  <div
                    className={messageStyles.mobileList}
                    aria-hidden={showDetail}
                    data-inactive={showDetail && !sliding}
                    data-mobile-message-screen="list"
                  >
                    <ConversationList
                      conversations={conversations}
                      selectedId=""
                      dynamicArrow={true}
                      onSelect={(conversation) => {
                        select(conversation)
                        setDetailDestination(active)
                      }}
                    />
                  </div>
                  <div
                    className={messageStyles.mobileDetail}
                    aria-hidden={!showDetail}
                    data-inactive={!showDetail && !sliding}
                    data-mobile-message-screen="detail"
                  >
                    <div className={messageStyles.mobileBack}>
                      <ClientCardBack
                        onClick={() => setDetailDestination(null)}
                      />
                    </div>
                    {chat}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <ClientCard
              conversations={conversations}
              selectedId={selected?.id || ''}
              onSelect={select}
            >
              {chat}
            </ClientCard>
          )}
        </div>
      )}
    </section>
  )
}

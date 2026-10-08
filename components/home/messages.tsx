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
import { connectMessagesRealtime } from '@/lib/messages-realtime'
import {
  createMessageRefreshQueue,
  fetchCanonicalCatchUp,
  mergeCanonicalMessages,
} from '@/lib/messages-reconciliation'
import { pageSlideOptions } from '@/lib/page-slide'
import type { Message } from '@/types/message'

import { MessagesChat } from './messages-chat'
import messageStyles from './messages.module.css'

const emptyCollections = {
  buying: [] as Conversation[],
  selling: [] as Conversation[],
}
const mergeMessages = mergeCanonicalMessages

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
  const {
    seller,
    loading: sessionLoading,
    refresh: refreshSession,
  } = useMarketplaceSession()
  const userId = seller?.id
  const [collections, setCollections] = useState(emptyCollections)
  const [histories, setHistories] = useState<Record<string, Message[]>>({})
  const [catchUp, setCatchUp] = useState<Record<string, Message[]>>({})
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
  const sessionOpen = useRef(true)
  const accountGeneration = useRef(0)
  const previousAccount = useRef(userId)
  if (previousAccount.current !== userId) {
    previousAccount.current = userId
    accountGeneration.current += 1
    sessionOpen.current = Boolean(userId)
  }
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
    setCatchUp({})
    setBefore({})
    setCursor({})
    setSelectedIds({ buying: null, selling: null })
    setDetailDestination(null)
  }, [userId])
  useEffect(() => setDetailDestination(null), [active])
  const showDetail = detailDestination === active
  const updateConversation = useCallback((item: Conversation) => {
    setCollections((current) => {
      const previous = current[item.role].find((entry) => entry.id === item.id)
      if (
        previous &&
        (previous.lastMessageSequence > item.lastMessageSequence ||
          (previous.lastMessageSequence === item.lastMessageSequence &&
            previous.lastReadSequence > item.lastReadSequence))
      )
        return current
      return {
        ...current,
        [item.role]: [
          ...current[item.role].filter((entry) => entry.id !== item.id),
          item,
        ],
      }
    })
  }, [])
  const refreshJobs = useRef<ReturnType<typeof createMessageRefreshQueue>>()
  useEffect(() => {
    if (!userId) {
      setListLoading(sessionLoading)
      return
    }
    setListLoading(true)
    setError('')
    refreshJobs.current?.dirty(active)
  }, [active, userId, sessionLoading, retry])
  useEffect(() => {
    if (!userId) return undefined
    let valid = true
    const generation = accountGeneration.current
    const requested =
      router.query.section === 'messages' &&
      typeof router.query.conversation === 'string'
        ? router.query.conversation
        : null
    if (!requested || consumedEntry.current === requested) return undefined
    getConversation(requested)
      .then((item) => {
        if (
          !valid ||
          !sessionOpen.current ||
          accountGeneration.current !== generation ||
          account.current !== userId ||
          item.role !== active
        )
          return
        updateConversation(item)
        setSelectedIds((ids) => ({ ...ids, [active]: item.id }))
        consumedEntry.current = requested
        setDetailDestination(active)
      })
      .catch(() => {
        if (valid) setError('Unable to open this conversation. Please retry.')
      })
    return () => {
      valid = false
    }
  }, [
    active,
    userId,
    retry,
    router.query.section,
    router.query.conversation,
    updateConversation,
  ])
  const conversations = sortConversationsByRecent(collections[active])
  const selected =
    conversations.find((item) => item.id === selectedIds[active]) ||
    conversations[0]
  const selectedId = selected?.id
  const chatActive = !mobile || showDetail
  useEffect(() => {
    if (selectedId && chatActive && userId)
      refreshJobs.current?.dirty('history')
  }, [selectedId, chatActive, userId, retry])
  const realtimeView = useRef({ selectedId, chatActive, active })
  realtimeView.current = { selectedId, chatActive, active }
  const historyChain = useRef<Promise<unknown>>(Promise.resolve())
  const readHistory = useCallback((id: string, cursorBefore?: number) => {
    const request = historyChain.current.then(() =>
      getMessageHistory(id, cursorBefore)
    )
    historyChain.current = request.catch(() => {})
    return request
  }, [])
  const historyCache = useRef(histories)
  historyCache.current = histories
  const viewVersion = useRef(0)
  const previousView = useRef('')
  const viewKey = `${userId}:${selectedId}:${chatActive}:${active}`
  if (previousView.current !== viewKey) {
    previousView.current = viewKey
    viewVersion.current += 1
  }
  const sessionRefresh = useRef(refreshSession)
  sessionRefresh.current = refreshSession
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  useEffect(() => {
    if (!userId) return undefined
    let valid = true
    const generation = accountGeneration.current
    const queue = createMessageRefreshQueue(async (scope) => {
      const version = viewVersion.current
      const view = realtimeView.current
      const accepts = () =>
        valid &&
        mounted.current &&
        account.current === userId &&
        sessionOpen.current &&
        accountGeneration.current === generation
      try {
        if (scope !== 'history') {
          const page = await listConversations(scope)
          const selectedOutside = selectedIdsRef.current[scope]
          const detail =
            selectedOutside &&
            !page.conversations.some((item) => item.id === selectedOutside)
              ? await getConversation(selectedOutside).catch(() => null)
              : null
          if (!accepts()) return
          setCollections((current) => ({
            ...current,
            [scope]: detail
              ? [...page.conversations, detail]
              : page.conversations,
          }))
          setCursor((current) => ({ ...current, [scope]: page.nextCursor }))
          if (scope === realtimeView.current.active) {
            setListLoading(false)
            setError('')
          }
        } else if (
          view.selectedId &&
          view.chatActive &&
          document.visibilityState === 'visible'
        ) {
          const id = view.selectedId
          const old = historyCache.current[id] || []
          const result = await fetchCanonicalCatchUp(old, (older) =>
            readHistory(id, older)
          )
          if (!accepts() || viewVersion.current !== version) return
          const incoming = result.messages
          const gap = result.gap
          setHistories((current) => ({
            ...current,
            [id]: mergeMessages(current[id] || [], incoming),
          }))
          setBefore((current) => ({
            ...current,
            [id]:
              !gap &&
              old[0] &&
              (old[0].sequence || 0) <= (incoming[0]?.sequence || 0) &&
              current[id] !== undefined
                ? current[id]
                : result.nextBefore,
          }))
          setCatchUp((current) => ({ ...current, [id]: gap ? incoming : [] }))
          setLoaded((current) => ({ ...current, [id]: true }))
          setHistoryError('')
        }
      } catch {
        if (
          accepts() &&
          scope !== 'history' &&
          scope === realtimeView.current.active
        ) {
          setListLoading(false)
          setError('Unable to refresh conversations. Please retry.')
        }
        if (accepts() && scope === 'history' && viewVersion.current === version)
          setHistoryError('Unable to refresh messages. Please retry.')
      }
    })
    refreshJobs.current = queue
    queue.dirty('buying')
    queue.dirty('selling')
    queue.dirty('history')
    const recover = () => {
      if (!valid) return
      queue.dirty('buying')
      queue.dirty('selling')
      queue.dirty('history')
    }
    const stop = connectMessagesRealtime(
      userId,
      (signal) => {
        if (!valid) return
        queue.dirty(signal.role)
        const view = realtimeView.current
        if (view.chatActive && signal.conversationId === view.selectedId)
          queue.dirty('history')
      },
      recover,
      () => {
        valid = false
        sessionOpen.current = false
        accountGeneration.current += 1
        queue.stop()
        sessionRefresh.current().catch(() => {})
      }
    )
    return () => {
      valid = false
      queue.stop()
      stop()
      refreshJobs.current = undefined
    }
  }, [userId, readHistory])
  const acknowledged = useRef<Record<string, number>>({})
  const pendingRead = useRef<Record<string, number>>({})
  const reading = useRef(new Set<string>())
  useEffect(() => {
    acknowledged.current = {}
    pendingRead.current = {}
    reading.current.clear()
  }, [userId])
  const markRendered = useCallback(
    (sequence: number) => {
      if (
        !sessionOpen.current ||
        !selectedId ||
        !chatActive ||
        !userId ||
        document.visibilityState !== 'visible' ||
        sequence <= (acknowledged.current[selectedId] || 0)
      )
        return
      const id = selectedId
      const generation = accountGeneration.current
      pendingRead.current[id] = Math.max(pendingRead.current[id] || 0, sequence)
      if (reading.current.has(id)) return
      reading.current.add(id)
      const flush = async () => {
        try {
          while (
            sessionOpen.current &&
            accountGeneration.current === generation &&
            mounted.current &&
            account.current === userId &&
            realtimeView.current.selectedId === id &&
            realtimeView.current.chatActive &&
            document.visibilityState === 'visible' &&
            (pendingRead.current[id] || 0) > (acknowledged.current[id] || 0)
          ) {
            const result = await readConversation(id, pendingRead.current[id])
            if (!mounted.current || account.current !== userId) return
            acknowledged.current[id] = Math.max(
              acknowledged.current[id] || 0,
              result.lastReadSequence
            )
            // Read response can race a newer message; refetch the canonical list.
            refreshJobs.current?.dirty(active)
          }
        } catch {
          if (
            mounted.current &&
            account.current === userId &&
            sessionOpen.current &&
            accountGeneration.current === generation
          )
            setHistoryError('Unable to acknowledge messages. Please retry.')
        } finally {
          reading.current.delete(id)
        }
      }
      flush()
    },
    [selectedId, chatActive, userId, active]
  )
  const select = (conversation: Conversation) =>
    setSelectedIds((current) => ({ ...current, [active]: conversation.id }))
  const send = async (content: string, clientMessageId: string) => {
    if (!selectedId || !userId)
      throw new Error('Open a conversation before sending.')
    const id = selectedId
    const generation = accountGeneration.current
    const message = await sendText(id, content, clientMessageId)
    if (
      !mounted.current ||
      account.current !== userId ||
      !sessionOpen.current ||
      accountGeneration.current !== generation
    )
      return
    setHistories((current) => ({
      ...current,
      [id]: mergeMessages(current[id] || [], [message]),
    }))
    // Canonical activity/read data comes from the server, never a local clock.
    // A detail-refresh failure must not report an already committed send as failed.
    try {
      const item = await getConversation(id)
      if (
        mounted.current &&
        account.current === userId &&
        sessionOpen.current &&
        accountGeneration.current === generation
      )
        updateConversation(item)
    } catch (reason) {
      if (
        mounted.current &&
        account.current === userId &&
        sessionOpen.current &&
        accountGeneration.current === generation
      )
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to refresh conversation.'
        )
    }
  }
  const sentImage = async (message: Message) => {
    if (!mounted.current || account.current !== userId || !sessionOpen.current)
      return
    const generation = accountGeneration.current
    const id = message.conversationId
    setHistories((current) => ({
      ...current,
      [id]: mergeMessages(current[id] || [], [message]),
    }))
    try {
      const item = await getConversation(id)
      if (
        mounted.current &&
        account.current === userId &&
        sessionOpen.current &&
        accountGeneration.current === generation
      )
        updateConversation(item)
    } catch {
      /* A presentation refresh cannot undo the committed send. */
    }
  }
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadOlder = async () => {
    if (!selectedId || !before[selectedId] || loadingOlder) return
    const id = selectedId
    const generation = accountGeneration.current
    setLoadingOlder(true)
    try {
      const page = await readHistory(id, before[id] || undefined)
      if (
        !mounted.current ||
        account.current !== userId ||
        !sessionOpen.current ||
        accountGeneration.current !== generation
      )
        return
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
          // eslint-disable-next-line no-nested-ternary -- Gap recovery precedes the existing older-page control.
          catchUp[selected.id]?.length ? (
            <button
              type="button"
              onClick={() => {
                setHistories((current) => ({
                  ...current,
                  [selected.id]: catchUp[selected.id],
                }))
                setCatchUp((current) => ({ ...current, [selected.id]: [] }))
                const generation = accountGeneration.current
                const id = selected.id
                requestAnimationFrame(() => {
                  if (
                    !sessionOpen.current ||
                    accountGeneration.current !== generation ||
                    realtimeView.current.selectedId !== id ||
                    !realtimeView.current.chatActive
                  )
                    return
                  const viewport = document.querySelector<HTMLElement>(
                    `[data-message-history="${id}"]`
                  )
                  if (viewport) {
                    viewport.scrollTop = viewport.scrollHeight
                    viewport.dispatchEvent(new Event('scroll'))
                  }
                })
              }}
            >
              Load latest messages
            </button>
          ) : before[selected.id] ? (
            <button type="button" disabled={loadingOlder} onClick={loadOlder}>
              Load older messages
            </button>
          ) : undefined
        }
        imageSendingEnabled={Boolean(selected.imageSendingEnabled)}
        onSend={send}
        onImageSent={sentImage}
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

import { Plus } from 'lucide-react'
import { useRouter } from 'next/router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { UserAvatar } from '@/components/ui/user-avatar'
import { RequestTimelineSkeleton } from '@/components/ui/workspace-skeletons'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFormalOffers } from '@/hooks/use-formal-offers'
import { useFormalOrderRequests } from '@/hooks/use-formal-order-requests'
import { marketplaceRequest } from '@/lib/listings-api'
import {
  sendOffer,
  withdrawOffer,
  acceptOffer,
  denyOffer,
} from '@/lib/offers-api'
import {
  submitOrderRequest,
  cancelOrderRequest,
  acceptOrderRequest,
} from '@/lib/order-requests-api'
import { getOrders } from '@/lib/orders-api'
import type { ChatListing } from '@/types/conversation'
import type { FinancialCapabilities } from '@/types/financial-capabilities'
import type { Message } from '@/types/message'
import type { Offer } from '@/types/offer'
import type { FormalOrder } from '@/types/order'

import { AgreementCard } from './agreement-card'
import { MessageAttachments } from './message-attachments'
import { MessageHistory } from './message-history'
import styles from './messages-chat.module.css'
import { MessagesListingOverlay } from './messages-listing-overlay'
import { OfferCard, OfferEditor } from './offer-ui'
import { OrderPreviewControls } from './order-preview-controls'
import {
  OrderRequestEditor,
  OrderRequestPreviewCard,
} from './order-request-preview'
import { useOrderVisual } from './order-visual-context'
import { SellerPayoutDialog } from './seller-payout-dialog'

// Route-open intents only; never transaction/role authority. Survives responsive Chat remounts.
const consumedOfferEntries = new Set<string>()

function previewParticipants(
  destination: string,
  currentUserId: string,
  otherParticipantId: string,
  visuals: ReturnType<typeof useOrderVisual>
) {
  const seller = destination === 'selling'
  const sellerId = seller ? currentUserId : otherParticipantId
  const buyerId = seller ? otherParticipantId : currentUserId
  // Only the explicitly isolated frozen viewer can override authenticated perspective.
  const previewRole =
    (visuals.enabled && visuals.role) || (seller ? 'seller' : 'buyer')
  let perspectiveUserId = currentUserId
  if (visuals.enabled)
    perspectiveUserId = previewRole === 'seller' ? sellerId : buyerId
  return { previewRole, sellerId, perspectiveUserId }
}

// eslint-disable-next-line complexity -- Existing composer modes and formal Request network states share the approved Chat surface.
export function MessagesChat({
  name,
  image,
  time,
  destination,
  listing,
  active = true,
  conversationId,
  messages,
  currentUserId,
  otherParticipantId,
  currentUsername = 'Seller',
  onSend,
  onImageSent,
  imageSendingEnabled = false,
  onRendered,
  historyStatus,
  olderControl,
}: {
  name: string
  image?: string
  time?: string
  destination: string
  listing: ChatListing
  active?: boolean
  conversationId: string
  messages: readonly Message[]
  otherParticipantId: string
  currentUserId: string
  currentUsername?: string
  onSend: (content: string, clientMessageId: string) => Promise<void>
  onImageSent?: (message: Message) => Promise<void>
  imageSendingEnabled?: boolean
  onRendered?: (sequence: number) => void
  historyStatus?: React.ReactNode
  olderControl?: React.ReactNode
}) {
  const [draft, setDraft] = useState('')
  const orderVisuals = useOrderVisual()
  const formal =
    !orderVisuals.enabled &&
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
  const requests = useFormalOrderRequests(conversationId, currentUserId, formal)
  const offers = useFormalOffers(conversationId, currentUserId, formal)
  const [offerEditor, setOfferEditor] = useState<{ initial?: Offer } | null>(
    null
  )
  const offerIntent = useRef<{ digest: string; id: string }>()
  const withdrawalIntent = useRef<{ id: string; key: string }>()
  const legacyActive = requests.history?.requests.some(
    (item) => item.status === 'active'
  )
  const offerReady =
    formal &&
    Boolean(requests.history) &&
    Boolean(offers.history) &&
    !requests.error &&
    !offers.error &&
    !offers.blocked &&
    !legacyActive &&
    listing.availability === 'available'
  const ownActiveOffer = offers.history?.offers.find(
    (item) => item.status === 'Active' && item.senderId === currentUserId
  )
  const otherActiveOffer = offers.history?.offers.find(
    (item) => item.status === 'Active' && item.recipientId === currentUserId
  )
  const activeOffer = ownActiveOffer || otherActiveOffer
  const realSeller = requests.history?.sellerId === currentUserId
  const initialOfferLabel = realSeller ? 'Send Offer' : 'Make Offer'
  const responseOfferLabel =
    activeOffer?.senderId === currentUserId ? 'Revise Offer' : 'Counter Offer'
  const offerActionLabel = activeOffer ? responseOfferLabel : initialOfferLabel
  const formalRole = realSeller ? 'seller' : 'buyer'
  const router = useRouter()
  const [linkedOrders, setLinkedOrders] = useState<FormalOrder[]>([])
  useLayoutEffect(
    () => setLinkedOrders([]),
    [currentUserId, conversationId, formal]
  )
  useEffect(() => {
    let current = true
    if (
      !formal ||
      !requests.history?.requests.some(
        (request) => request.status === 'accepted'
      )
    )
      return undefined
    const participant =
      requests.history.sellerId === currentUserId ||
      requests.history.buyerId === currentUserId
    if (!participant) return undefined
    getOrders(realSeller ? 'sales' : 'purchases')
      .then((result) => {
        if (current)
          setLinkedOrders(
            result.orders.filter(
              (order) => order.conversationId === conversationId
            )
          )
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [formal, requests.history, realSeller, currentUserId, conversationId])
  const submission = useRef<{ digest: string; id: string }>()
  const cancellation = useRef<{ digest: string; id: string }>()
  const acceptance = useRef<{ requestId: string; id: string }>()
  const [sendError, setSendError] = useState('')
  // The server response supplies identity; refreshed Request history confirms navigation.
  const acceptedDestination = useRef<{
    orderId: string
    requestId: string
    userId: string
    conversationId: string
  }>()
  useEffect(() => {
    const target = acceptedDestination.current
    if (
      !target ||
      !formal ||
      target.userId !== currentUserId ||
      target.conversationId !== conversationId ||
      requests.error ||
      !requests.history?.requests.some(
        (item) => item.id === target.requestId && item.status === 'accepted'
      )
    )
      return
    acceptedDestination.current = undefined
    router
      .push({
        pathname: '/home',
        query: {
          section: 'orders',
          destination: 'purchases',
          order: target.orderId,
        },
      })
      .catch(() =>
        setSendError('Unable to open the Order. Open Purchases to view it.')
      )
  }, [
    formal,
    currentUserId,
    conversationId,
    requests.history,
    requests.error,
    router,
  ])
  const { previewRole, sellerId, perspectiveUserId } = previewParticipants(
    destination,
    currentUserId,
    otherParticipantId,
    orderVisuals
  )
  const failed = useRef<{ content: string; id: string } | null>(null)
  const contextVersion = useRef(0)
  const draftVersion = useRef(0)
  useEffect(
    () => () => {
      contextVersion.current += 1
    },
    []
  )
  const [attachments, setAttachments] = useState(false)
  const [addMenu, setAddMenu] = useState(false)
  const [orderEditor, setOrderEditor] = useState(false)
  const [payoutBlocked, setPayoutBlocked] = useState<
    'needs_attention' | 'unset' | null
  >(null)
  const [payoutArtifact, setPayoutArtifact] = useState<
    'Offer' | 'Order Request'
  >('Offer')
  const payoutChecking = useRef(false)
  async function openOrderEditor() {
    setPayoutArtifact('Order Request')
    setAddMenu(false)
    if (!formal) {
      setOrderEditor(true)
      return
    }
    if (!realSeller || payoutChecking.current) return
    payoutChecking.current = true
    const scope = contextVersion.current
    try {
      const capabilities = await marketplaceRequest<FinancialCapabilities>(
        '/api/financial-capabilities',
        'GET'
      )
      if (scope !== contextVersion.current) return
      if (capabilities.payoutAccount.status === 'ready') setOrderEditor(true)
      else setPayoutBlocked(capabilities.payoutAccount.status)
    } catch {
      if (scope === contextVersion.current)
        setSendError('Unable to check payout readiness. Please retry.')
    } finally {
      payoutChecking.current = false
    }
  }
  const openOfferEditor = async (initial?: Offer) => {
    setPayoutArtifact('Offer')
    setAddMenu(false)
    if (!offerReady || offers.isBlocked()) return
    if (realSeller) {
      if (payoutChecking.current) return
      payoutChecking.current = true
      const version = contextVersion.current
      try {
        const capabilities = await marketplaceRequest<FinancialCapabilities>(
          '/api/financial-capabilities',
          'GET'
        )
        if (version !== contextVersion.current) return
        if (capabilities.payoutAccount.status !== 'ready') {
          setPayoutBlocked(capabilities.payoutAccount.status)
          return
        }
      } catch {
        setSendError('Unable to check payout readiness. Please retry.')
        return
      } finally {
        payoutChecking.current = false
      }
    }
    setOfferEditor({ initial })
  }
  const offerEntryKey = `${currentUserId}:${conversationId}:${String(
    router.query.offerIntent || 'new'
  )}`
  useEffect(() => {
    if (
      consumedOfferEntries.has(offerEntryKey) ||
      router.query.offer !== 'new' ||
      !formal ||
      !requests.history ||
      !offers.history
    )
      return
    if (consumedOfferEntries.size > 100) consumedOfferEntries.clear()
    consumedOfferEntries.add(offerEntryKey)
    if (offerReady)
      openOfferEditor(
        offers.history.offers.find(
          (item) => item.status === 'Active' && item.senderId === currentUserId
        )
      )
    // Do not rewrite asPath here: the shared session provider reboots on route changes,
    // which would unmount this just-opened editor. The route intent is consumed once per mount.
    // The one-shot route intent uses current authoritative history and exact conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    router.query.offer,
    offerEntryKey,
    formal,
    requests.history,
    offers.history,
    offerReady,
  ])
  useLayoutEffect(() => {
    setOfferEditor(null)
    offerIntent.current = undefined
    withdrawalIntent.current = undefined
  }, [conversationId, currentUserId])
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!addMenu) return undefined
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setAddMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAddMenu(false)
        menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [addMenu])
  const [attachmentMounted, setAttachmentMounted] = useState(false)
  const attachmentPanel = useRef<HTMLDivElement>(null)
  const normalChat = useRef<HTMLDivElement>(null)
  const [sendState, setSendState] = useState('idle')
  const composer = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  useLayoutEffect(() => {
    setDraft('')
    setSendError('')
    failed.current = null
    contextVersion.current += 1
    setAttachments(false)
    setAttachmentMounted(false)
    setAddMenu(false)
    setOrderEditor(false)
    setPayoutBlocked(null)
    composing.current = false
  }, [conversationId, destination, active])
  useLayoutEffect(() => {
    normalChat.current?.toggleAttribute('inert', attachmentMounted)
    const panel = attachmentPanel.current
    if (!panel || !attachmentMounted) return undefined
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let nextFrame = 0
    let timer: ReturnType<typeof setTimeout>
    panel.style.transitionDuration = reduced ? '0ms' : '200ms'
    if (attachments) {
      panel.style.opacity = reduced ? '1' : '0'
      // Paint the mounted, transparent surface before starting its transition.
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => {
          panel.style.opacity = '1'
        })
      })
    } else {
      panel.style.opacity = '0'
      timer = setTimeout(() => setAttachmentMounted(false), reduced ? 0 : 200)
    }
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(nextFrame)
      clearTimeout(timer)
    }
  }, [attachments, attachmentMounted])
  const send = () => {
    const content = draft.trim()
    if (!active || !content) return undefined
    const id =
      failed.current?.content === content
        ? failed.current.id
        : crypto.randomUUID()
    const version = contextVersion.current
    const edits = draftVersion.current
    failed.current = { content, id }
    setDraft('')
    setSendError('')
    return onSend(content, id)
      .then(() => {
        if (version === contextVersion.current) failed.current = null
      })
      .catch((error) => {
        if (version === contextVersion.current) {
          setSendError(
            error instanceof Error
              ? error.message
              : 'Unable to send. Please retry.'
          )
          // Restore only when no new editing happened after submission, including
          // typing and then deleting. Never overwrite a newer draft.
          if (edits === draftVersion.current) setDraft(content)
        }
        throw error
      })
  }
  const [showListingPreview, setShowListingPreview] = useState(false)
  useEffect(() => {
    if (!active) setShowListingPreview(false)
  }, [active])
  return (
    <section className={styles.panel} aria-label="Chat panel">
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.avatar}>
            <UserAvatar username={name} image={image} />
          </div>
          <div className={styles.identityText}>
            <h3>{name}</h3>
            {time && <span>{time}</span>}
          </div>
        </div>
        <span className={styles.listingAction}>
          <ShiningButton onClick={() => setShowListingPreview(true)}>
            View listing
          </ShiningButton>
        </span>
      </header>
      <div className={styles.contentViewport} data-chat-content="true">
        <div
          ref={normalChat}
          className={styles.normalChat}
          aria-hidden={attachmentMounted}
          data-inactive={attachmentMounted}
        >
          {orderVisuals.enabled && <OrderPreviewControls role={previewRole} />}
          <MessageHistory
            offers={formal ? offers.history?.offers || [] : []}
            agreements={formal ? offers.history?.agreements || [] : []}
            renderAgreement={(agreement) => (
              <AgreementCard
                agreement={agreement}
                onView={() =>
                  router
                    .push(
                      {
                        pathname: '/home',
                        query: {
                          section: 'orders',
                          destination:
                            currentUserId === agreement.buyerId
                              ? 'purchases'
                              : 'sales',
                          order: agreement.id,
                        },
                      },
                      undefined,
                      { shallow: true }
                    )
                    .catch(() => {})
                }
              />
            )}
            renderOffer={(offer) => (
              <OfferCard
                offer={offer}
                linkedAgreement={offers.history?.agreements?.find(
                  (agreement) =>
                    agreement.id === offer.linkedOrderId &&
                    agreement.offerId === offer.id
                )}
                listing={listing}
                viewerId={currentUserId}
                participantName={name}
                blocked={offers.blocked || Boolean(offers.error)}
                canEdit={offerReady}
                onViewOrder={(value) => {
                  if (!value.linkedOrderId) return
                  router
                    .push(
                      {
                        pathname: '/home',
                        query: {
                          section: 'orders',
                          destination:
                            currentUserId === value.buyerId
                              ? 'purchases'
                              : 'sales',
                          order: value.linkedOrderId,
                        },
                      },
                      undefined,
                      { shallow: true }
                    )
                    .catch(() => {})
                }}
                onAccept={async (value, command) => {
                  if (offers.isBlocked())
                    throw new Error('Refresh the Offer before continuing.')
                  const result = await acceptOffer(value.id, command)
                  offers.markAcceptSucceeded(value.id, result.orderId)
                  window.dispatchEvent(
                    new CustomEvent('marketplace-request-invalidated', {
                      detail: { conversationId },
                    })
                  )
                  await offers.refresh()
                }}
                onDeny={async (value, command) => {
                  if (offers.isBlocked())
                    throw new Error('Refresh the Offer before continuing.')
                  const result = await denyOffer(value.id, command)
                  offers.markSucceeded(result)
                  await offers.refresh()
                }}
                onEdit={openOfferEditor}
                onWithdraw={async (value) => {
                  if (offers.isBlocked())
                    throw new Error('Refresh the Offer before continuing.')
                  if (withdrawalIntent.current?.id !== value.id)
                    withdrawalIntent.current = {
                      id: value.id,
                      key: crypto.randomUUID(),
                    }
                  const result = await withdrawOffer(
                    value.id,
                    withdrawalIntent.current.key
                  )
                  offers.markSucceeded(result)
                  withdrawalIntent.current = undefined
                  await offers.refresh()
                }}
              />
            )}
            formalRequests={formal}
            conversationId={conversationId}
            messages={messages}
            orderRequests={
              formal
                ? requests.history?.requests || []
                : orderVisuals.state.requests.filter(
                    (request) => request.conversationId === conversationId
                  )
            }
            previewEvents={
              formal
                ? requests.history?.events || []
                : (orderVisuals.state.events || []).filter(
                    (event) => event.conversationId === conversationId
                  )
            }
            orderRequestSenderId={
              formal ? requests.history?.sellerId || sellerId : sellerId
            }
            renderOrderRequest={(request) => (
              <OrderRequestPreviewCard
                request={request}
                role={formal ? formalRole : previewRole}
                formal={formal}
                linkedOrder={
                  formal
                    ? linkedOrders.find(
                        (order) => order.requestId === request.id
                      )
                    : undefined
                }
                acceptancePendingRefresh={
                  formal && requests.pendingAcceptanceIds.includes(request.id)
                }
                onViewOrder={
                  formal &&
                  linkedOrders.some((order) => order.requestId === request.id)
                    ? () => {
                        const order = linkedOrders.find(
                          (value) => value.requestId === request.id
                        )
                        if (!order) return
                        router
                          .push({
                            pathname: '/home',
                            query: {
                              section: 'orders',
                              destination: realSeller ? 'sales' : 'purchases',
                              order: order.id,
                            },
                          })
                          .catch(() => {})
                      }
                    : undefined
                }
                onAccept={
                  formal &&
                  requests.history?.buyerId === currentUserId &&
                  !requests.pendingAcceptanceIds.includes(request.id) &&
                  requests.history.eligibleRequestIds?.includes(request.id)
                    ? async () => {
                        if (requests.isAcceptanceBlocked(request.id)) return
                        if (acceptance.current?.requestId !== request.id)
                          acceptance.current = {
                            requestId: request.id,
                            id: crypto.randomUUID(),
                          }
                        const result = await acceptOrderRequest(
                          request.id,
                          acceptance.current.id
                        )
                        acceptedDestination.current = {
                          orderId: result.order.id,
                          requestId: request.id,
                          userId: currentUserId,
                          conversationId,
                        }
                        requests.markAcceptanceSucceeded(request.id)
                        await requests.refresh()
                        window.dispatchEvent(
                          new CustomEvent('marketplace-orders-changed')
                        )
                        window.dispatchEvent(
                          new Event('marketplace-listings-changed')
                        )
                      }
                    : undefined
                }
                onCancel={
                  formal && realSeller
                    ? async (reason, note) => {
                        const digest = JSON.stringify([
                          request.id,
                          reason,
                          note,
                        ])
                        if (cancellation.current?.digest !== digest)
                          cancellation.current = {
                            digest,
                            id: crypto.randomUUID(),
                          }
                        await cancelOrderRequest(
                          request.id,
                          reason,
                          note,
                          cancellation.current.id
                        )
                        await requests.refresh()
                      }
                    : undefined
                }
              />
            )}
            currentUserId={currentUserId}
            perspectiveUserId={perspectiveUserId}
            name={name}
            image={image}
            active={active}
            status={
              <>
                {historyStatus}
                {formal && offers.loading && <RequestTimelineSkeleton />}
                {formal && legacyActive && (
                  <p>
                    An active legacy Order Request already exists. Resolve it
                    before making a new Offer.
                  </p>
                )}
                {formal && offers.error && (
                  <div role="alert">
                    <p>{offers.error}</p>
                    <button type="button" onClick={() => offers.refresh()}>
                      Retry Offers
                    </button>
                  </div>
                )}
                {formal && requests.loading && <RequestTimelineSkeleton />}
                {formal && requests.error && (
                  <div role="alert">
                    <p>{requests.error}</p>
                    <button type="button" onClick={() => requests.refresh()}>
                      Retry Order Requests
                    </button>
                  </div>
                )}
              </>
            }
            olderControl={olderControl}
            onRendered={
              attachmentMounted || showListingPreview || orderEditor
                ? undefined
                : onRendered
            }
          />
          {sendError && (
            <p role="alert" className={styles.sendError}>
              {sendError}{' '}
              {failed.current && (
                <span>Not sent: {failed.current.content}</span>
              )}
            </p>
          )}
          <div ref={composer} className={styles.composer}>
            <textarea
              rows={1}
              aria-label="Message"
              placeholder="Message..."
              value={draft}
              onChange={(event) => {
                draftVersion.current += 1
                setDraft(event.target.value)
              }}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Enter' ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing ||
                  composing.current
                )
                  return
                event.preventDefault()
                // Both inputs pass through StatefulButton's same synchronous pending
                // guard, Promise lifecycle and send callback. No mirrored keyboard lock.
                composer.current
                  ?.querySelector<HTMLButtonElement>('[data-chat-send]')
                  ?.click()
              }}
            />
            <StatefulButton
              key={`${destination}-${conversationId}-${active}`}
              className={styles.send}
              data-chat-send="true"
              disabled={!draft.trim() && sendState === 'idle'}
              minLoadingMs={300}
              resetAfter={800}
              onClick={send}
              onStateChange={setSendState}
            >
              Send
            </StatefulButton>
            <div ref={menu} className={styles.addMenu}>
              <StatefulButton
                className={styles.attachment}
                aria-label="Add to conversation"
                aria-expanded={addMenu}
                successText=""
                errorText=""
                onClick={() => {
                  setAddMenu((current) => !current)
                }}
              >
                <Plus size={20} aria-hidden="true" />
              </StatefulButton>
              {addMenu && (
                <div
                  className={styles.addOptions}
                  aria-label="Conversation actions"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenu(false)
                      setDraft('')
                      draftVersion.current += 1
                      failed.current = null
                      setSendError('')
                      setAttachments(true)
                      setAttachmentMounted(true)
                    }}
                  >
                    Attachment
                  </button>
                  {offerReady && (
                    <button
                      type="button"
                      onClick={() => openOfferEditor(activeOffer)}
                    >
                      {offerActionLabel}
                    </button>
                  )}
                  {offerReady && ownActiveOffer && otherActiveOffer && (
                    <button
                      type="button"
                      onClick={() => openOfferEditor(otherActiveOffer)}
                    >
                      Counter Offer
                    </button>
                  )}
                  {destination === 'selling' &&
                    (formal
                      ? realSeller && Boolean(legacyActive) && !requests.error
                      : orderVisuals.enabled) && (
                      <button type="button" onClick={() => openOrderEditor()}>
                        {formal
                          ? 'Replace Order Request'
                          : 'Send Order Request'}
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
        {attachmentMounted && (
          <div
            ref={attachmentPanel}
            className={styles.attachmentLayer}
            data-attachment-panel="true"
          >
            <MessageAttachments
              key={`${destination}-${conversationId}`}
              sendClassName={styles.send}
              conversationId={conversationId}
              sendEnabled={imageSendingEnabled}
              onCancel={() => setAttachments(false)}
              onSend={onImageSent || (() => Promise.resolve())}
              onComplete={() => setAttachments(false)}
            />
          </div>
        )}
      </div>
      {active && showListingPreview && (
        <MessagesListingOverlay
          listing={listing}
          destination={destination}
          onClose={() => setShowListingPreview(false)}
        />
      )}
      {active && orderEditor && (
        <OrderRequestEditor
          listing={listing}
          conversationId={conversationId}
          buyerId={otherParticipantId}
          sellerId={currentUserId}
          formalRequests={formal ? requests.history?.requests || [] : undefined}
          onClose={() => setOrderEditor(false)}
          onPreview={async (value, replaceRequestId) => {
            if (formal) {
              if (!realSeller)
                return 'Only the seller may send an Order Request.'
              const digest = JSON.stringify([
                conversationId,
                value,
                replaceRequestId,
              ])
              if (submission.current?.digest !== digest)
                submission.current = { digest, id: crypto.randomUUID() }
              try {
                await submitOrderRequest(
                  conversationId,
                  value,
                  submission.current.id,
                  replaceRequestId
                )
                // A completed submission ends this intent; an identical later offer needs a new key.
                submission.current = undefined
                await requests.refresh()
                setOrderEditor(false)
                return null
              } catch (failure) {
                return failure instanceof Error
                  ? failure.message
                  : 'Unable to send Order Request.'
              }
            }
            const error = orderVisuals.send(
              conversationId,
              {
                buyerId: otherParticipantId,
                sellerId: currentUserId,
                listing,
                draft: value,
                buyer: name,
                seller: currentUsername,
              },
              replaceRequestId
            )
            if (!error) setOrderEditor(false)
            return error
          }}
        />
      )}
      {active && offerEditor && (
        <OfferEditor
          key={offerEditor.initial?.id || conversationId}
          listing={listing}
          initial={offerEditor.initial}
          viewerId={currentUserId}
          buyer={!realSeller}
          newRound={Boolean(offers.history?.offers.length)}
          onClose={() => setOfferEditor(null)}
          onSend={async (terms) => {
            if (!offerReady || offers.isBlocked())
              throw new Error(
                'Refresh and review the current Offer before sending.'
              )
            const digest = JSON.stringify([conversationId, terms])
            if (offerIntent.current?.digest !== digest)
              offerIntent.current = { digest, id: crypto.randomUUID() }
            const result = await sendOffer(
              conversationId,
              terms,
              offerIntent.current.id,
              offerEditor.initial
                ? {
                    id: offerEditor.initial.id,
                    kind:
                      offerEditor.initial.senderId === currentUserId
                        ? 'revise'
                        : 'counter',
                  }
                : undefined
            )
            offers.markSucceeded(result)
            offerIntent.current = undefined
            await offers.refresh()
          }}
        />
      )}
      {active && payoutBlocked && (
        <SellerPayoutDialog
          status={payoutBlocked}
          artifact={payoutArtifact}
          onClose={() => setPayoutBlocked(null)}
          onSettings={() => {
            setPayoutBlocked(null)
            router
              .push('/home?section=settings&focus=payments-payouts')
              .catch(() => {})
          }}
        />
      )}
    </section>
  )
}

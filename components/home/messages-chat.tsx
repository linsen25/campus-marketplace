import { Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { UserAvatar } from '@/components/ui/user-avatar'
import { StatefulButton } from '@/components/velora/stateful-button'
import { pageSlideOptions } from '@/lib/page-slide'
import type { ChatListing } from '@/types/conversation'
import type { Message } from '@/types/message'

import { MessageAttachments } from './message-attachments'
import { MessageHistory } from './message-history'
import styles from './messages-chat.module.css'
import { MessagesListingOverlay } from './messages-listing-overlay'

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
  currentUserId: string
  onSend: (content: string, clientMessageId: string) => Promise<void>
  onImageSent?: (message: Message) => Promise<void>
  imageSendingEnabled?: boolean
  onRendered?: (sequence: number) => void
  historyStatus?: React.ReactNode
  olderControl?: React.ReactNode
}) {
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState('')
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
    composing.current = false
  }, [conversationId, destination, active])
  useLayoutEffect(() => {
    normalChat.current?.toggleAttribute('inert', attachmentMounted)
    const panel = attachmentPanel.current
    if (!panel || !attachmentMounted) return undefined
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = attachments ? 'translateY(100%)' : 'translateY(0)'
    const to = attachments ? 'translateY(0)' : 'translateY(100%)'
    const animation = panel.animate(
      [{ transform: reduced ? to : from }, { transform: to }],
      pageSlideOptions(true, reduced)
    )
    animation.onfinish = () => {
      if (!attachments) setAttachmentMounted(false)
    }
    return () => animation.cancel()
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
          <MessageHistory
            conversationId={conversationId}
            messages={messages}
            currentUserId={currentUserId}
            name={name}
            image={image}
            active={active}
            status={historyStatus}
            olderControl={olderControl}
            onRendered={attachmentMounted ? undefined : onRendered}
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
            <StatefulButton
              className={styles.attachment}
              aria-label="Add attachment"
              successText=""
              errorText=""
              onClick={() => {
                setDraft('')
                draftVersion.current += 1
                failed.current = null
                setSendError('')
                setAttachments(true)
                setAttachmentMounted(true)
              }}
            >
              <Plus size={20} aria-hidden="true" />
            </StatefulButton>
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
    </section>
  )
}

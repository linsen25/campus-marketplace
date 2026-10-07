'use client'

import cn from 'classnames'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import type { Conversation } from '@/types/conversation'

import styles from './client-card.module.css'

export type { Conversation } from '@/types/conversation'

/** Conversation-list indicator only; chat/profile avatars keep UserAvatar directly. */
function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  return (
    <span className={styles.conversationAvatar}>
      <UserAvatar
        username={conversation.person.name}
        image={conversation.person.avatar}
      />
      {conversation.unreadCount > 0 && (
        <>
          <span
            className={styles.unreadDot}
            data-conversation-unread="true"
            aria-hidden="true"
          />
          <span className={styles.unreadLabel}>Unread messages</span>
        </>
      )}
    </span>
  )
}

export interface ClientCardProps {
  conversations: Conversation[]
  selectedId: string
  onSelect: (conversation: Conversation) => void
  children?: ReactNode
  className?: string
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  dynamicArrow = false,
}: Pick<ClientCardProps, 'conversations' | 'onSelect' | 'selectedId'> & {
  dynamicArrow?: boolean
}) {
  return (
    <div className={styles.conversations} data-conversation-list="true">
      {conversations.map((conversation) => (
        <button
          type="button"
          key={conversation.id}
          className={cn(
            styles.conversation,
            dynamicArrow && 'dynamic-arrow-row'
          )}
          data-conversation-id={conversation.id}
          aria-pressed={conversation.id === selectedId}
          onClick={() => onSelect(conversation)}
        >
          <span className={styles.avatarSlot}>
            <ConversationAvatar conversation={conversation} />
          </span>
          <span className={styles.rowText}>
            <strong>{conversation.person.name}</strong>
            <span>{conversation.listing.title}</span>
            <small>{conversation.lastMessage}</small>
          </span>
          {dynamicArrow && (
            <ArrowRight
              size={16}
              className="shining-button__arrow"
              aria-hidden="true"
            />
          )}
        </button>
      ))}
    </div>
  )
}

export function ClientCardBack({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.back} onClick={onClick}>
      <ArrowLeft size={14} />
      Go Back
    </button>
  )
}

/** Only the clipping region changes width; rows always have their final width. */
export function ClientCard({
  conversations,
  selectedId,
  onSelect,
  children,
  className,
}: ClientCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const reduced = useReducedMotion()
  const recent = conversations.slice(0, 3)
  const hiddenCount = conversations.length - recent.length
  return (
    <div
      className={cn(styles.wrapper, className)}
      data-client-card="true"
      data-contacts-expanded={isExpanded}
    >
      <motion.div
        className={styles.contactsRegion}
        data-contacts-region="true"
        initial={false}
        animate={{ width: isExpanded ? 'var(--contacts-expanded-width)' : 64 }}
        transition={
          reduced
            ? { duration: 0 }
            : { type: 'spring', stiffness: 350, damping: 35 }
        }
      >
        {!isExpanded && (
          <div className={styles.stack}>
            {recent.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={styles.avatarSlot}
                data-conversation-id={conversation.id}
                aria-label={`${conversation.person.name}: ${
                  conversation.listing.title
                }${conversation.unreadCount > 0 ? ', unread messages' : ''}`}
                aria-pressed={conversation.id === selectedId}
                onClick={() => onSelect(conversation)}
              >
                <ConversationAvatar conversation={conversation} />
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className={styles.counter}
                aria-label="Expand conversations"
                onClick={() => setIsExpanded(true)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        )}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              className={styles.expanded}
              key="conversations"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
            >
              <div className={styles.expandedInner}>
                <div className={styles.backRow}>
                  <ClientCardBack onClick={() => setIsExpanded(false)} />
                </div>
                <ConversationList
                  conversations={conversations}
                  selectedId={selectedId}
                  onSelect={(conversation) => {
                    onSelect(conversation)
                    setIsExpanded(false)
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      {children}
    </div>
  )
}

export default ClientCard

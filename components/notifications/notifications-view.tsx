import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import {
  Bell,
  ChevronRight,
  Clock3,
  Filter,
  MessageCircle,
  Package,
  Tag,
  X,
} from 'lucide-react'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StatefulButton } from '@/components/velora/stateful-button'
import { marketplaceRequest } from '@/lib/listings-api'
import {
  notificationCategory,
  notificationTime,
} from '@/lib/notification-category'
import type {
  NotificationCategory,
  NotificationItem,
} from '@/lib/notification-category'
import { notificationUiTarget } from '@/lib/notification-navigation'
import { notificationCopy } from '@/lib/notification-presentation'

import { NotificationListingProvenance } from './notification-listing-provenance'
import { useNotifications } from './notification-state'
import type { Feed } from './notification-state'
import styles from './notifications-view.module.css'

const categories = {
  message: { label: 'MESSAGE', icon: MessageCircle },
  order: { label: 'ORDER', icon: Package },
  listing: { label: 'LISTING', icon: Tag },
  system: { label: 'SYSTEM', icon: Bell },
}
function NotificationType({ item }: { item: NotificationItem }) {
  const type = notificationCategory(item)
  const { label, icon: Icon } = categories[type]
  return (
    <span className={`${styles.category} ${styles[type]}`}>
      <Icon size={16} aria-hidden={true} />
      <span>{label}</span>
    </span>
  )
}
function NotificationsFilter({
  category,
  status,
  disabled,
  onCategory,
  onStatus,
}: {
  category: string
  status: string
  disabled: boolean
  onCategory: (value: NotificationCategory | '') => void
  onStatus: (value: '' | 'read' | 'unread') => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <FilterInteraction
      label="Filter"
      appearance="select"
      topLayer={true}
      isOpen={open}
      disabled={disabled}
      triggerClassName={styles.filterTrigger}
      panelClassName={styles.filterPanel}
      triggerContent={
        <>
          <Filter size={16} aria-hidden={true} />
          Filter
        </>
      }
      onOpenChange={setOpen}
    >
      <div className={styles.filterOptions}>
        <fieldset>
          <legend>Notification category</legend>
          {[
            ['', 'All notifications'],
            ['message', 'Messages'],
            ['order', 'Orders'],
            ['listing', 'Listings'],
            ['system', 'System'],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="notification-category"
                checked={category === value}
                disabled={disabled}
                onChange={() => onCategory(value as NotificationCategory | '')}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Notification status</legend>
          {[
            ['', 'All status'],
            ['unread', 'Unread'],
            ['read', 'Read'],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="notification-status"
                checked={status === value}
                disabled={disabled}
                onChange={() => onStatus(value as '' | 'read' | 'unread')}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={() => setOpen(false)}>
          Close filters
        </button>
      </div>
    </FilterInteraction>
  )
}
export function NotificationsView() {
  const state = useNotifications()
  if (!state)
    return <WorkspaceEmpty>Sign in to view notifications.</WorkspaceEmpty>
  return <NotificationContent />
}
// eslint-disable-next-line complexity -- Existing inbox actions, filters and selection share one authoritative feed.
function NotificationContent() {
  const state = useNotifications()!
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const busy = useRef(false)
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<NotificationItem | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [managing, setManaging] = useState(false)
  const managementBusy = useRef(false)
  const selectionSummary = useRef<HTMLParagraphElement>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const {
    feed,
    markRead,
    loading,
    refreshing,
    error,
    more,
    refresh,
    setError,
    setFeed,
    setMore,
    version,
    mounted,
    category,
    setCategory,
    status,
    setStatus,
    pagesLoaded,
    ownerRef,
  } = state
  const chosen = feed.notifications.filter((n) => selectedIds.includes(n.id))
  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) =>
        feed.notifications.some((n) => n.id === id)
      )
      return next.length === current.length ? current : next
    })
  }, [feed.notifications])
  const resetSelection = () => {
    setSelectedIds([])
    setConfirmDelete(false)
    setNotice('')
  }
  async function batch(action: 'delete' | 'markRead') {
    if (managementBusy.current) return
    const ids = chosen
      .filter((n) => action === 'delete' || !n.read_at)
      .map((n) => n.id)
    if (!ids.length) return
    managementBusy.current = true
    const actor = ownerRef.current
    setManaging(true)
    try {
      const result = await marketplaceRequest<{ unreadCount: number }>(
        '/api/notifications',
        'POST',
        { action, ids }
      )
      if (!mounted.current || ownerRef.current !== actor) return
      setFeed((current) => ({
        ...current,
        unreadCount: result.unreadCount,
        notifications:
          action === 'delete'
            ? current.notifications.filter((n) => !ids.includes(n.id))
            : current.notifications,
      }))
      setSelectedIds([])
      setConfirmDelete(false)
      setNotice(
        action === 'delete'
          ? `Deleted ${ids.length} notification${ids.length === 1 ? '' : 's'}.`
          : 'Selected notifications marked as read.'
      )
      await refresh()
      selectionSummary.current?.focus()
    } catch (e) {
      if (!mounted.current || ownerRef.current !== actor) return
      setError(
        action === 'delete'
          ? 'Unable to delete notifications. Please retry.'
          : 'Unable to mark notifications read. Please retry.'
      )
      throw e
    } finally {
      managementBusy.current = false
      setManaging(false)
    }
  }
  const report =
    selected &&
    (feed.notifications.find((n) => n.id === selected.id) || selected)
  async function open(item: NotificationItem, navigate: boolean) {
    if (busy.current) return
    const target = notificationUiTarget(item.destination, item.event_type)
    if (navigate && !target) return
    const actor = ownerRef.current
    busy.current = true
    setOpening(true)
    try {
      if (!navigate) {
        const readItem = await markRead(item)
        if (mounted.current && ownerRef.current === actor) setSelected(readItem)
        return
      }
      // Keep the destination action's existing mark-before-navigation behavior.
      try {
        await marketplaceRequest('/api/notifications', 'POST', { id: item.id })
        await refresh()
      } catch {
        setError('Unable to mark this notification read. Please retry.')
      }
      if (target) await router.push(target)
    } catch {
      if (mounted.current && ownerRef.current === actor)
        setError(
          navigate
            ? 'Unable to open notification. Please retry.'
            : 'Unable to mark this notification read. Please retry.'
        )
    } finally {
      busy.current = false
      setOpening(false)
    }
  }
  return (
    <section className={styles.center} aria-label="Notifications feed">
      <div className={styles.toolbar}>
        <div
          className={styles.statusTabs}
          role="group"
          aria-label="Notification status"
        >
          {[
            ['', 'All'],
            ['unread', 'Unread'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              disabled={managing}
              onClick={() => {
                resetSelection()
                setStatus(value as '' | 'unread')
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          <NotificationsFilter
            category={category}
            status={status}
            disabled={managing}
            onCategory={(value) => {
              resetSelection()
              setCategory(value)
            }}
            onStatus={(value) => {
              resetSelection()
              setStatus(value)
            }}
          />
          <button
            type="button"
            className={styles.selectMode}
            disabled={managing}
            aria-pressed={selectionMode}
            aria-label={selectionMode ? 'Done' : 'Select'}
            onClick={() => {
              resetSelection()
              setSelectionMode((value) => !value)
            }}
          >
            <span className={styles.selectionLabels} aria-hidden="true">
              <m.span
                initial={false}
                animate={{ opacity: selectionMode ? 0 : 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.16 }}
              >
                Select
              </m.span>
              <m.span
                initial={false}
                animate={{ opacity: selectionMode ? 1 : 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.16 }}
              >
                Done
              </m.span>
            </span>
          </button>
        </div>
        <p
          ref={selectionSummary}
          tabIndex={-1}
          className={styles.helper}
          aria-live="polite"
        >
          {chosen.length > 0 && `${chosen.length} selected`}
        </p>
        <div className={styles.selectionTools}>
          {selectionMode &&
            (chosen.length ? (
              <div className={styles.batchActions}>
                <StatefulButton
                  disabled={managing || !chosen.some((n) => !n.read_at)}
                  onClick={() => batch('markRead')}
                >
                  Mark as read
                </StatefulButton>
                <button
                  type="button"
                  className={styles.delete}
                  disabled={managing}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              </div>
            ) : (
              <StatefulButton
                disabled={loading || managing || feed.unreadCount === 0}
                onClick={async () => {
                  try {
                    await marketplaceRequest('/api/notifications', 'POST', {
                      action: 'markAllRead',
                    })
                    await refresh()
                  } catch (e) {
                    setError('Unable to mark notifications read. Please retry.')
                    throw e
                  }
                }}
              >
                Mark all as read
              </StatefulButton>
            ))}
        </div>
      </div>
      {confirmDelete && chosen.length > 0 && (
        <div
          className={styles.confirmation}
          role="group"
          aria-label="Confirm notification deletion"
        >
          <p>
            Delete {chosen.length} notification{chosen.length === 1 ? '' : 's'}?
            This only removes inbox items.
          </p>
          <button
            type="button"
            disabled={managing}
            onClick={() => {
              setConfirmDelete(false)
              selectionSummary.current?.focus()
            }}
          >
            Cancel
          </button>
          <StatefulButton
            className={styles.delete}
            disabled={managing}
            onClick={() => batch('delete')}
          >
            Delete notifications
          </StatefulButton>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && (
        <div role="status" aria-label="Loading notifications">
          <Skeleton style={{ height: 56, marginBottom: 8 }} />
          <Skeleton style={{ height: 56 }} />
        </div>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && !feed.notifications.length && (
        <WorkspaceEmpty>
          {category || status
            ? 'No notifications match these filters.'
            : 'No notifications yet. Important updates about offers, messages, and orders will appear here.'}
        </WorkspaceEmpty>
      )}
      <ul className={styles.list} data-selection={selectionMode || undefined}>
        {feed.notifications.map((item) => {
          const { title, body } = notificationCopy(item.event_type)
          return (
            <li
              key={item.id}
              className={styles.row}
              data-unread={!item.read_at || undefined}
            >
              {selectionMode && (
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  aria-label={`Select ${title}`}
                  checked={selectedIds.includes(item.id)}
                  disabled={
                    managing ||
                    (!selectedIds.includes(item.id) && chosen.length >= 500)
                  }
                  onChange={(e) => {
                    setConfirmDelete(false)
                    setSelectedIds((current) =>
                      e.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id)
                    )
                  }}
                />
              )}
              <button
                type="button"
                className={styles.rowOpen}
                disabled={managing}
                aria-disabled={opening || managing}
                aria-label={`Open notification: ${title}`}
                onClick={() => open(item, false)}
              >
                <NotificationType item={item} />
                <strong className={styles.summary}>
                  {title}
                  <NotificationListingProvenance
                    provenance={item.listingProvenance}
                  />
                </strong>
                <span className={styles.bodySummary}>{body}</span>
                <time
                  dateTime={item.created_at}
                  title={new Date(item.created_at).toLocaleString()}
                >
                  {notificationTime(item.created_at, now) === 'now'
                    ? 'now'
                    : `${notificationTime(item.created_at, now)} ago`}
                </time>
                <ChevronRight
                  className={styles.chevron}
                  size={18}
                  aria-hidden={true}
                />
              </button>
            </li>
          )
        })}
      </ul>
      {more && (
        <StatefulButton
          disabled={refreshing || managing}
          onClick={async () => {
            const request = version.current
            const last = feed.notifications[feed.notifications.length - 1]
            const cursor = feed.nextCursor || {
              before: last.created_at,
              beforeId: last.id,
            }
            const query = new URLSearchParams({
              ...cursor,
              ...(category ? { category } : {}),
              ...(status ? { status } : {}),
            })
            try {
              const data = await marketplaceRequest<Feed>(
                `/api/notifications?${query}`,
                'GET'
              )
              if (mounted.current && request === version.current) {
                setFeed((current) => ({
                  ...data,
                  notifications: [
                    ...current.notifications,
                    ...data.notifications.filter(
                      (n) => !current.notifications.some((v) => v.id === n.id)
                    ),
                  ],
                }))
                pagesLoaded.current += 1
                setMore(data.hasMore ?? data.notifications.length === 50)
              }
            } catch (e) {
              setError('Unable to load more notifications. Please retry.')
              throw e
            }
          }}
        >
          Load more
        </StatefulButton>
      )}
      <AnimatePresence>
        {report && (
          <FadingDialog
            className={styles.report}
            aria-labelledby="notification-report-title"
            onRequestClose={() => setSelected(null)}
          >
            <header className={styles.reportHeader}>
              <NotificationType item={report} />
              <button
                type="button"
                aria-label="Close notification detail"
                onClick={() => setSelected(null)}
              >
                <X size={20} aria-hidden={true} />
              </button>
            </header>
            <div className={styles.reportContent}>
              <h3 id="notification-report-title">
                {notificationCopy(report.event_type).title}
              </h3>
              <NotificationListingProvenance
                provenance={report.listingProvenance}
              />
              <p>{notificationCopy(report.event_type).body}</p>
              <div className={styles.received}>
                <Clock3 size={17} aria-hidden={true} />
                <dl>
                  <dt>Received</dt>
                  <dd>
                    <time dateTime={report.created_at}>
                      {new Date(report.created_at).toLocaleString()}
                    </time>
                  </dd>
                  {typeof report.original_price_cents === 'number' && (
                    <>
                      <dt>Original asking price</dt>
                      <dd>{money(report.original_price_cents)}</dd>
                    </>
                  )}
                  {typeof report.latest_price_cents === 'number' && (
                    <>
                      <dt>Updated asking price</dt>
                      <dd>{money(report.latest_price_cents)}</dd>
                    </>
                  )}
                </dl>
              </div>
              {error && (
                <p role="alert">
                  {error}
                  <button
                    type="button"
                    disabled={opening || managing}
                    onClick={() => open(report, false)}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>
            <footer className={styles.reportActions}>
              {notificationUiTarget(report.destination, report.event_type) && (
                <button
                  type="button"
                  className={styles.openInApp}
                  disabled={opening || managing}
                  onClick={() => open(report, true)}
                >
                  Open in app
                </button>
              )}
              <button
                type="button"
                className={styles.close}
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </footer>
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}
function money(cents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'code',
  }).format(cents / 100)
}

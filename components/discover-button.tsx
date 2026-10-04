// CSS Modules adaptation of the supplied UseLayouts Discover Button (e9c4dce1).
import {
  FavouriteIcon,
  Fire02Icon,
  MultiplicationSignIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import { normalizeSearchQuery } from '@/lib/market-search'
import type { SearchSuggestion } from '@/lib/market-search'

import styles from './discover-button.module.css'

const tabs = [
  { id: 'popular', label: 'Popular', icon: Fire02Icon },
  { id: 'favorites', label: 'Favorites', icon: FavouriteIcon },
] as const
const spring = {
  type: 'spring' as const,
  damping: 20,
  stiffness: 230,
  mass: 1.2,
}

function inputAnimation(expanded: boolean) {
  return {
    width: expanded ? 'auto' : '0px',
    opacity: expanded ? 1 : 0,
    filter: expanded ? 'blur(0px)' : 'blur(4px)',
    marginLeft: expanded ? '12px' : '0px',
  }
}

function tabAnimation(expanded: boolean) {
  return {
    opacity: expanded ? 0 : 1,
    filter: expanded ? 'blur(4px)' : 'blur(0px)',
    width: 'auto',
  }
}

function closeAnimation(expanded: boolean) {
  return {
    opacity: expanded ? 1 : 0,
    filter: expanded ? 'blur(0px)' : 'blur(4px)',
  }
}

function capsuleAnimation(expanded: boolean) {
  return { width: expanded ? 'var(--discover-height)' : '100%' }
}

export default function DiscoverButton({
  query,
  suggestions,
  focusActive,
  focusClosing,
  dismissSignal,
  onDraftChange,
  onApply,
  onSelect,
  onFocusChange,
  onDismiss,
}: {
  query: string
  suggestions: SearchSuggestion[]
  focusActive: boolean
  focusClosing: boolean
  dismissSignal: number
  onDraftChange: (query: string) => void
  onApply: (query: string) => void
  onSelect: (suggestion: SearchSuggestion) => void
  onFocusChange: (open: boolean) => void
  onDismiss: () => void
}) {
  const [activeTab, setActiveTab] =
    useState<typeof tabs[number]['id']>('popular')
  const [isSearchExpanded, setIsSearchExpanded] = useState(Boolean(query))
  const [draftQuery, setDraftQuery] = useState(query)
  const [highlighted, setHighlighted] = useState(-1)
  const anchor = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  const wasSearching = useRef(false)
  const selection = useRef<number | null>(null)
  const previousSuggestions = useRef(suggestions)
  if (!focusClosing && suggestions.length)
    previousSuggestions.current = suggestions
  const visibleSuggestions = focusClosing
    ? previousSuggestions.current
    : suggestions
  const [bounds, setBounds] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 48,
    panelHeight: 300,
  })
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const measure = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (r)
      setBounds({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        panelHeight: Math.max(0, window.innerHeight - r.bottom - 28),
      })
  }, [])
  const startFocus = () => {
    measure()
    onFocusChange(true)
  }
  useEffect(() => {
    setDraftQuery(query)
    onDraftChange(query)
    setIsSearchExpanded(Boolean(query))
    setHighlighted(-1)
  }, [dismissSignal, query, onDraftChange])
  useEffect(() => {
    if (!focusActive) return undefined
    measure()
    const observer = new ResizeObserver(measure)
    if (anchor.current) observer.observe(anchor.current)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [focusActive, measure])
  useEffect(() => {
    if (!isSearchExpanded && !focusActive) {
      if (wasSearching.current)
        anchor.current
          ?.querySelector<HTMLButtonElement>('button[aria-label="Open search"]')
          ?.focus({ preventScroll: true })
      wasSearching.current = false
      return
    }
    wasSearching.current = true
    restoreFocus.current = true
    input.current?.focus({ preventScroll: true })
    if (selection.current !== null)
      input.current?.setSelectionRange(selection.current, selection.current)
    restoreFocus.current = false
  }, [focusActive, isSearchExpanded])
  const clear = () => {
    setDraftQuery('')
    onDraftChange('')
    onApply('')
    setIsSearchExpanded(false)
    setHighlighted(-1)
    if (focusActive) onFocusChange(false)
  }
  const submit = () => {
    const value = normalizeSearchQuery(draftQuery)
    if (!value) {
      clear()
      return
    }
    setDraftQuery(value)
    setHighlighted(-1)
    onApply(value)
    onFocusChange(false)
  }
  const expanded = isSearchExpanded || focusActive
  const control = (
    <motion.div
      layout={true}
      transition={spring}
      className={`${styles.root} ${expanded ? styles.expandedRoot : ''}`}
      data-discover="true"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Tab' && focusActive) {
          const nodes = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([tabindex="-1"]):not(:disabled), input[tabindex="0"]'
            )
          )
          const index = nodes.indexOf(document.activeElement as HTMLElement)
          const edge = event.shiftKey ? index <= 0 : index === nodes.length - 1
          if (nodes.length && edge) {
            event.preventDefault()
            nodes[event.shiftKey ? nodes.length - 1 : 0].focus()
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }
      }}
    >
      <motion.div
        layout={true}
        transition={spring}
        className={`${styles.search} ${expanded ? styles.expanded : ''}`}
      >
        <button
          type="button"
          aria-label="Open search"
          aria-expanded={expanded}
          className={styles.searchButton}
          onClick={() => {
            setIsSearchExpanded(true)
            if (normalizeSearchQuery(draftQuery)) startFocus()
            input.current?.focus()
          }}
        >
          <HugeiconsIcon icon={Search01Icon} size={24} />
        </button>
        <motion.div
          initial={false}
          animate={inputAnimation(expanded)}
          transition={spring}
          className={styles.inputWrap}
        >
          <input
            ref={input}
            aria-label="Search listings"
            type="text"
            placeholder="Search"
            tabIndex={expanded ? 0 : -1}
            className={styles.input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={
              focusActive && !focusClosing && suggestions.length > 0
            }
            aria-controls={focusActive ? `${id}-suggestions` : undefined}
            aria-activedescendant={
              focusActive && highlighted >= 0
                ? `${id}-suggestion-${highlighted}`
                : undefined
            }
            value={draftQuery}
            onFocus={() => {
              if (
                !restoreFocus.current &&
                normalizeSearchQuery(draftQuery) &&
                !focusActive
              )
                startFocus()
            }}
            onClick={() => {
              if (normalizeSearchQuery(draftQuery) && !focusActive) startFocus()
            }}
            onChange={(event) => {
              const value = event.target.value
              selection.current = event.target.selectionStart
              setDraftQuery(value)
              setHighlighted(-1)
              onDraftChange(value)
              if (normalizeSearchQuery(value)) startFocus()
              else if (focusActive) onFocusChange(false)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (
                (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                suggestions.length
              ) {
                event.preventDefault()
                startFocus()
                if (event.key === 'ArrowDown')
                  setHighlighted((index) => (index + 1) % suggestions.length)
                else
                  setHighlighted((index) =>
                    index <= 0 ? suggestions.length - 1 : index - 1
                  )
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (focusActive && highlighted >= 0 && suggestions[highlighted])
                  onSelect(suggestions[highlighted])
                else submit()
              }
            }}
          />
        </motion.div>
      </motion.div>
      <motion.div
        layout={true}
        transition={spring}
        className={`${styles.tabShell} ${expanded ? styles.collapsedTabs : ''}`}
      >
        <motion.div
          initial={false}
          animate={capsuleAnimation(expanded)}
          transition={spring}
          className={styles.clip}
        >
          <motion.div
            initial={false}
            animate={tabAnimation(expanded)}
            transition={{ duration: 0.2 }}
            className={styles.tabs}
            aria-hidden={expanded}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                tabIndex={expanded ? -1 : 0}
                aria-pressed={activeTab === tab.id}
                className={`${styles.tab} ${
                  activeTab === tab.id ? styles[tab.id] : ''
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {activeTab === tab.id && (
                  <motion.span
                    layoutId={`bubble-${id}`}
                    className={`${styles.bubble} ${styles[tab.id]}`}
                    transition={{ type: 'spring', bounce: 0.19, duration: 0.4 }}
                  />
                )}
                <HugeiconsIcon
                  icon={tab.icon}
                  size={20}
                  className={styles.icon}
                />
                <span>{tab.label}</span>
              </button>
            ))}
          </motion.div>
          <motion.div
            initial={false}
            animate={closeAnimation(expanded)}
            transition={{ duration: 0.2 }}
            className={styles.close}
            style={{ pointerEvents: expanded ? 'auto' : 'none' }}
          >
            <button
              type="button"
              aria-label="Close search"
              tabIndex={expanded ? 0 : -1}
              onClick={clear}
            >
              <HugeiconsIcon icon={MultiplicationSignIcon} size={24} />
            </button>
          </motion.div>
        </motion.div>
      </motion.div>
      {focusActive && visibleSuggestions.length > 0 && (
        <motion.div
          id={`${id}-suggestions`}
          role="listbox"
          aria-label="Search suggestions"
          className={styles.suggestions}
          style={{ maxHeight: bounds.panelHeight }}
          initial={{ opacity: 0 }}
          animate={{ opacity: focusClosing ? 0 : 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {visibleSuggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.kind}-${suggestion.label}`}
              id={`${id}-suggestion-${index}`}
              type="button"
              role="option"
              aria-selected={highlighted === index}
              disabled={focusClosing}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
            >
              {suggestion.label}
            </button>
          ))}
        </motion.div>
      )}
    </motion.div>
  )
  return (
    <div ref={anchor} className={styles.anchor}>
      {focusActive
        ? createPortal(
            <div
              className={styles.focusLayer}
              style={
                {
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  '--market-control-height': `${bounds.height}px`,
                } as CSSProperties
              }
            >
              {control}
            </div>,
            document.body
          )
        : control}
    </div>
  )
}

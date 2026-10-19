/* Focusable native scroll regions support keyboard scrolling without widget semantics. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
// Shared trigger-local shell for Market Filter/Sort; retains supplied option motion.
import { Check, ChevronDown, Filter, ArrowDownWideNarrow } from 'lucide-react'
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
  useAnimationControls,
} from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { sortPanelFade } from '@/lib/sort-panel-fade'

import styles from './filter-interaction.module.css'

function panelBounds(r: DOMRect, flip = false) {
  const viewport = window.visualViewport
  const below =
    (viewport?.height || window.innerHeight) +
    (viewport?.offsetTop || 0) -
    r.bottom -
    50
  const above = r.top - (viewport?.offsetTop || 0) - 50
  const opensAbove = flip && below < 144 && above > below
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    above: opensAbove,
    panelWidth: Math.max(0, r.right - 20),
    // Trigger-to-panel gap, panel padding/borders, then a safe bottom gap.
    panelHeight: Math.max(
      0,
      opensAbove
        ? above
        : (viewport?.height || window.innerHeight) +
            (viewport?.offsetTop || 0) -
            r.bottom -
            8 -
            26 -
            16
    ),
  }
}

export default function FilterInteraction({
  label,
  mobileLabel,
  options = [],
  value = '',
  onChange,
  isOpen,
  isClosing = false,
  onOpenChange,
  children,
  appearance = 'market',
  disabled = false,
  portalContainer,
  triggerContent,
  triggerClassName,
  panelClassName,
  topLayer = false,
}: {
  label: string
  mobileLabel?: string
  options?: Array<{ value: string; label: string }>
  value?: string
  onChange?: (value: string) => void
  isOpen: boolean
  isClosing?: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
  appearance?: 'market' | 'notification' | 'select'
  disabled?: boolean
  portalContainer?: HTMLElement | null
  triggerContent?: ReactNode
  triggerClassName?: string
  panelClassName?: string
  topLayer?: boolean
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const sortStyle = label === 'Sort' || appearance !== 'market'
  const select = appearance === 'select'
  const keyboardOpen = useRef(false)
  const normalTrigger = useRef<HTMLButtonElement>(null)
  const activeRoot = useRef<HTMLDivElement>(null)
  const idle = useRef<ReturnType<typeof setTimeout>>()
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const intent = useRef(0)
  const scrollbarDrag = useRef(false)
  const wasOpen = useRef(false)
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const [scrolling, setScrolling] = useState(false)
  const [bounds, setBounds] = useState({
    x: 0,
    y: 0,
    width: 48,
    height: 48,
    panelWidth: 320,
    panelHeight: 340,
    above: false,
  })
  useLayoutEffect(() => {
    // Local DOM typing for the native Popover API; keep the project's older DOM types unchanged.
    const root = activeRoot.current as
      | (HTMLDivElement & { showPopover: () => void })
      | null
    if (isOpen && topLayer && root) {
      root.setAttribute('popover', 'manual')
      root.showPopover()
    }
  }, [isOpen, topLayer])
  const id = useId()
  const reduced = useReducedMotion()
  const optionControls = useAnimationControls()
  useEffect(() => {
    if (sortStyle) return
    // An interrupted entrance must freeze too: only the panel opacity exits.
    if (isClosing) optionControls.stop()
    else if (isOpen) optionControls.start({ opacity: 1, y: 0 })
  }, [isClosing, isOpen, optionControls, sortStyle])
  const close = () => {
    onOpenChange(false)
    normalTrigger.current?.focus()
  }
  useEffect(() => {
    if (!isOpen) {
      if (wasOpen.current) normalTrigger.current?.focus()
      wasOpen.current = false
      setScrolling(false)
      intent.current = 0
      scrollbarDrag.current = false
      return undefined
    }
    wasOpen.current = true
    activeTrigger.current?.focus()
    if (select && keyboardOpen.current) {
      const selectedOption =
        activeRoot.current?.querySelector<HTMLElement>(
          '[data-sort-option][aria-pressed="true"]'
        ) ||
        activeRoot.current?.querySelector<HTMLElement>('[data-sort-option]')
      selectedOption?.focus()
      keyboardOpen.current = false
    }
    const measure = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setBounds(panelBounds(r, select))
    }
    measure()
    const dismiss = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-market-focus-backdrop]'))
        return
      if (!activeRoot.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (
        select &&
        ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) &&
        activeRoot.current?.contains(e.target as Node)
      ) {
        const optionNodes = Array.from(
          activeRoot.current.querySelectorAll<HTMLElement>('[data-sort-option]')
        )
        if (optionNodes.length) {
          e.preventDefault()
          const index = optionNodes.indexOf(
            document.activeElement as HTMLElement
          )
          let next =
            (index + (e.key === 'ArrowDown' ? 1 : -1) + optionNodes.length) %
            optionNodes.length
          if (e.key === 'Home') next = 0
          if (e.key === 'End') next = optionNodes.length - 1
          optionNodes[next].focus()
        }
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(
          activeRoot.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select,a[href],input,[tabindex="0"]'
          ) || []
        )
        const index = nodes.indexOf(document.activeElement as HTMLElement)
        if (
          nodes.length &&
          (index < 0 || (e.shiftKey ? index === 0 : index === nodes.length - 1))
        ) {
          e.preventDefault()
          nodes[e.shiftKey ? nodes.length - 1 : 0].focus()
        }
      }
      if (e.key === 'Escape') {
        if (select) {
          e.preventDefault()
          e.stopPropagation()
        }
        onOpenChange(false)
        normalTrigger.current?.focus()
      }
    }
    const drag = () => {
      if (scrollbarDrag.current) intent.current = Date.now() + 800
    }
    const endDrag = () => {
      scrollbarDrag.current = false
    }
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    document.addEventListener('pointermove', drag)
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('pointermove', drag)
      document.removeEventListener('pointerup', endDrag)
      document.removeEventListener('pointercancel', endDrag)
      clearTimeout(idle.current)
      clearTimeout(closeTimer.current)
    }
  }, [isOpen, onOpenChange, select])
  let appearanceClass = ''
  if (appearance === 'notification') appearanceClass = styles.inbox
  else if (select) appearanceClass = styles.select
  const renderTrigger = (placeholder = false) => (
    <button
      ref={placeholder ? normalTrigger : activeTrigger}
      type="button"
      disabled={disabled}
      className={[styles.trigger, triggerClassName].filter(Boolean).join(' ')}
      aria-label={label}
      data-mobile-label={mobileLabel ? true : undefined}
      aria-expanded={isOpen && !isClosing}
      aria-controls={isOpen ? id : undefined}
      aria-hidden={placeholder && isOpen ? true : undefined}
      tabIndex={placeholder && isOpen ? -1 : 0}
      style={placeholder && isOpen ? { visibility: 'hidden' } : undefined}
      onKeyDown={(event) => {
        if (select && !isOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault()
          keyboardOpen.current = true
          const r = anchor.current?.getBoundingClientRect()
          if (r) setBounds(panelBounds(r, true))
          onOpenChange(true)
        }
      }}
      onClick={() => {
        if (isClosing) return
        if (isOpen) close()
        else {
          const r = anchor.current?.getBoundingClientRect()
          if (r) setBounds(panelBounds(r, select))
          onOpenChange(true)
        }
      }}
    >
      {triggerContent ?? (
        <>
          {appearance === 'market' &&
            (label === 'Sort' ? (
              <ArrowDownWideNarrow size={22} />
            ) : (
              <Filter size={22} />
            ))}
          <span className={styles.selection}>
            {sortStyle
              ? options.find((option) => option.value === value)?.label || label
              : label}
          </span>
          {appearance !== 'market' && (
            <ChevronDown size={16} aria-hidden={true} />
          )}
          {mobileLabel && (
            <span className={styles.mobileLabel}>{mobileLabel}</span>
          )}
        </>
      )}
    </button>
  )
  return (
    <>
      <div ref={anchor} className={`${styles.control} ${appearanceClass}`}>
        {renderTrigger(true)}
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={activeRoot}
            className={`${styles.control} ${styles.active} ${appearanceClass} ${
              select && bounds.above ? styles.above : ''
            }`}
            style={
              {
                position: 'fixed',
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
                '--panel-width': `${bounds.panelWidth}px`,
                '--panel-height': `${bounds.panelHeight}px`,
                '--market-control-height': `${bounds.height}px`,
              } as CSSProperties
            }
          >
            <MotionConfig
              transition={{
                type: 'spring',
                duration: reduced ? 0 : 0.85,
                bounce: 0.35,
              }}
            >
              {renderTrigger()}
              <AnimatePresence>
                <motion.section
                  id={id}
                  aria-label={`${label} options`}
                  className={`${styles.panel} ${
                    sortStyle ? styles.sortPanel : ''
                  } ${panelClassName || ''}`}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: isClosing ? 0 : 1,
                  }}
                  transition={
                    sortStyle
                      ? sortPanelFade
                      : {
                          duration: isClosing ? 0.18 : 0.2,
                          ease: 'easeOut',
                        }
                  }
                  exit={{ opacity: 0 }}
                >
                  <div
                    role="region"
                    aria-label={`${label} scrolling content`}
                    tabIndex={0}
                    className={`${styles.scroll} ${
                      scrolling ? styles.scrolling : ''
                    }`}
                    onWheel={() => {
                      intent.current = Date.now() + 800
                    }}
                    onTouchMove={() => {
                      intent.current = Date.now() + 800
                    }}
                    onPointerDown={(e) => {
                      if (
                        e.target === e.currentTarget &&
                        e.clientX >=
                          e.currentTarget.getBoundingClientRect().right - 20
                      ) {
                        scrollbarDrag.current = true
                        intent.current = Date.now() + 800
                      }
                    }}
                    onKeyDown={(e) => {
                      if ((e.target as HTMLElement).closest('select,input'))
                        return
                      if (
                        [
                          'ArrowDown',
                          'ArrowUp',
                          'PageDown',
                          'PageUp',
                          'Home',
                          'End',
                          ' ',
                        ].includes(e.key)
                      )
                        intent.current = Date.now() + 800
                    }}
                    onScroll={(e) => {
                      if (
                        (!scrollbarDrag.current &&
                          Date.now() > intent.current) ||
                        e.currentTarget.scrollHeight <=
                          e.currentTarget.clientHeight
                      )
                        return
                      setScrolling(true)
                      clearTimeout(idle.current)
                      idle.current = setTimeout(() => setScrolling(false), 600)
                    }}
                  >
                    {children ||
                      options.map((option, index) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          className={styles.option}
                          data-sort-option={true}
                          aria-pressed={option.value === value}
                          initial={
                            sortStyle
                              ? false
                              : { opacity: 0, y: reduced ? 0 : 40 }
                          }
                          animate={sortStyle ? undefined : optionControls}
                          transition={
                            sortStyle
                              ? { type: 'tween', duration: 0 }
                              : {
                                  type: 'spring',
                                  bounce: 0.1,
                                  duration: reduced ? 0 : 0.25,
                                  delay: reduced ? 0 : (index + 8) * 0.025,
                                  ease: [0.215, 0.61, 0.355, 1],
                                }
                          }
                          onClick={() => {
                            onChange?.(option.value)
                            closeTimer.current = setTimeout(close, 150)
                          }}
                        >
                          <span>{option.label}</span>
                          <span className={styles.check}>
                            {option.value === value && <Check size={16} />}
                          </span>
                        </motion.button>
                      ))}
                  </div>
                </motion.section>
              </AnimatePresence>
            </MotionConfig>
          </div>,
          portalContainer || document.body
        )}
    </>
  )
}

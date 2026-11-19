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
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  UIEvent as ReactUIEvent,
} from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  dropdownMotion,
  dropdownPanelTransition,
  dropdownMotionVars,
} from '@/components/ui/dropdown-motion'

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
  hasChevron = false,
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
  hasChevron?: boolean
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const sortStyle = label === 'Sort' || appearance !== 'market'
  const marketSort = appearance === 'market' && label === 'Sort'
  const select = appearance === 'select'
  const keyboardOpen = useRef(false)
  const normalTrigger = useRef<HTMLButtonElement>(null)
  const activeRoot = useRef<HTMLDivElement>(null)
  const idle = useRef<ReturnType<typeof setTimeout>>()
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const intent = useRef(0)
  const scrollbarDrag = useRef(false)
  const wasOpen = useRef(false)
  const externallyClosing = useRef(false)
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const [scrolling, setScrolling] = useState(false)
  const [present, setPresent] = useState(isOpen)
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
      | (HTMLDivElement & {
          showPopover: () => void
          hidePopover?: () => void
        })
      | null
    if (present && topLayer && root) {
      root.setAttribute('popover', 'manual')
      root.showPopover()
    } else if (topLayer && root) {
      root.hidePopover?.()
    }
  }, [present, topLayer])
  const id = useId()
  const reduced = useReducedMotion()
  const closing = isClosing || (!isOpen && present)
  useEffect(() => {
    if (isOpen) {
      if (isClosing) externallyClosing.current = true
      setPresent(true)
      return undefined
    }
    if (!present) return undefined
    if (externallyClosing.current) {
      externallyClosing.current = false
      setPresent(false)
      return undefined
    }
    const timer = setTimeout(
      () => setPresent(false),
      reduced ? 0 : dropdownMotion.panelExit * 1000
    )
    return () => clearTimeout(timer)
  }, [isClosing, isOpen, present, reduced])
  const optionControls = useAnimationControls()
  const [sortWidth, setSortWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!marketSort) return undefined

    const desktop = window.matchMedia('(min-width: 1024px)')

    const measureSortWidth = () => {
      if (!desktop.matches) {
        setSortWidth(null)
        return
      }

      const trigger = normalTrigger.current
      const selection = trigger?.querySelector<HTMLElement>(
        '[data-sort-selection]'
      )
      if (!trigger || !selection) return

      const computed = window.getComputedStyle(trigger)
      const iconWidth =
        trigger.querySelector('svg')?.getBoundingClientRect().width ?? 22

      const width = Math.ceil(
        selection.scrollWidth +
          iconWidth +
          (parseFloat(computed.columnGap) || 8) +
          parseFloat(computed.paddingLeft) +
          parseFloat(computed.paddingRight) +
          parseFloat(computed.borderLeftWidth) +
          parseFloat(computed.borderRightWidth)
      )

      setSortWidth(width)
    }

    measureSortWidth()
    desktop.addEventListener('change', measureSortWidth)
    return () => desktop.removeEventListener('change', measureSortWidth)
  }, [marketSort, value])
  useEffect(() => {
    const initial = {
      opacity: 0,
      y: reduced ? 0 : dropdownMotion.contentOffset,
    }
    // Portal content mounts after the first open render. Starting controls
    // before that mount leaves new option nodes at their initial opacity.
    if (!isOpen || !present) {
      optionControls.stop()
      optionControls.set(initial)
      return undefined
    }
    if (closing) {
      optionControls.stop()
      return undefined
    }
    const frame = requestAnimationFrame(() => {
      optionControls.start({ opacity: 1, y: 0 })
    })
    return () => cancelAnimationFrame(frame)
  }, [closing, isOpen, optionControls, present, reduced])
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
    if (marketSort) {
      normalTrigger.current?.focus()
    } else {
      activeTrigger.current?.focus()
    }
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
    const anchorElement = anchor.current
    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && anchorElement) {
      resizeObserver = new ResizeObserver(measure)
      resizeObserver.observe(anchorElement)
    }
    const dismiss = (e: PointerEvent) => {
      if (
        !activeRoot.current?.contains(e.target as Node) &&
        !anchor.current?.contains(e.target as Node)
      )
        onOpenChange(false)
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
      resizeObserver?.disconnect()
      clearTimeout(idle.current)
      clearTimeout(closeTimer.current)
    }
  }, [isOpen, marketSort, onOpenChange, select])
  let appearanceClass = ''
  if (appearance === 'notification') appearanceClass = styles.inbox
  else if (select) appearanceClass = styles.select
  const renderTrigger = (placeholder = false) => (
    <motion.button
      ref={placeholder || marketSort ? normalTrigger : activeTrigger}
      type="button"
      disabled={disabled}
      className={[styles.trigger, triggerClassName].filter(Boolean).join(' ')}
      aria-label={label}
      data-mobile-label={mobileLabel ? true : undefined}
      data-has-chevron={hasChevron || undefined}
      aria-expanded={isOpen && !isClosing}
      aria-controls={isOpen ? id : undefined}
      aria-hidden={placeholder && present ? true : undefined}
      tabIndex={placeholder && present ? -1 : 0}
      style={{
        ...(placeholder && present ? { visibility: 'hidden' } : {}),
        ...(marketSort ? { transformOrigin: 'right center' } : {}),
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
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
          <span
            className={styles.selection}
            data-sort-selection={marketSort ? 'true' : undefined}
          >
            {sortStyle
              ? options.find((option) => option.value === value)?.label || label
              : label}
          </span>
          {appearance !== 'market' && (
            <ChevronDown
              className={styles.chevron}
              size={16}
              aria-hidden={true}
            />
          )}
          {mobileLabel && (
            <span className={styles.mobileLabel}>{mobileLabel}</span>
          )}
        </>
      )}
    </motion.button>
  )
  return (
    <>
      <div
        ref={anchor}
        className={`${styles.control} ${appearanceClass} ${
          marketSort ? styles.marketSort : ''
        }`}
        style={
          {
            ...dropdownMotionVars(Boolean(reduced)),
            ...(marketSort && sortWidth !== null ? { width: sortWidth } : {}),
          } as CSSProperties
        }
      >
        {renderTrigger(!marketSort)}
      </div>
      {present &&
        createPortal(
          <div
            ref={activeRoot}
            className={`${styles.control} ${styles.active} ${appearanceClass} ${
              marketSort ? styles.marketSort : ''
            } ${select && bounds.above ? styles.above : ''}`}
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
                ...dropdownMotionVars(Boolean(reduced)),
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
              {!marketSort && renderTrigger()}
              <AnimatePresence>
                <motion.section
                  id={id}
                  aria-label={`${label} options`}
                  className={`${styles.panel} ${
                    sortStyle ? styles.sortPanel : ''
                  } ${panelClassName || ''}`}
                  initial={{
                    opacity: 0,
                    y: reduced ? 0 : dropdownMotion.panelOffset,
                    scale: reduced ? 1 : dropdownMotion.panelScale,
                  }}
                  animate={{
                    opacity: closing ? 0 : 1,
                    y: closing ? (reduced ? 0 : dropdownMotion.panelOffset) : 0,
                    scale: closing
                      ? reduced
                        ? 1
                        : dropdownMotion.panelScale
                      : 1,
                  }}
                  transition={dropdownPanelTransition(
                    Boolean(reduced),
                    closing
                  )}
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
                    onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
                      if (
                        e.target === e.currentTarget &&
                        e.clientX >=
                          e.currentTarget.getBoundingClientRect().right - 20
                      ) {
                        scrollbarDrag.current = true
                        intent.current = Date.now() + 800
                      }
                    }}
                    onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
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
                    onScroll={(e: ReactUIEvent<HTMLDivElement>) => {
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
                    data-dropdown-content-state={closing ? 'closing' : 'open'}
                  >
                    {children ||
                      options.map((option, index) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          className={styles.option}
                          data-sort-option={true}
                          aria-pressed={option.value === value}
                          initial={false}
                          animate={optionControls}
                          transition={{
                            type: 'spring',
                            bounce: 0.1,
                            duration: reduced ? 0 : 0.25,
                            delay: reduced
                              ? 0
                              : (index + dropdownMotion.itemDelayOffset) *
                                dropdownMotion.itemDelay,
                            ease: dropdownMotion.ease,
                          }}
                          onClick={() => {
                            onChange?.(option.value)
                            closeTimer.current = setTimeout(
                              close,
                              marketSort ? 320 : 150
                            )
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

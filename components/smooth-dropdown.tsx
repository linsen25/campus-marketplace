'use client'

// CSS Modules adaptation of the supplied UseLayouts Smooth Dropdown source.
import { ChevronDown } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import styles from './smooth-dropdown.module.css'

export type SmoothMenuItem = {
  id: string
  label: string
  icon: ReactNode
  children?: Array<{ id: string; label: string }>
}
const easeOutQuint: [number, number, number, number] = [0.23, 1, 0.32, 1]

export default function MenuInteraction({
  items,
  activeItem,
  selectedChild,
  onSelect,
  compact = false,
}: {
  items: SmoothMenuItem[]
  activeItem: string
  selectedChild?: string
  onSelect: (id: string, child?: string) => void
  /** Icon-only global mobile navigation trigger. */
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  // Accordion disclosure is independent of the active navigation destination.
  const [expandedParent, setExpandedParent] = useState<string | null>(
    activeItem
  )
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentBounds, setContentBounds] = useState({ height: 0 })
  useEffect(() => {
    const element = contentRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() =>
      setContentBounds({ height: element.getBoundingClientRect().height })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const reduced = useReducedMotion()
  const id = useId()
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node))
        setIsOpen(false)
    }
    if (isOpen) document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [isOpen])
  useEffect(() => {
    const menu =
      containerRef.current?.querySelector<HTMLElement>('[data-smooth-menu]')
    if (isOpen) menu?.removeAttribute('inert')
    else menu?.setAttribute('inert', '')
  }, [isOpen])
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      triggerRef.current?.focus()
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && isOpen) {
      event.preventDefault()
      const buttons = Array.from(
        containerRef.current?.querySelectorAll<HTMLButtonElement>(
          '[data-smooth-menu] button'
        ) || []
      )
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement
      )
      let next = (current + 1) % buttons.length
      if (event.key === 'ArrowUp')
        next = (current - 1 + buttons.length) % buttons.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = buttons.length - 1
      buttons[next]?.focus()
    }
  }
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Home section navigation"
      className={`${styles.container} ${compact ? styles.compact : ''}`}
      data-smooth-dropdown="true"
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={compact ? 'Open Home navigation' : 'Show more'}
        aria-expanded={isOpen}
        aria-controls={id}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (!isOpen)
            setExpandedParent(
              items.some(
                (item) => item.id === activeItem && item.children?.length
              )
                ? activeItem
                : null
            )
          setIsOpen((open) => !open)
        }}
      >
        {!compact && 'Show more'}
        {compact ? (
          <motion.svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            data-mobile-menu-icon={isOpen ? 'open' : 'closed'}
            initial={false}
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
          >
            <motion.path
              initial={false}
              animate={{ d: isOpen ? 'M 4 12 L 12 4' : 'M 4 6 L 20 6' }}
              transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
            />
            <path d="M 4 12 L 20 12" />
            <motion.path
              initial={false}
              animate={{ d: isOpen ? 'M 4 12 L 12 20' : 'M 4 18 L 20 18' }}
              transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
            />
          </motion.svg>
        ) : (
          <ChevronDown size={22} aria-hidden="true" />
        )}
      </button>
      <motion.div
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          height: Math.max(40, Math.ceil(contentBounds.height)),
        }}
        transition={{
          type: 'tween',
          duration: reduced ? 0 : 0.18,
          ease: 'easeOut',
        }}
        className={styles.surface}
        style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
      >
        <div
          ref={contentRef}
          id={id}
          data-smooth-menu="true"
          aria-hidden={!isOpen}
        >
          <motion.div
            layout={true}
            initial={false}
            animate={{ opacity: isOpen ? 1 : 0 }}
            transition={{
              duration: reduced ? 0 : 0.2,
              delay: isOpen && !reduced ? 0.08 : 0,
            }}
            className={styles.content}
            style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
          >
            <ul className={styles.list}>
              {items.map((item, index) => {
                const isActive = activeItem === item.id
                const hasChildren = Boolean(item.children?.length)
                const isExpanded = expandedParent === item.id
                const showIndicator = hoveredItem
                  ? hoveredItem === item.id
                  : isActive
                return (
                  <motion.li
                    key={item.id}
                    initial={false}
                    animate={{
                      opacity: isOpen ? 1 : 0,
                      x: isOpen || reduced ? 0 : 8,
                    }}
                    transition={{
                      delay: isOpen && !reduced ? 0.06 + index * 0.02 : 0,
                      duration: reduced ? 0 : 0.15,
                      ease: easeOutQuint,
                    }}
                  >
                    <button
                      type="button"
                      className={styles.item}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      aria-current={
                        isActive && !hasChildren ? 'page' : undefined
                      }
                      onKeyDown={handleKeyDown}
                      onMouseEnter={() => setHoveredItem(item.id)}
                      onMouseLeave={() => setHoveredItem(null)}
                      onFocus={() => setHoveredItem(item.id)}
                      onBlur={() => setHoveredItem(null)}
                      onClick={() => {
                        if (hasChildren) {
                          setExpandedParent((current) =>
                            current === item.id ? null : item.id
                          )
                        } else {
                          onSelect(item.id)
                          setIsOpen(false)
                          triggerRef.current?.focus()
                        }
                      }}
                    >
                      {showIndicator && (
                        <>
                          <motion.span
                            layoutId={`${id}-activeIndicator`}
                            className={styles.indicator}
                            transition={
                              reduced
                                ? { duration: 0 }
                                : {
                                    type: 'spring',
                                    damping: 30,
                                    stiffness: 520,
                                    mass: 0.8,
                                  }
                            }
                          />
                          <motion.span
                            layoutId={`${id}-leftBar`}
                            className={styles.bar}
                          />
                        </>
                      )}
                      <span className={styles.icon}>{item.icon}</span>
                      <span className={styles.label}>{item.label}</span>
                      {hasChildren && (
                        <motion.span
                          className={styles.parentArrow}
                          initial={false}
                          animate={{ rotate: isExpanded ? 0 : -90 }}
                          transition={{
                            duration: reduced ? 0 : 0.18,
                            ease: 'easeOut',
                          }}
                        >
                          <ChevronDown size={16} aria-hidden="true" />
                        </motion.span>
                      )}
                    </button>
                    {isExpanded && item.children && (
                      <ul className={styles.children}>
                        {item.children.map((child) => (
                          <li key={child.id}>
                            <button
                              type="button"
                              aria-current={
                                isActive && selectedChild === child.id
                                  ? 'page'
                                  : undefined
                              }
                              onKeyDown={handleKeyDown}
                              onClick={() => {
                                onSelect(item.id, child.id)
                                setIsOpen(false)
                                triggerRef.current?.focus()
                              }}
                            >
                              {child.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.li>
                )
              })}
            </ul>
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}

/* Preserve the supplied keyboard/typeahead and forced-layout animation choreography. */
/* eslint-disable no-void, no-nested-ternary, complexity */
'use client'

import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import styles from './GlideSelect.module.css'

const SIZES = {
  sm: { chip: 28, row: 26, font: 12 },
  md: { chip: 32, row: 30, font: 13 },
  lg: { chip: 44, row: 40, font: 14 },
}
const GAP = 1
const DEFAULT_OPTIONS = ['One', 'Two', 'Three']

const norm = (o) => (typeof o === 'string' ? { value: o, label: o } : o)
const textOf = (it) => (typeof it.label === 'string' ? it.label : it.value)
const typeaheadIndex = (items, from, ch) => {
  const c = ch.toLowerCase()
  const n = items.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (textOf(items[i]).toLowerCase().startsWith(c)) return i
  }
  return from
}

export default function GlideSelect({
  options = DEFAULT_OPTIONS,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select',
  showTags = true,
  accentColor = '#f5f5f5',
  surfaceColor = '#27272a',
  highlightColor = '#3f3f46',
  textColor = '#f5f5f5',
  size = 'md',
  radius = 10,
  menuWidth = 176,
  placement = 'bottom',
  align = 'left',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  disabled = false,
  ariaLabel = 'Select',
  className = '',
}) {
  const items = options.map(norm)
  const [inner, setInner] = useState(defaultValue ?? '')
  const current = value ?? inner
  const selected = items.findIndex((it) => it.value === current)
  const [phase, setPhase] = useState('closed')
  const [active, setActive] = useState(null)
  const [side, setSide] = useState(placement)
  const [scrolling, setScrolling] = useState(false)
  const scrollIntent = useRef(0)
  const scrollbarPointer = useRef(false)
  const scrollIdle = useRef(undefined)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const pillRef = useRef(null)
  const instant = useRef(false)
  const closeTimer = useRef(undefined)
  const scrub = useRef(null)
  const id = useId()
  const S = SIZES[size] ?? SIZES.md
  const step = S.row + GAP
  const popOut = Math.round((popDuration * 2) / 3)

  useLayoutEffect(() => {
    if (phase !== 'open') return
    const el = menuRef.current
    const root = rootRef.current
    if (!el || !root) return
    // Market's bounded inner scroll region keeps the menu below its field.
    setSide('bottom')
    setScrolling(false)
    scrollIntent.current = 0
    scrollbarPointer.current = false
    el.style.transitionDuration = instant.current ? '0ms' : ''
    el.dataset.state = 'closed'
    void el.offsetHeight
    el.dataset.state = 'open'
    const p = pillRef.current
    if (p) {
      p.style.transition = 'none'
      p.style.transform = `translateY(${Math.max(0, selected) * step}px)`
      p.style.opacity = '0'
      void p.offsetHeight
      p.style.transition = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useLayoutEffect(() => {
    const p = pillRef.current
    if (!p || phase !== 'open') return
    if (active === null) {
      p.style.opacity = '0'
      return
    }
    const jump = instant.current || p.style.opacity !== '1'
    p.style.transitionDuration = jump ? '0ms, 150ms' : ''
    p.style.transform = `translateY(${active * step}px)`
    p.style.opacity = '1'
    const list = menuRef.current?.querySelector('[role="listbox"]')
    if (list && Date.now() <= scrollIntent.current) {
      const top = active * step
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + S.row > list.scrollTop + list.clientHeight)
        list.scrollTop = top + S.row - list.clientHeight
    }
    instant.current = false
  }, [active, phase, step, S.row])

  const open = (viaKey) => {
    if (disabled) return
    clearTimeout(closeTimer.current)
    instant.current = true
    setActive(selected >= 0 ? selected : viaKey ? 0 : null)
    setPhase('open')
  }
  const close = (mode) => {
    setActive(null)
    clearTimeout(closeTimer.current)
    const el = menuRef.current
    if (mode === 'instant' || !el) {
      setPhase('closed')
      return
    }
    el.style.transitionDuration = ''
    el.dataset.state = 'closed'
    setPhase('closing')
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20)
  }
  const pick = (i, viaKey) => {
    const it = items[i]
    if (!it) {
      close('instant')
      return
    }
    if (it.value !== current) {
      if (value === undefined) setInner(it.value)
      onChange?.(it.value, it)
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = ''
    }
    close('instant')
    triggerRef.current?.focus({ preventScroll: true })
  }

  const onTriggerKey = (e) => {
    const k = e.key
    const n = items.length
    const cur = active ?? Math.max(0, selected)
    if (phase !== 'open') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault()
        open(true)
      }
      return
    }
    const go = (i) => {
      e.preventDefault()
      scrollIntent.current = Date.now() + 800
      instant.current = true
      setActive(Math.min(n - 1, Math.max(0, i)))
    }
    if (k === 'ArrowDown' || k === 'ArrowUp')
      go(active === null ? cur : cur + (k === 'ArrowDown' ? 1 : -1))
    else if (k === 'Home' || k === 'End') go(k === 'Home' ? 0 : n - 1)
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault()
      pick(cur, true)
    } else if (k === 'Escape' || k === 'Tab') {
      if (k === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
      close('instant')
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey)
      go(typeaheadIndex(items, cur, k))
  }

  useEffect(() => {
    if (phase === 'closed') return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close('pop')
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => {
    if (disabled && phase !== 'closed') close('instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])
  useEffect(
    () => () => {
      clearTimeout(closeTimer.current)
      clearTimeout(scrollIdle.current)
    },
    []
  )
  useEffect(() => {
    const release = () => {
      scrollbarPointer.current = false
    }
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', release)
    return () => {
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
    }
  }, [])

  const rowAt = (y) => {
    const s = scrub.current
    if (!s) return null
    const i = Math.floor(
      (y -
        s.top +
        (menuRef.current?.querySelector('[role="listbox"]')?.scrollTop || 0)) /
        step
    )
    return i >= 0 && i < items.length ? i : null
  }
  const onListDown = (e) => {
    if (
      e.target === e.currentTarget &&
      e.clientX >= e.currentTarget.getBoundingClientRect().right - 12
    ) {
      scrollbarPointer.current = true
      scrollIntent.current = Date.now() + 800
      return
    }
    if (scrub.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is optional on browsers that release it during native scrolling.
    }
    scrub.current = {
      id: e.pointerId,
      top: e.currentTarget.getBoundingClientRect().top,
      startY: e.clientY,
      touch: e.pointerType === 'touch',
    }
    instant.current = true
    setActive(rowAt(e.clientY))
  }
  const onListMove = (e) => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return
    const i = rowAt(e.clientY)
    if (i !== active) setActive(i)
  }
  const onListUp = (e) => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return
    const i =
      e.type === 'pointerup' &&
      (!scrub.current.touch || Math.abs(e.clientY - scrub.current.startY) < 8)
        ? rowAt(e.clientY)
        : null
    scrub.current = null
    if (i !== null) pick(i, false)
    else if (!rememberPosition) setActive(null)
  }
  const onListOver = (e) => {
    if (e.pointerType === 'touch' || scrub.current) return
    const row = e.target.closest('[data-index]')
    if (!row) return
    const i = Number(row.dataset.index)
    if (i !== active) setActive(i)
  }

  const origin = `${side === 'bottom' ? 'top' : 'bottom'} ${align}`
  return (
    <div
      ref={rootRef}
      className={`${styles['glide-select']}${className ? ` ${className}` : ''}`}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      style={{
        '--gs-accent': accentColor,
        '--gs-surface': surfaceColor,
        '--gs-highlight': highlightColor,
        '--gs-text': textColor,
        '--gs-radius': `${radius}px`,
        '--gs-inner-radius': `${Math.max(3, radius - 4)}px`,
        '--gs-chip': `${S.chip}px`,
        '--gs-row': `${S.row}px`,
        '--gs-font': `${S.font}px`,
        '--gs-menu-w': `${menuWidth}px`,
        '--gs-pop': `${popDuration}ms`,
        '--gs-pop-out': `${popOut}ms`,
        '--gs-glide': `${glideDuration}ms`,
        '--gs-origin': origin,
      }}
      onAnimationEnd={(e) => {
        if (e.animationName.includes('gs-swap') && rootRef.current)
          delete rootRef.current.dataset.swap
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={styles['glide-select__trigger']}
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return
          e.currentTarget.focus({ preventScroll: true })
          if (phase === 'open') close('pop')
          else open(false)
        }}
        onKeyDown={onTriggerKey}
      >
        <span
          className={styles['glide-select__label']}
          key={current}
          data-empty={selected < 0 ? '' : undefined}
        >
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className={styles['glide-select__chevron']} aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.5} />
        </span>
      </button>
      {phase !== 'closed' ? (
        <div
          ref={menuRef}
          className={styles['glide-select__menu']}
          data-state="open"
          data-side={side}
          data-align={align}
        >
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            className={`${styles['glide-select__list']} ${
              scrolling ? styles.scrolling : ''
            }`}
            data-live={active !== null ? '' : undefined}
            onWheel={() => {
              scrollIntent.current = Date.now() + 800
            }}
            onTouchMove={() => {
              scrollIntent.current = Date.now() + 800
            }}
            onScroll={(e) => {
              if (
                (!scrollbarPointer.current &&
                  Date.now() > scrollIntent.current) ||
                e.currentTarget.scrollHeight <= e.currentTarget.clientHeight
              )
                return
              setScrolling(true)
              clearTimeout(scrollIdle.current)
              scrollIdle.current = setTimeout(() => setScrolling(false), 600)
            }}
            onPointerOver={onListOver}
            onPointerLeave={() => {
              if (!scrub.current && !rememberPosition) setActive(null)
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
          >
            <span
              ref={pillRef}
              className={styles['glide-select__pill']}
              aria-hidden="true"
            />
            {items.map((it, i) => (
              <div
                key={it.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === selected}
                data-index={i}
                className={styles['glide-select__option']}
              >
                <span className={styles['glide-select__name']}>{it.label}</span>
                {showTags && it.tag ? (
                  <span className={styles['glide-select__tag']}>{it.tag}</span>
                ) : null}
                <span
                  className={styles['glide-select__check']}
                  data-on={i === selected ? '' : undefined}
                  aria-hidden="true"
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={13}
                    strokeWidth={2.5}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

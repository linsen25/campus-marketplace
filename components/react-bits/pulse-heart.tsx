'use client'

/* eslint-disable no-nested-ternary, react/no-array-index-key -- Preserve the supplied Pulse Heart easing and positional digit rollover. */
// User-supplied React Bits implementation, using its custom-icon animation path.
import { Heart } from 'lucide-react'
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import styles from './pulse-heart.module.css'

const OUT = 0.4

interface PulseHeartProps {
  liked?: boolean
  defaultLiked?: boolean
  count?: number
  onChange?: (liked: boolean, count: number) => void
  showCount?: boolean
  icon?: ReactNode
  idleOutline?: boolean
  size?: number
  corner?: number
  likedColor?: string
  idleColor?: string
  pillColor?: string
  textColor?: string
  duration?: number
  dotSize?: number
  overshoot?: number
  beat?: number
  rollDuration?: number
  disabled?: boolean
  label?: string
  className?: string
}

type CountRoll = { a: string; b: string; at: number; up: boolean }

const back = (k: number, c: number) => {
  const u = k - 1
  return 1 + (c + 1) * u ** 3 + c * u ** 2
}
const swellOf = (t: number, c: number) =>
  t <= 0
    ? 0
    : t < OUT
    ? 1 - (1 - t / OUT) ** 3
    : 1 - back((t - OUT) / (1 - OUT), c)
const format = (n: number) => new Intl.NumberFormat().format(n)
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

export default function PulseHeart({
  liked: likedProp,
  defaultLiked = false,
  count = 0,
  onChange,
  showCount = true,
  icon = <Heart />,
  idleOutline = true,
  size = 40,
  corner = 32,
  likedColor = '#ff4d6d',
  idleColor = '#8b8b93',
  pillColor = '#232326',
  textColor = '#f5f5f5',
  duration = 560,
  dotSize = 0.3,
  overshoot = 1.7,
  beat = 3,
  rollDuration = 350,
  disabled = false,
  label = 'Like',
  className = '',
}: PulseHeartProps) {
  const controlled = likedProp !== undefined
  const [inner, setInner] = useState(defaultLiked)
  const [total, setTotal] = useState(count)
  const liked = controlled ? likedProp : inner
  const [shown, setShown] = useState({ liked, count })
  const [roll, setRoll] = useState<CountRoll | null>(null)

  const rootRef = useRef<HTMLButtonElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const heartRef = useRef<HTMLSpanElement>(null)

  const rollRef = useRef<HTMLSpanElement>(null)
  const raf = useRef(0)
  const rollTimer = useRef(0)
  const viaPointer = useRef(false)
  const shownRef = useRef(shown)
  const logical = useRef({ liked, count: total })
  logical.current = { liked, count: total }
  const cfg = useRef({ duration, dotSize, overshoot, beat, rollDuration })
  cfg.current = { duration, dotSize, overshoot, beat, rollDuration }

  useEffect(() => {
    setTotal(count)
  }, [count])

  useEffect(() => {
    if (raf.current) return
    if (shownRef.current.liked === liked && shownRef.current.count === total)
      return
    shownRef.current = { liked, count: total }
    setShown(shownRef.current)
  }, [liked, total])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || root.dataset.instant === undefined) return
    root.getBoundingClientRect()
    delete root.dataset.instant
  }, [shown])

  useLayoutEffect(() => {
    const el = rollRef.current
    if (!el || !roll) return
    el.style.transition = 'none'
    el.style.transform = `translateY(${roll.up ? '0' : '-1em'})`
    el.getBoundingClientRect()
    el.style.transition = ''
    el.style.transform = `translateY(${roll.up ? '-1em' : '0'})`
  }, [roll])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(rollTimer.current)
    },
    []
  )

  const startRoll = (from: number, to: number) => {
    if (from === to) return
    const a = format(from)
    const b = format(to)
    const changed =
      a.length === b.length
        ? Array.from(b).flatMap((ch, i) => (ch !== a[i] ? [i] : []))
        : []
    setRoll({ a, b, at: changed.length === 1 ? changed[0] : -1, up: to > from })
    clearTimeout(rollTimer.current)
    rollTimer.current = window.setTimeout(
      () => setRoll(null),
      cfg.current.rollDuration
    )
  }

  const run = (nextLiked: boolean, nextCount: number) => {
    const root = rootRef.current
    const heart = heartRef.current
    const pill = pillRef.current
    if (!root || !heart || !pill) return

    root.dataset.running = ''
    let swapped = false
    let prev = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const { duration: D, dotSize: dot, overshoot: c, beat: B } = cfg.current
      const t = Math.min(1, (now - t0) / D)
      const step = prev ? now - prev : 1000 / 60
      prev = now
      const s = swellOf(t, c)
      const k = 1 - (1 - dot) * s
      heart.style.transform = `scale(${k})`
      pill.style.transform = `scale(${1 - (B / 100) * s})`
      if (!swapped && t + step / 2 / D >= OUT) {
        swapped = true
        root.dataset.liked = String(nextLiked)
        startRoll(shownRef.current.count, nextCount)
        shownRef.current = { liked: nextLiked, count: nextCount }
        setShown(shownRef.current)
      }
      if (t < 1) {
        raf.current = requestAnimationFrame(tick)
        return
      }
      raf.current = 0

      heart.style.transform = ''
      pill.style.transform = ''
      delete root.dataset.running
      const l = logical.current
      if (
        l.liked !== shownRef.current.liked ||
        l.count !== shownRef.current.count
      ) {
        shownRef.current = { liked: l.liked, count: l.count }
        setShown(shownRef.current)
      }
    }
    raf.current = requestAnimationFrame(tick)
  }

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled) return
    viaPointer.current = true
    if (!reducedMotion() && rootRef.current)
      rootRef.current.dataset.pressed = ''
  }
  const handlePointerUp = () => {
    if (rootRef.current) delete rootRef.current.dataset.pressed
  }
  const handlePointerCancel = () => {
    viaPointer.current = false
    handlePointerUp()
  }
  const handleKeyDown = () => {
    viaPointer.current = false
  }
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled || raf.current) return
    const pointer = viaPointer.current && e.detail !== 0
    viaPointer.current = false
    const nextLiked = !liked
    const nextCount = total + (nextLiked ? 1 : -1)
    if (!controlled) setInner(nextLiked)
    setTotal(nextCount)
    onChange?.(nextLiked, nextCount)
    if (pointer && !reducedMotion()) run(nextLiked, nextCount)
    else if (rootRef.current) rootRef.current.dataset.instant = ''
  }

  const text = format(shown.count)
  const cells = roll
    ? roll.at === -1
      ? [{ top: roll.up ? roll.a : roll.b, bottom: roll.up ? roll.b : roll.a }]
      : Array.from(roll.b).map((ch, i) =>
          i === roll.at
            ? {
                top: roll.up ? roll.a[i] : ch,
                bottom: roll.up ? ch : roll.a[i],
              }
            : { ch }
        )
    : Array.from(text).map((ch) => ({ ch }))

  return (
    <button
      ref={rootRef}
      type="button"
      aria-pressed={liked}
      disabled={disabled}
      data-liked={String(shown.liked)}
      data-solid={idleOutline ? undefined : ''}
      data-no-count={showCount ? undefined : ''}
      className={`${styles['pulse-heart']}${className ? ` ${className}` : ''}`}
      style={
        {
          '--ph-size': `${size}px`,
          '--ph-corner': `${corner}px`,
          '--ph-pill': pillColor,
          '--ph-idle': idleColor,
          '--ph-liked': likedColor,
          '--ph-text': textColor,
          '--ph-roll': `${rollDuration}ms`,
          '--ph-stroke': `${(1.5 * size) / 24}px`,
        } as CSSProperties
      }
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <span ref={pillRef} className={styles['pulse-heart__pill']}>
        <span
          ref={heartRef}
          className={styles['pulse-heart__heart']}
          aria-hidden="true"
        >
          {icon}
        </span>
        {showCount ? (
          <span className={styles['pulse-heart__count']} aria-hidden="true">
            {cells.map((cell, i) =>
              'ch' in cell ? (
                <span key={`c${i}`}>{cell.ch}</span>
              ) : (
                <span key={`r${i}`} className={styles['pulse-heart__slot']}>
                  <span ref={rollRef} className={styles['pulse-heart__roll']}>
                    <span>{cell.top}</span>
                    <span>{cell.bottom}</span>
                  </span>
                </span>
              )
            )}
          </span>
        ) : null}
        <span className={styles['pulse-heart__sr']}>
          {showCount ? `${label}, ${format(total)}` : label}
        </span>
      </span>
    </button>
  )
}

/* eslint-enable no-nested-ternary, react/no-array-index-key */

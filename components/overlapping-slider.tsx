'use client'

/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- The scrollable carousel region is keyboard focusable so arrow-key browsing remains available without separate navigation buttons. */

// Adapted from the user-provided useLayouts overlapping slider.
import { useIsPresent, useReducedMotion } from 'framer-motion'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

import styles from './overlapping-slider.module.css'

export function sliderStep(
  cardWidth: number,
  overlapFactor: number,
  cardGap: number
) {
  return Math.max(
    1,
    Math.round(cardWidth - cardWidth * overlapFactor + cardGap)
  )
}
export function snapSliderIndex(
  offsetX: number,
  step: number,
  velocity: number,
  total: number
) {
  if (total <= 1) return 0
  const index = -offsetX / step
  let snapped = Math.round(index)
  if (velocity < -350) snapped = Math.ceil(index)
  else if (velocity > 350) snapped = Math.floor(index)
  return Math.max(0, Math.min(snapped, total - 1))
}
export function cardLeave(diff: number) {
  const distance = Math.min(2, Math.abs(diff))
  return {
    scale: 1 - distance * 0.02,
    y: distance * 4,
    opacity: 1 - distance * 0.12,
  }
}

export function OverlappingSlider<T extends { id: string }>({
  items,
  renderItem,
  cardWidth = 340,
  overlapFactor = 0,
  cardGap,
  label = 'Recommended Shops',
  paused = false,
}: {
  items: readonly T[]
  renderItem: (item: T, index: number) => ReactNode
  cardWidth?: number
  overlapFactor?: number
  cardGap?: number
  label?: string
  paused?: boolean
}) {
  const reduced = useReducedMotion()
  const present = useIsPresent()
  const shellRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState({
    width: cardWidth,
    viewportWidth: cardWidth,
    bleed: 0,
    gap: 24,
  })
  const { width, viewportWidth, bleed, gap } = geometry
  const step = sliderStep(width, overlapFactor, cardGap ?? gap)
  const cycle = items.length * step
  const phase = useRef(Math.floor(items.length / 2) * step)
  const previousStep = useRef(step)
  const pauseUntil = useRef(0)
  const held = useRef(false)
  const keyboardFocus = useRef(false)
  const wake = useRef(() => {})
  const drag = useRef({ down: false, startX: 0, origin: 0, moved: 0 })
  // Five authoritative items; extra cycles are inert visual copies only when a
  // viewport is too wide for an offscreen circular seam. No duplicated state.
  const copies = viewportWidth > cycle - width ? [-1, 0, 1] : [0]
  const apply = useCallback(() => {
    const track = trackRef.current
    if (!track || !cycle) return
    phase.current = ((phase.current % cycle) + cycle) % cycle
    const active = Math.round(phase.current / step) % items.length
    track.dataset.phase = String(phase.current)
    track.dataset.cycle = String(cycle)
    for (const node of Array.from(track.children)) {
      const card = node as HTMLElement
      const index = Number(card.dataset.sliderIndex)
      const copy = Number(card.dataset.sliderCopy)
      const distance =
        ((index * step - phase.current + cycle * 1.5) % cycle) -
        cycle / 2 +
        copy * cycle
      const leave = cardLeave(distance / step)
      card.style.setProperty('--x', `${distance - index * step}px`)
      card.style.setProperty('--y', reduced ? '0px' : `${leave.y}px`)
      card.style.setProperty('--s', reduced ? '1' : String(leave.scale))
      card.style.opacity = String(leave.opacity)
      card.style.zIndex = String(
        items.length - Math.round(Math.abs(distance / step))
      )
      const focused = String(copy === 0 && index === active)
      if (card.dataset.active !== focused) card.dataset.active = focused
      const inner = card.firstElementChild as HTMLElement
      const visible =
        copy === 0 && Math.abs(distance) < (viewportWidth + width) / 2
      inner.toggleAttribute('inert', !visible)
      if (inner.getAttribute('aria-hidden') !== String(!visible))
        inner.setAttribute('aria-hidden', String(!visible))
    }
  }, [cycle, items.length, reduced, step, viewportWidth, width])

  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return undefined
    const measure = () => {
      if (!el.clientWidth || !el.getClientRects().length) return
      const rect = el.getBoundingClientRect()
      let translatedX = 0
      for (
        let ancestor = el.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const transform = getComputedStyle(ancestor).transform
        if (transform !== 'none')
          translatedX += new DOMMatrixReadOnly(transform).m41
      }
      const layoutLeft = rect.left - translatedX
      const screenWidth = document.documentElement.clientWidth
      const mobile = screenWidth < 640
      const available = Math.max(
        0,
        Math.min(layoutLeft, screenWidth - layoutLeft - rect.width) - 8
      )
      const nextBleed = Math.min(mobile ? 12 : 48, available)
      const nextViewportWidth = el.clientWidth + nextBleed * 2
      const next = {
        width: Math.max(
          1,
          Math.min(cardWidth, nextViewportWidth - (mobile ? 96 : 64))
        ),
        viewportWidth: nextViewportWidth,
        bleed: nextBleed,
        gap: mobile ? 24 : 28,
      }
      setGeometry((current) =>
        Object.keys(next).every(
          (key) =>
            current[key as keyof typeof next] === next[key as keyof typeof next]
        )
          ? current
          : next
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [cardWidth])
  useLayoutEffect(() => {
    phase.current *= step / previousStep.current
    previousStep.current = step
    apply()
  }, [apply, step])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = false
    let last = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      frame = 0
      last = 0
    }
    const blocked = () =>
      paused ||
      !present ||
      reduced ||
      !visible ||
      document.hidden ||
      held.current ||
      keyboardFocus.current
    const tick = (time: number) => {
      frame = 0
      if (blocked()) return
      if (last) {
        phase.current += (Math.max(0, Math.min(64, time - last)) * 24) / 1000
        apply()
      }
      last = time
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      stop()
      if (blocked()) return
      const delay = pauseUntil.current - performance.now()
      if (delay > 0) timer = setTimeout(start, delay)
      else frame = requestAnimationFrame(tick)
    }
    wake.current = start
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      start()
    })
    observer.observe(viewport)
    const releaseOutside = () => {
      if (!held.current) return
      held.current = false
      drag.current.down = false
      pauseUntil.current = performance.now() + 5000
      start()
    }
    const onVisibility = () => {
      if (document.hidden) releaseOutside()
      start()
    }
    document.addEventListener('pointerup', releaseOutside)
    document.addEventListener('pointercancel', releaseOutside)
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('pointerup', releaseOutside)
      document.removeEventListener('pointercancel', releaseOutside)
      wake.current = () => {}
    }
  }, [apply, paused, present, reduced])

  const pause = () => {
    pauseUntil.current = performance.now() + 5000
    wake.current()
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    held.current = true
    keyboardFocus.current = false
    wake.current()
    drag.current = {
      down: !(event.target as HTMLElement).closest('button,a,input'),
      startX: event.clientX,
      origin: phase.current,
      moved: 0,
    }
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current.down) return
    current.moved = Math.max(
      current.moved,
      Math.abs(event.clientX - current.startX)
    )
    if (current.moved < 6) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.setPointerCapture(event.pointerId)
    phase.current = current.origin - (event.clientX - current.startX)
    apply()
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!held.current) return
    held.current = false
    drag.current.down = false
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    pause()
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    keyboardFocus.current = true
    if (event.key === 'Home') phase.current = 0
    else if (event.key === 'End') phase.current = (items.length - 1) * step
    else phase.current += event.key === 'ArrowRight' ? step : -step
    apply()
    pause()
  }
  if (!items.length) return null
  return (
    <section
      ref={shellRef}
      data-overlapping-slider={true}
      className={styles.slider}
      aria-label={label}
      aria-roledescription="carousel"
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{ width: viewportWidth, marginInline: -bleed }}
        role="region"
        tabIndex={0}
        aria-label={`${label}: drag, swipe, or use left and right arrow keys`}
        onKeyDown={keyDown}
        onFocusCapture={(event) => {
          if (event.target.matches(':focus-visible')) {
            keyboardFocus.current = true
            wake.current()
          }
        }}
        onBlurCapture={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            keyboardFocus.current = false
            pause()
          }
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) pointerUp(event)
        }}
        onClickCapture={(event) => {
          if (drag.current.moved >= 6) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <div
          ref={trackRef}
          className={styles.track}
          style={{ paddingLeft: (viewportWidth - width) / 2 }}
        >
          {copies.flatMap((copy) =>
            items.map((item, index) => (
              <div
                key={`${item.id}:${copy}`}
                className={styles.card}
                style={{
                  width,
                  marginRight: (cardGap ?? gap) - width * overlapFactor,
                  position: copy !== 0 ? 'absolute' : undefined,
                  left:
                    copy !== 0
                      ? (viewportWidth - width) / 2 + index * step
                      : undefined,
                }}
                data-slider-index={index}
                data-slider-copy={copy}
              >
                <div
                  {...{ inert: copy !== 0 ? '' : undefined }}
                  aria-hidden={copy !== 0}
                >
                  {renderItem(item, index)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
export default OverlappingSlider

/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */

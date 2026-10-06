'use client'

/* eslint-disable no-bitwise -- Preserve Velora's hover/focus pause bitmask. */

import cn from 'classnames'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

import styles from './image-slider.module.css'

const noopSubscribe = () => () => {}
function Icon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d={d} />
    </svg>
  )
}

export interface SliderImage {
  src: string
  alt: string
}
interface ImageSliderProps extends HTMLAttributes<HTMLElement> {
  images: SliderImage[]
  children?: ReactNode
  autoplay?: boolean
  interval?: number
  scrim?: boolean
  label?: string
  playbackControls?: boolean
  activeIndex?: number
  onIndexChange?: (index: number) => void
}

/** Supplied Velora Image Slider, ported to CSS Modules. Shared index preserves.
 * the selected photo through the existing source/expanded/returning media slots. */
export function ImageSlider({
  images,
  children,
  autoplay = true,
  interval = 5000,
  scrim = true,
  label = 'Image slider',
  className,
  playbackControls = true,
  activeIndex,
  onIndexChange,
  ...props
}: ImageSliderProps) {
  const ref = useRef<HTMLElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const reduced = Boolean(useReducedMotion()) && hydrated
  const [innerIndex, setInnerIndex] = useState(0)
  const [choice, setChoice] = useState<boolean | null>(null)
  const [held, setHeld] = useState(0)
  const [visible, setVisible] = useState(true)
  const n = images.length
  const index = Math.min(activeIndex ?? innerIndex, Math.max(0, n - 1))
  const playing = choice ?? (autoplay && !reduced)
  const running = playing && !held && visible && n > 1
  const setIndex = (next: number) => {
    setInnerIndex(next)
    onIndexChange?.(next)
  }
  const go = (delta: number) => {
    if (n) setIndex((index + delta + n) % n)
  }
  useEffect(() => {
    let inView = true
    const update = () => setVisible(inView && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      update()
    })
    if (ref.current) observer.observe(ref.current)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  useEffect(() => {
    if (!running) return undefined
    const timer = setTimeout(() => {
      const next = (index + 1) % n
      setInnerIndex(next)
      onIndexChange?.(next)
    }, interval)
    return () => clearTimeout(timer)
  }, [running, index, interval, n, onIndexChange])
  useEffect(() => {
    if (n > 1) new Image().src = images[(index + 1) % n].src
  }, [index, images, n])
  const image = images[index]
  return (
    <section
      {...props}
      ref={ref}
      aria-roledescription="carousel"
      aria-label={label}
      data-slot="image-slider"
      className={cn(styles.slider, className)}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      {/* This display:contents layer delegates interaction to the native controls. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={styles.contents}
        onMouseEnter={() => setHeld((value) => value | 1)}
        onMouseLeave={() => setHeld((value) => value & 2)}
        onFocus={() => setHeld((value) => value | 2)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setHeld((value) => value & 1)
        }}
        onKeyDown={(event) => {
          const key = ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(
            event.key
          )
          if (
            n < 2 ||
            key < 0 ||
            (event.target as HTMLElement).matches('input,textarea,select')
          )
            return
          event.preventDefault()
          event.stopPropagation()
          if (key < 2) go(key * 2 - 1)
          else setIndex(key > 2 ? n - 1 : 0)
        }}
        onPointerDown={(event) => {
          suppressClick.current = false
          if (
            event.pointerType !== 'mouse' &&
            !(event.target as HTMLElement).closest('button')
          )
            start.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerCancel={() => {
          start.current = null
        }}
        onPointerUp={(event) => {
          const origin = start.current
          start.current = null
          if (!origin) return
          const dx = event.clientX - origin.x
          const dy = event.clientY - origin.y
          if (n > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            suppressClick.current = true
            go(dx < 0 ? 1 : -1)
          }
        }}
      >
        {n > 1 && playbackControls && (
          <button
            type="button"
            aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
            className={cn(styles.button, styles.play)}
            onClick={(event) => {
              event.stopPropagation()
              setChoice(!playing)
            }}
          >
            <Icon d={playing ? 'M9 5v14M15 5v14' : 'M7 4.5v15L19.5 12Z'} />
          </button>
        )}
        <div aria-live={running ? 'off' : 'polite'} className={styles.slides}>
          <AnimatePresence initial={false}>
            {image && (
              <motion.div
                key={`${index}-${image.src}`}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${n}`}
                initial={{ opacity: 0, scale: 1.08 }}
                animate={{ opacity: 1, scale: 1, zIndex: 1 }}
                exit={{
                  opacity: 0,
                  zIndex: 0,
                  transition: { duration: 0, delay: reduced ? 0 : 0.9 },
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        duration: 0.9,
                        ease: 'easeOut',
                        scale: { duration: 1.8, ease: [0.2, 0.7, 0.2, 1] },
                      }
                }
                className={styles.slide}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Local object URLs and immutable listing photos. */}
                <img src={image.src} alt={image.alt} draggable={false} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {scrim && <div aria-hidden="true" className={styles.scrim} />}
        <div className={styles.children}>{children}</div>
        {n > 1 && (
          <>
            {[-1, 1].map((direction) => (
              <button
                key={direction}
                type="button"
                aria-label={direction < 0 ? 'Previous slide' : 'Next slide'}
                className={cn(
                  styles.button,
                  styles.arrow,
                  direction < 0 ? styles.previous : styles.next
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  go(direction)
                }}
              >
                <Icon d={direction < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
              </button>
            ))}
            <div className={styles.dots}>
              {images.map((_, i) => (
                <button
                  // eslint-disable-next-line react/no-array-index-key -- Immutable photo slots; duplicate URLs are allowed.
                  key={`${i}-${images[i].src}`}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index || undefined}
                  className={styles.dot}
                  onClick={(event) => {
                    event.stopPropagation()
                    setIndex(i)
                  }}
                >
                  <span />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/* eslint-enable no-bitwise */

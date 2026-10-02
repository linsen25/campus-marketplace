'use client'

import cn from 'classnames'
import type { MotionValue } from 'motion/react'
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react'
import { useRef } from 'react'

import styles from './hero-parallax.module.css'

export interface HeroParallaxProduct {
  /* Caption on the card; also the link's accessible name */
  title: string
  /* Image URL, shown with empty alt text since the title labels it */
  image: string
  /* Turns the card into a link */
  href?: string
}

interface HeroParallaxProps extends React.HTMLAttributes<HTMLDivElement> {
  /* Cards, split evenly across three rows */
  products: HeroParallaxProduct[]
  /* Hero copy shown above the rows */
  children?: React.ReactNode
  /* How far each row slides sideways over the scroll, in px */
  drift?: number
  /* Extra classes for every card, e.g. to resize them */
  cardClassName?: string
  /* Scrollable element to track instead of the window */
  container?: React.RefObject<HTMLElement>
  /* Full-width hero layouts can provide their own copy spacing */
  copyClassName?: string
}

/*
 * Hero copy over three rows of cards that slide in opposite directions
 * while the whole block tilts from a 3D angle into flat as you scroll.
 * Spacing uses viewport units. Under `prefers-reduced-motion` the block
 * stays flat and the rows wrap so every card is visible.
 */
export function HeroParallax({
  products,
  children,
  drift = 480,
  cardClassName,
  container,
  copyClassName,
  className,
  ...props
}: HeroParallaxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    container,
    target: ref,
    offset: ['start start', 'end start'],
  })
  const progress = useSpring(scrollYProgress, { stiffness: 260, damping: 40 })

  const rotateX = useTransform(progress, [0, 0.22], [18, 0])
  const rotateZ = useTransform(progress, [0, 0.22], [12, 0])
  const y = useTransform(progress, [0, 0.22], [60, 0])
  const opacity = useTransform(progress, [0, 0.22], [0.5, 1])
  const right = useTransform(progress, [0, 1], [0, drift])
  const left = useTransform(progress, [0, 1], [0, -drift])

  const size = Math.ceil(products.length / 3)
  const rows = [0, 1, 2].map((i) => products.slice(i * size, (i + 1) * size))

  return (
    <div
      ref={ref}
      data-slot="hero-parallax"
      className={cn(styles.root, className)}
      {...props}
    >
      {children && (
        <div className={cn(styles.copy, copyClassName)}>{children}</div>
      )}
      <motion.div
        style={{ rotateX, rotateZ, y, opacity, transformPerspective: 1000 }}
        className={styles.plane}
      >
        {rows.map((row, i) => (
          <Row
            key={i}
            items={row}
            x={i === 1 ? left : right}
            root={ref}
            cardClassName={cardClassName}
          />
        ))}
      </motion.div>
    </div>
  )
}

function Row({
  items,
  x,
  root,
  cardClassName,
}: {
  items: HeroParallaxProduct[]
  x: MotionValue<number>
  root: React.RefObject<HTMLDivElement>
  cardClassName?: string
}) {
  // Extra offset that slides a keyboard-focused card back inside the clip.
  const nudge = useMotionValue(0)
  const shifted = useTransform(() => x.get() + nudge.get())

  const reveal = (event: React.FocusEvent) => {
    const box = root.current?.getBoundingClientRect()
    const card = (event.target as Element).getBoundingClientRect()
    if (!box) return
    const gap = 24
    if (card.left < box.left)
      nudge.set(nudge.get() + box.left - card.left + gap)
    else if (card.right > box.right)
      nudge.set(nudge.get() + box.right - card.right - gap)
  }

  if (!items.length) return null

  return (
    <motion.ul
      role="list"
      style={{ x: shifted }}
      className={styles.row}
      onFocus={reveal}
      onBlur={(e: React.FocusEvent<HTMLUListElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) nudge.set(0)
      }}
    >
      {items.map((item, i) => {
        const Tag = item.href ? 'a' : 'div'
        return (
          <li key={`${item.title}-${i}`} className={styles.item}>
            <Tag
              href={item.href}
              className={cn(
                styles.card,

                cardClassName
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt=""
                loading="lazy"
                className={styles.image}
              />
              <span className={styles.caption}>{item.title}</span>
            </Tag>
          </li>
        )
      })}
    </motion.ul>
  )
}

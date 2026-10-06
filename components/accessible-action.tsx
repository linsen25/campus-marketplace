/* eslint no-bitwise: off, no-nested-ternary: off, no-eq-null: off, eqeqeq: off, react/function-component-definition: off -- Preserve supplied deterministic rotations, sizing and motion structure. */
/* eslint @next/next/no-img-element: off -- Local selected-photo object URLs. */
'use client'

import cn from 'classnames'
import type { PanInfo } from 'framer-motion'
import { m as motion, useMotionValue, useTransform } from 'framer-motion'
import React, { useState, useEffect, useMemo } from 'react'

import styles from './accessible-action.module.css'

export interface CardStackItem {
  id?: number | string
  color?: string
  bg?: string
  image?: string
  content?: React.ReactNode
}

export interface CardStackProps extends React.HTMLAttributes<HTMLDivElement> {
  items?: CardStackItem[]
  cardWidth?: number | string
  cardHeight?: number | string
  sensitivity?: number
  randomRotation?: boolean
  sendToBackOnClick?: boolean
  maxVisible?: number
  cardClassName?: string
  activeIndex?: number
  disabled?: boolean
  onSwipe?: (item: CardStackItem, index: number) => void
}

const EMPTY_CARDS: CardStackItem[] = []

function getDeterministicRotation(index: number, id?: number | string): number {
  if (typeof id === 'string') {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i)
      hash |= 0
    }
    return (Math.abs(hash) % 1000) / 100 - 5
  }
  if (typeof id === 'number') {
    return (Math.abs(id * 9301 + 49297) % 1000) / 100 - 5
  }
  const presets = [2.66, -1.05, -2.8, 1.93, -0.59, 3.12, -2.4]
  return presets[index % presets.length]
}

interface DraggableCardWrapperProps {
  children: React.ReactNode
  onSendToBack: () => void
  sensitivity: number
}

const DraggableCardWrapper: React.FC<DraggableCardWrapperProps> = ({
  children,
  onSendToBack,
  sensitivity,
}) => {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-100, 100], [60, -60])
  const rotateY = useTransform(x, [-100, 100], [-60, 60])

  const handleDragEnd = (
    _: MouseEvent | PointerEvent | TouchEvent,
    info: PanInfo
  ) => {
    if (
      Math.abs(info.offset.x) > sensitivity ||
      Math.abs(info.offset.y) > sensitivity
    ) {
      onSendToBack()
    } else {
      x.set(0)
      y.set(0)
    }
  }

  return (
    <motion.div
      drag={true}
      className={styles.draggable}
      style={{
        x,
        y,
        rotateX,
        rotateY,
      }}
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragElastic={0.6}
      whileTap={{ cursor: 'grabbing' }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </motion.div>
  )
}

export const CardStack = React.forwardRef<HTMLDivElement, CardStackProps>(
  (
    {
      items = EMPTY_CARDS,
      cardWidth,
      cardHeight,
      sensitivity = 180,
      randomRotation = true,
      sendToBackOnClick = true,
      maxVisible = 5,
      cardClassName,
      className,
      onSwipe,
      activeIndex,
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [deck, setDeck] = useState<CardStackItem[]>(items)

    useEffect(() => {
      setDeck(items)
    }, [items])

    const rotationOffsets = useMemo(() => {
      return items.map((item, index) =>
        randomRotation ? getDeterministicRotation(index, item.id) : 0
      )
    }, [items, randomRotation])

    const sendToBack = (index: number) => {
      const swipedItem = deck[index]
      onSwipe?.(swipedItem, index)

      setDeck((currentDeck) => {
        const nextDeck = [...currentDeck]
        const [removed] = nextDeck.splice(index, 1)
        nextDeck.unshift(removed)
        return nextDeck
      })
    }

    const presentation = activeIndex !== undefined
    const ordered = presentation
      ? [
          ...items.filter((_, index) => index !== activeIndex),
          ...(items[activeIndex] ? [items[activeIndex]] : []),
        ]
      : deck
    const visibleDeck = ordered.slice(-maxVisible)
    const width =
      cardWidth == null
        ? undefined
        : typeof cardWidth === 'number'
        ? `${cardWidth}px`
        : cardWidth
    const height =
      cardHeight == null
        ? undefined
        : typeof cardHeight === 'number'
        ? `${cardHeight}px`
        : cardHeight

    return (
      <div
        ref={ref}
        className={cn(styles.stack, className)}
        style={{
          ...(width ? { width } : {}),
          ...(height ? { height } : width ? { height: width } : {}),
        }}
        {...props}
      >
        {visibleDeck.map((item, index) => {
          const offset = rotationOffsets[index] ?? 0
          const rotateZ = (visibleDeck.length - index - 1) * 4 + offset
          const scale = 1 + index * 0.06 - visibleDeck.length * 0.06
          const cardBg = item.color || item.bg || '#000000'

          return (
            <DraggableCardWrapper
              key={item.id || index}
              sensitivity={sensitivity}
              onSendToBack={() => {
                if (!presentation && !disabled) sendToBack(index)
              }}
            >
              <motion.div
                aria-hidden={index !== visibleDeck.length - 1 || undefined}
                data-active-photo={
                  index === visibleDeck.length - 1 || undefined
                }
                animate={{
                  rotateZ,
                  scale,
                  transformOrigin: '90% 90%',
                }}
                initial={false}
                transition={{
                  type: 'spring',
                  stiffness: 260,
                  damping: 20,
                }}
                style={{ background: cardBg }}
                className={cn(styles.card, cardClassName)}
                onClick={() => {
                  if (!presentation && !disabled && sendToBackOnClick) {
                    sendToBack(index)
                  }
                }}
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt={
                      index === visibleDeck.length - 1
                        ? `Selected photo ${(activeIndex ?? index) + 1}`
                        : ''
                    }
                    draggable={false}
                    className={styles.image}
                  />
                ) : item.content ? (
                  item.content
                ) : null}
              </motion.div>
            </DraggableCardWrapper>
          )
        })}
      </div>
    )
  }
)

CardStack.displayName = 'CardStack'

/** Supplied docs/CLI alias: AccessibleAction uses this same implementation. */
export const AccessibleAction = CardStack

export default AccessibleAction

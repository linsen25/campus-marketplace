'use client'
// Adapted from the supplied Magic UI Number Ticker; no competing animation system.
import cn from 'classnames'
import {
  useInView,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from 'motion/react'
import { useEffect, useRef } from 'react'
import type { ComponentPropsWithoutRef } from 'react'

import styles from './analytics-primitives.module.css'

export interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  direction?: 'down' | 'up'
  delay?: number
  decimalPlaces?: number
}
export function NumberTicker({
  value,
  startValue = 0,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(direction === 'down' ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: '0px' })
  const reduced = useReducedMotion()
  const format = (n: number) =>
    new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(n.toFixed(decimalPlaces)))
  useEffect(() => {
    if (reduced) {
      motionValue.jump(direction === 'down' ? startValue : value)
      return undefined
    }
    if (!isInView) return undefined
    const timer = setTimeout(
      () => motionValue.set(direction === 'down' ? startValue : value),
      delay * 1000
    )
    return () => clearTimeout(timer)
  }, [motionValue, isInView, delay, value, direction, startValue, reduced])
  useEffect(() => {
    const write = (latest: number) => {
      if (ref.current)
        ref.current.textContent = new Intl.NumberFormat('en-CA', {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces)))
    }
    if (reduced) {
      write(direction === 'down' ? startValue : value)
      return undefined
    }
    return springValue.on('change', write)
  }, [springValue, decimalPlaces, reduced, direction, startValue, value])
  return (
    <span
      ref={ref}
      className={cn(styles.ticker, className)}
      aria-label={format(direction === 'down' ? startValue : value)}
      {...props}
    >
      {format(reduced ? value : startValue)}
    </span>
  )
}

'use client'
// Supplied shadcn/Radix Progress structure, adapted to CSS Modules.
import cn from 'classnames'
import { Progress as ProgressPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import styles from './analytics-primitives.module.css'

export function Progress({
  className,
  value = 0,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const clamped = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? Number(value) : 0)
  )
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(styles.progress, className)}
      value={clamped}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={styles.indicator}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

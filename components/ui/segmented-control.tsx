import { m, useReducedMotion } from 'framer-motion'

import styles from './segmented-control.module.css'

export type SegmentedControlItem<T extends string> = {
  value: T
  label: string
  count?: number
  disabled?: boolean
}

/**
 * A two-way, fixed-width segmented control. The indicator is one persistent
 * element so changing tabs never swaps two independent button backgrounds.
 */
export function SegmentedControl<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: T
  items: readonly SegmentedControlItem<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  const reducedMotion = useReducedMotion()
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  )
  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      role="group"
      aria-label={ariaLabel}
    >
      <m.span
        aria-hidden="true"
        className={styles.indicator}
        initial={false}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={{
          duration: reducedMotion ? 0 : 0.24,
          ease: [0.22, 1, 0.36, 1],
        }}
      />
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled || item.disabled}
            onClick={() => {
              if (!selected) onChange(item.value)
            }}
          >
            <span className={styles.label}>{item.label}</span>
            {item.count && item.count > 0 ? (
              <span className={styles.count}>{item.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

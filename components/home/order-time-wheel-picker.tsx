import { WheelPicker, WheelPickerWrapper } from '@ncdai/react-wheel-picker'
import type { WheelPickerOption } from '@ncdai/react-wheel-picker'
import { Clock } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import {
  formatScheduleTime,
  ORDER_SCHEDULE_STEP_MINUTES,
  seedOrderTimeWheel,
  to24HourTime,
  validateNewOrderSchedule,
} from '@/lib/order-schedule-preview'
import type { Meridiem } from '@/lib/order-schedule-preview'

import workspace from '../listings/listing-workspace.module.css'

import styles from './order-time-wheel-picker.module.css'
import profile from './profile.module.css'

const hours: Array<WheelPickerOption<number>> = Array.from(
  { length: 12 },
  (_, index) => ({ value: index + 1, label: String(index + 1) })
)
const minutes: Array<WheelPickerOption<number>> = Array.from(
  { length: 60 / ORDER_SCHEDULE_STEP_MINUTES },
  (_, index) => ({
    value: index * ORDER_SCHEDULE_STEP_MINUTES,
    label: String(index * ORDER_SCHEDULE_STEP_MINUTES).padStart(2, '0'),
  })
)
const meridiems: Array<WheelPickerOption<Meridiem>> = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
]
const wheelClasses = {
  optionItem: styles.optionItem,
  highlightWrapper: styles.highlightWrapper,
  highlightItem: styles.highlightItem,
}
type PopoverElement = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

/** Temporary wheel state only; the existing schedule draft commits on validated Done. */
export function OrderTimeWheelPicker({
  value,
  selectedDate,
  onChange,
}: {
  value: string
  selectedDate?: Date
  onChange: (value: string) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<PopoverElement>(null)
  const [draft, setDraft] = useState<ReturnType<
    typeof seedOrderTimeWheel
  > | null>(null)
  const [error, setError] = useState('')
  // v1.2.3 derives keyboard handlers from options identity. Refresh only the
  // changed controlled column so returning to its initial value uses current callbacks.
  const hourOptions = useMemo(
    () => hours.map((option) => ({ ...option })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This dependency deliberately refreshes the v1.2.3 controlled keyboard callback.
    [draft?.hour]
  )
  const minuteOptions = useMemo(
    () => minutes.map((option) => ({ ...option })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This dependency deliberately refreshes the v1.2.3 controlled keyboard callback.
    [draft?.minute]
  )
  const meridiemOptions = useMemo(
    () => meridiems.map((option) => ({ ...option })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This dependency deliberately refreshes the v1.2.3 controlled keyboard callback.
    [draft?.meridiem]
  )
  const open = draft !== null
  const close = () => {
    setDraft(null)
    trigger.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!open) return undefined
    const node = panel.current
    const position = () => {
      const box = trigger.current?.getBoundingClientRect()
      if (!node || !box) return
      const height = node.getBoundingClientRect().height
      node.style.left = `${Math.max(
        16,
        Math.min(box.left, innerWidth - node.offsetWidth - 16)
      )}px`
      node.style.top = `${Math.max(
        16,
        box.bottom + height + 8 < innerHeight
          ? box.bottom + 8
          : box.top - height - 8
      )}px`
    }
    node?.showPopover?.()
    position()
    node
      ?.querySelector<HTMLElement>('[data-rwp]')
      ?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (
        !node?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setDraft(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setDraft(null)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      node?.hidePopover?.()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [open])
  const change = (next: Partial<NonNullable<typeof draft>>) => {
    setDraft((current) => current && { ...current, ...next })
    setError('')
  }
  // Independent disabled wheels can auto-skip the existing selection in this primitive.
  // Preserve it instead and use the centralized validator at Done (and Confirm & Send).
  const done = () => {
    if (!draft) return
    const time = to24HourTime(draft.hour, draft.minute, draft.meridiem)
    if (selectedDate) {
      const result = validateNewOrderSchedule(
        { mode: 'scheduled', date: selectedDate, time },
        new Date()
      )
      if (!result.valid) {
        setError(result.message)
        return
      }
    }
    onChange(time)
    close()
  }
  return (
    <div className={workspace.field}>
      <span id={`${id}-label`}>Time</span>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-labelledby={`${id}-label ${id}-value`}
        data-time-value={value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) close()
          else {
            setError('')
            setDraft(seedOrderTimeWheel(value, selectedDate))
          }
        }}
      >
        <span id={`${id}-value`}>{formatScheduleTime(value)}</span>
        <Clock size={18} aria-hidden="true" />
      </button>
      {draft && (
        <div
          ref={panel}
          id={id}
          {...{ popover: 'manual' }}
          className={styles.panel}
          role="dialog"
          aria-label="Choose time"
        >
          <WheelPickerWrapper className={styles.wheels}>
            <div role="group" aria-label="Hour" data-wheel-value={draft.hour}>
              <WheelPicker
                options={hourOptions}
                value={draft.hour}
                infinite={true}
                visibleCount={12}
                optionItemHeight={32}
                classNames={wheelClasses}
                onValueChange={(hour) => change({ hour })}
              />
            </div>
            <div
              role="group"
              aria-label="Minute"
              data-wheel-value={draft.minute}
            >
              <WheelPicker
                options={minuteOptions}
                value={draft.minute}
                infinite={true}
                visibleCount={12}
                optionItemHeight={32}
                classNames={wheelClasses}
                onValueChange={(minute) => change({ minute })}
              />
            </div>
            <div
              role="group"
              aria-label="AM / PM"
              data-wheel-value={draft.meridiem}
            >
              <WheelPicker
                options={meridiemOptions}
                value={draft.meridiem}
                visibleCount={12}
                optionItemHeight={32}
                classNames={wheelClasses}
                onValueChange={(meridiem) => change({ meridiem })}
              />
            </div>
          </WheelPickerWrapper>
          <p className={styles.hint}>
            Scroll or drag. Arrow keys select; left/right changes column.
          </p>
          {error && (
            <p className={profile.error} role="alert">
              {error}
            </p>
          )}
          <ActionRow>
            <CardAction
              className={workspace.neutralButton}
              surfaceClassName={workspace.neutralSurface}
              onClick={close}
            >
              Cancel
            </CardAction>
            <CardAction variant="blue" onClick={done}>
              Done
            </CardAction>
          </ActionRow>
        </div>
      )}
    </div>
  )
}

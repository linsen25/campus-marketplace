import { DayPicker } from '@daypicker/react'
import { CalendarDays } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import {
  addLocalDays,
  formatScheduleDate,
  getEarliestOrderSchedule,
  ORDER_SCHEDULE_MAX_DAYS,
  startOfLocalDay,
} from '@/lib/order-schedule-preview'
import type { ScheduleDraft } from '@/lib/order-schedule-preview'

import workspace from '../listings/listing-workspace.module.css'

import styles from './order-schedule-field.module.css'
import { OrderTimeWheelPicker } from './order-time-wheel-picker'

type PopoverElement = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
export function OrderScheduleField({
  value,
  onChange,
  now,
}: {
  value: ScheduleDraft
  onChange: (value: ScheduleDraft) => void
  now: Date
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<PopoverElement>(null)
  const id = useId()
  const close = () => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!open) return undefined
    const node = panel.current
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!node || !rect) return
      const height = node.getBoundingClientRect().height
      node.style.left = `${Math.max(
        16,
        Math.min(rect.left, innerWidth - node.offsetWidth - 16)
      )}px`
      node.style.top = `${Math.max(
        16,
        rect.bottom + height + 8 < innerHeight
          ? rect.bottom + 8
          : rect.top - height - 8
      )}px`
    }
    node?.showPopover?.()
    position()
    // DayPicker mounts while the native popover is hidden; focus its roving-tabindex
    // day only after promotion to the top layer so arrow navigation starts there.
    node
      ?.querySelector<HTMLButtonElement>('[tabindex="0"]:not(:disabled)')
      ?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (
        !node?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => {
      node?.hidePopover?.()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
    }
  }, [open])
  useEffect(() => setOpen(false), [value.mode])
  const today = startOfLocalDay(now)
  const latest = addLocalDays(today, ORDER_SCHEDULE_MAX_DAYS)
  const earliest = getEarliestOrderSchedule(now)
  return (
    <div className={workspace.field}>
      <div className={workspace.field}>
        <span id={`${id}-label`}>Date</span>
        <button
          ref={trigger}
          type="button"
          className={styles.dateTrigger}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
        >
          <span id={`${id}-value`}>{formatScheduleDate(value.date)}</span>
          <CalendarDays size={18} aria-hidden="true" />
        </button>
        {open && (
          <div
            ref={panel}
            id={id}
            {...{ popover: 'manual' }}
            role="dialog"
            aria-label="Schedule calendar"
            className={styles.calendar}
          >
            <DayPicker
              animate={true}
              autoFocus={true}
              mode="single"
              numberOfMonths={1}
              selected={value.date}
              defaultMonth={value.date || today}
              today={today}
              disabled={[
                { before: today },
                { after: latest },
                (date) =>
                  startOfLocalDay(date).getTime() === today.getTime() &&
                  startOfLocalDay(earliest).getTime() > today.getTime(),
              ]}
              onSelect={(date) => {
                if (!date) return
                onChange({ ...value, date })
                close()
              }}
            />
          </div>
        )}
      </div>
      <OrderTimeWheelPicker
        value={value.time}
        selectedDate={value.date}
        onChange={(time) => onChange({ ...value, time })}
      />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import { sortPanelFade } from '@/lib/sort-panel-fade'

export function NotificationFilter({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const onOpenChange = useCallback((next: boolean) => {
    clearTimeout(timer.current)
    if (next) {
      setClosing(false)
      setOpen(true)
    } else {
      setClosing(true)
      timer.current = setTimeout(() => {
        setOpen(false)
        setClosing(false)
      }, sortPanelFade.duration * 1000)
    }
  }, [])
  return (
    <FilterInteraction
      label={label}
      options={options}
      value={value}
      disabled={disabled}
      appearance="notification"
      isOpen={open}
      isClosing={closing}
      onChange={onChange}
      onOpenChange={onOpenChange}
    />
  )
}

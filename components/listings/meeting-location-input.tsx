import { useEffect, useId, useRef, useState } from 'react'

import type {
  MeetingPlaceReference,
  PlaceDetails,
  PlaceSuggestion,
} from '@/types/meeting-location'

import workspace from './listing-workspace.module.css'
import styles from './meeting-location-input.module.css'

type Panel = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
async function places<T>(
  action: string,
  body: unknown,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`/api/places/${action}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Marketplace-Request': '1',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok)
    throw new Error(
      'Location search unavailable. You can enter a location manually.'
    )
  return response.json()
}
/** Controlled free text with optional place suggestions; submitted text owns transaction wording. */
export function MeetingLocationInput({
  value,
  selected,
  onChange,
  onSelect,
  disabled = false,
  error,
  label = 'Meeting location',
  helper,
  required = false,
}: {
  value: string
  selected?: MeetingPlaceReference | null
  onChange: (value: string) => void
  onSelect: (place: PlaceDetails | null) => void
  disabled?: boolean
  error?: string
  label?: string
  helper?: string
  required?: boolean
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<Panel>(null)
  const token = useRef<string>()
  const generation = useRef(0)
  const request = useRef<AbortController>()
  const [query, setQuery] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [active, setActive] = useState(-1)
  const dismiss = () => {
    generation.current++
    request.current?.abort()
    token.current = undefined
    setQuery(null)
    setOpen(false)
    setLoading(false)
  }
  useEffect(() => {
    if (query === null || query !== value || disabled) return undefined
    const version = ++generation.current
    request.current?.abort()
    setSuggestions([])
    setFeedback('')
    setActive(-1)
    if (query.trim().length < 2) {
      token.current = undefined
      setLoading(false)
      setOpen(false)
      return undefined
    }
    setLoading(true)
    setOpen(true)
    const timer = setTimeout(async () => {
      const controller = new AbortController()
      request.current = controller
      if (!token.current) token.current = crypto.randomUUID()
      try {
        const data = await places<{ suggestions: PlaceSuggestion[] }>(
          'autocomplete',
          { input: query.trim(), sessionToken: token.current },
          controller.signal
        )
        if (version !== generation.current) return
        setSuggestions(data.suggestions)
        setFeedback(
          data.suggestions.length
            ? ''
            : 'No suggestions. You can enter a location manually.'
        )
      } catch {
        if (version === generation.current)
          setFeedback(
            'Location search unavailable. You can enter a location manually.'
          )
      } finally {
        if (version === generation.current) setLoading(false)
      }
    }, 275)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate async generations, not a DOM ref.
      generation.current++
      clearTimeout(timer)
      request.current?.abort()
    }
  }, [query, value, disabled])
  useEffect(
    () => () => {
      generation.current++
      request.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (!open || disabled) return undefined
    const node = panel.current
    const position = () => {
      if (!node || !input.current) return
      const r = input.current.getBoundingClientRect()
      const viewport = window.visualViewport
      const top = viewport?.offsetTop || 0
      const height = viewport?.height || innerHeight
      const below = top + height - r.bottom - 12
      const above = r.top - top - 12
      const flip = below < 160 && above > below
      const available = Math.max(44, Math.min(280, flip ? above : below))
      node.style.width = `${Math.min(r.width, innerWidth - 32)}px`
      node.style.left = `${Math.max(
        16,
        Math.min(r.left, innerWidth - node.offsetWidth - 16)
      )}px`
      node.style.maxHeight = `${available}px`
      node.style.top = `${
        flip ? Math.max(top + 8, r.top - node.offsetHeight - 4) : r.bottom + 4
      }px`
    }
    node?.showPopover?.()
    position()
    const outside = (e: PointerEvent) => {
      if (!node?.contains(e.target as Node) && e.target !== input.current)
        dismiss()
    }
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    document.addEventListener('pointerdown', outside)
    return () => {
      node?.hidePopover?.()
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, disabled, suggestions, feedback, loading])
  useEffect(() => {
    const node = panel.current
    const option = node?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!node || !option) return
    const bounds = node.getBoundingClientRect()
    const row = option.getBoundingClientRect()
    if (row.bottom > bounds.bottom) node.scrollTop += row.bottom - bounds.bottom
    if (row.top < bounds.top) node.scrollTop -= bounds.top - row.top
  }, [active])
  const choose = async (suggestion: PlaceSuggestion) => {
    const sessionToken = token.current
    if (!sessionToken || disabled) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const version = ++generation.current
    setLoading(true)
    setSuggestions([])
    setActive(-1)
    try {
      const place = await places<PlaceDetails>(
        'details',
        { placeId: suggestion.placeId, sessionToken },
        controller.signal
      )
      if (version !== generation.current) return
      token.current = undefined
      setQuery(null)
      setOpen(false)
      setFeedback('')
      onChange(
        suggestion.primaryText || place.displayName || suggestion.displayText
      )
      onSelect(place)
    } catch {
      if (version === generation.current)
        setFeedback(
          'Location search unavailable. You can enter a location manually.'
        )
    } finally {
      if (version === generation.current) {
        setLoading(false)
        token.current = undefined
      }
    }
  }
  const hint = error || feedback || helper
  return (
    <div className={`${workspace.field} ${styles.root}`}>
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !disabled}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={
          open && active >= 0 ? `${id}-${active}` : undefined
        }
        aria-describedby={hint ? `${id}-feedback` : undefined}
        aria-invalid={Boolean(error)}
        aria-busy={loading || undefined}
        autoComplete="off"
        maxLength={120}
        required={required}
        disabled={disabled}
        value={value}
        onBlur={dismiss}
        onChange={(e) => {
          generation.current++
          request.current?.abort()
          onChange(e.target.value)
          if (selected) onSelect(null)
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Tab') {
            if (e.key === 'Escape' && open) {
              e.preventDefault()
              e.stopPropagation()
            }
            dismiss()
            return
          }
          if (
            open &&
            suggestions.length &&
            ['ArrowDown', 'ArrowUp'].includes(e.key)
          ) {
            e.preventDefault()
            setActive((i) => {
              if (e.key === 'ArrowDown') return (i + 1) % suggestions.length
              return i <= 0 ? suggestions.length - 1 : i - 1
            })
          }
          if (e.key === 'Enter' && open && active >= 0 && suggestions[active]) {
            e.preventDefault()
            choose(suggestions[active])
          }
        }}
      />
      {hint && (
        <p
          id={`${id}-feedback`}
          className={styles.feedback}
          role={error ? 'alert' : 'status'}
        >
          {hint}
        </p>
      )}
      {open && !disabled && (
        <div ref={panel} {...{ popover: 'manual' }} className={styles.panel}>
          {loading && (
            <p className={styles.feedback} role="status">
              Searching locations…
            </p>
          )}
          <div
            role="listbox"
            id={`${id}-list`}
            aria-label="Meeting location suggestions"
            aria-busy={loading}
          >
            {suggestions.map((s, i) => (
              <button
                type="button"
                role="option"
                id={`${id}-${i}`}
                key={s.placeId}
                aria-selected={active === i}
                data-active={active === i}
                className={styles.option}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
              >
                <span>{s.primaryText}</span>
                {s.secondaryText && <small>{s.secondaryText}</small>}
              </button>
            ))}
          </div>
          {suggestions.length > 0 && (
            <p className={styles.attribution} translate="no">
              Google Maps
            </p>
          )}
        </div>
      )}
    </div>
  )
}

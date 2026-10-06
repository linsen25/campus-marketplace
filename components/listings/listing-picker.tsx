/* eslint jsx-a11y/no-onchange: off -- Native desktop select updates only its form value without navigation. */
import { useId, useRef, useState } from 'react'

import styles from './listing-picker.module.css'

type PickerProps = {
  name: string
  label: string
  options: Array<{ value: string; label: string }>
  placeholder: string
  defaultValue?: string
  required?: boolean
  onChange?: (value: string) => void
}

export function ListingPicker({
  name,
  label,
  options,
  placeholder,
  defaultValue = '',
  required = false,
  onChange,
}: PickerProps) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState(false)
  const choices = [{ value: '', label: placeholder }, ...options]
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label id={`${id}-label`} htmlFor={`${id}-native`} className="small-bold">
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        id={`${id}-native`}
        name={name}
        required={required}
        value={value}
        className={`${styles.native} input`}
        onChange={(event) => {
          setValue(event.target.value)
          onChange?.(event.target.value)
          setError(false)
        }}
        onInvalid={(event) => {
          if (window.matchMedia('(max-width: 1023px)').matches) {
            event.preventDefault()
            setError(true)
            trigger.current?.focus()
            if (!document.querySelector('dialog[open]'))
              dialog.current?.showModal()
          }
        }}
      >
        {choices.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        ref={trigger}
        type="button"
        className={`${styles.trigger} input`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => dialog.current?.showModal()}
      >
        <span id={`${id}-value`}>
          {choices.find((item) => item.value === value)?.label}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {error && (
        <p id={`${id}-error`} role="alert">
          Choose {label.toLowerCase()}.
        </p>
      )}
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-labelledby={`${id}-heading`}
      >
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 id={`${id}-heading`} className="text-xl font-bold">
            {label}
          </h2>
          <button
            type="button"
            className="min-h-[44px] underline"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Arrow/Home/End navigation supplements normal option-button tab and activation behavior. */}
        <div
          role="group"
          aria-label={`${label} choices`}
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll('button')
            )
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement
            )
            let next = index
            if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
            else if (event.key === 'ArrowUp')
              next = (index - 1 + buttons.length) % buttons.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = buttons.length - 1
            else return
            event.preventDefault()
            buttons[next]?.focus()
          }}
        >
          {choices.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === value}
              className={styles.option}
              onClick={() => {
                setValue(option.value)
                onChange?.(option.value)
                setError(required && !option.value)
                dialog.current?.close()
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  )
}

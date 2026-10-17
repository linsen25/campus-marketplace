import cn from 'classnames'
import { usePresence, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import type { DialogHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

import { acquireDialogScrollLock } from '@/utils/dialog-scroll-lock'

import styles from './fading-dialog.module.css'

export const dialogExitDuration = 180

// Keep the native modal in the top layer, with focus trapped, until exit finishes.
export function FadingDialog({
  className,
  children,
  onClickCapture,
  onRequestClose,
  onCancel,
  onKeyDownCapture,
  focusAtTop = false,
  ...props
}: DialogHTMLAttributes<HTMLDialogElement> & {
  onRequestClose?: () => void
  focusAtTop?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [present, remove] = usePresence()
  const reduced = useReducedMotion()
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement
    const releaseScroll = acquireDialogScrollLock()
    try {
      dialog?.showModal()
    } catch (error) {
      releaseScroll()
      throw error
    }
    // Opt-in dialog focus runs synchronously with showModal, before its first
    // painted frame. Native focus otherwise scrolls to the first bottom action.
    if (focusAtTop && dialog) {
      dialog.focus({ preventScroll: true })
      dialog.scrollTop = 0
    }
    return () => {
      dialog?.close()
      releaseScroll()
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true })
    }
  }, [focusAtTop])
  useEffect(() => {
    if (present) return undefined
    const timer = setTimeout(() => remove?.(), reduced ? 0 : dialogExitDuration)
    return () => clearTimeout(timer)
  }, [present, reduced, remove])
  return createPortal(
    <dialog
      {...props}
      ref={ref}
      className={cn(className, styles.fade)}
      data-exiting={!present || undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (!present) return
        if (onRequestClose) onRequestClose()
        else onCancel?.(event)
      }}
      onClickCapture={(event) => {
        if (!present) {
          event.preventDefault()
          event.stopPropagation()
        } else {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.target === event.currentTarget &&
            (event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom)
          ) {
            onRequestClose?.()
          }
          onClickCapture?.(event)
        }
      }}
      onKeyDownCapture={(event) => {
        if (!present) {
          event.preventDefault()
          event.stopPropagation()
        } else onKeyDownCapture?.(event)
      }}
    >
      {children}
    </dialog>,
    document.body
  )
}

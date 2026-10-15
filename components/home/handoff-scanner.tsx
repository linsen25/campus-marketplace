import type QrScanner from 'qr-scanner'
import { useEffect, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { validHandoffQr } from '@/lib/handoff'

import styles from './handoff-credential.module.css'

export function HandoffScanner({
  onVerify,
  onClose,
}: {
  onVerify: (token: string) => Promise<void>
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stop = useRef<() => void>(() => {})
  const callbacks = useRef({ onVerify, onClose })
  callbacks.current = { onVerify, onClose }
  const mounted = useRef(false)
  const processing = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<
    'error' | 'scanning' | 'starting' | 'verifying'
  >('starting')
  const [message, setMessage] = useState(
    'Allow camera access to scan the Buyer’s QR. You can also enter the 6-digit code.'
  )
  const close = () => {
    stop.current()
    callbacks.current.onClose()
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let disposed = false
    let cancelled = false
    let scanner: QrScanner | undefined
    const element = video.current!
    const release = () => {
      disposed = true
      // pause(true) releases immediately; destroy also stops the decoder worker.
      if (scanner) {
        scanner.pause(true).catch(() => {})
        scanner.destroy()
        scanner = undefined
      }
      const stream = element.srcObject as MediaStream | null
      stream?.getTracks().forEach((track) => track.stop())
      element.srcObject = null
    }
    stop.current = release
    const leave = () => {
      release()
      callbacks.current.onClose()
    }
    const hidden = () => {
      if (document.hidden) leave()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('marketplace-session-ended', leave)
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error(
            'Camera unavailable. Use HTTPS or localhost, or enter the 6-digit code.'
          )
        const { default: Scanner } = await import(
          /* webpackChunkName: 'handoff-qr-scanner' */ 'qr-scanner'
        )
        if (disposed) return
        scanner = new Scanner(
          element,
          (result) => {
            if (disposed || processing.current) return
            if (!validHandoffQr(result.data)) {
              setMessage(
                'This is not a handoff QR. Scan the Buyer’s code for this Order.'
              )
              return
            }
            processing.current = true
            release()
            setPhase('verifying')
            setMessage(
              'Verifying handoff. Waiting for the authoritative Order state.'
            )
            // The token stays only in this in-flight call, never in URLs/storage/DOM.
            callbacks.current
              .onVerify(result.data)
              .then(() => {
                if (mounted.current) callbacks.current.onClose()
              })
              .catch((error) => {
                if (mounted.current) {
                  setPhase('error')
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Unable to verify handoff. Refresh the Order and try again.'
                  )
                }
              })
              .finally(() => {
                processing.current = false
              })
          },
          {
            preferredCamera: 'environment',
            returnDetailedScanResult: true,
            maxScansPerSecond: 5,
            onDecodeError: (error) => {
              const reason = error instanceof Error ? error.message : error
              if (disposed || reason === Scanner.NO_QR_CODE_FOUND) return
              release()
              setPhase('error')
              setMessage(
                'QR scanner unavailable. Enter the 6-digit code or try again.'
              )
            },
          }
        )
        const activeScanner = scanner
        await activeScanner.start()
        if (disposed) {
          await activeScanner.pause(true)
          activeScanner.destroy()
          const stream = element.srcObject as MediaStream | null
          stream?.getTracks().forEach((track) => track.stop())
          element.srcObject = null
          return
        }
        setPhase('scanning')
        setMessage('Point the camera at the Buyer’s QR for this Order.')
      } catch (error) {
        if (disposed) return
        release()
        let denied =
          error instanceof DOMException && error.name === 'NotAllowedError'
        try {
          denied ||=
            (
              await navigator.permissions.query({
                name: 'camera' as PermissionName,
              })
            ).state === 'denied'
        } catch {
          /* Not supported by every browser. */
        }
        if (!mounted.current || cancelled) return
        setPhase('error')
        setMessage(
          denied
            ? 'Camera permission denied. Allow camera access or enter the 6-digit code.'
            : 'Camera unavailable. Check camera access or enter the 6-digit code.'
        )
      }
    }
    start().catch(() => {})
    return () => {
      cancelled = true
      release()
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('marketplace-session-ended', leave)
    }
  }, [attempt])

  return (
    <FadingDialog
      className={styles.dialog}
      aria-labelledby="handoff-scanner-title"
      focusAtTop={true}
      onRequestClose={close}
    >
      <h3 id="handoff-scanner-title">Scan Buyer’s QR</h3>
      <video
        ref={video}
        className={styles.video}
        muted={true}
        playsInline={true}
        aria-label="Handoff camera preview"
      />
      <p role={phase === 'error' ? 'alert' : 'status'}>{message}</p>
      <div className={styles.actions}>
        <DynamicAction variant="red" showArrow={false} onClick={close}>
          Close
        </DynamicAction>
        {phase === 'error' && (
          <CardAction
            onClick={() => {
              setPhase('starting')
              setMessage('Starting camera…')
              setAttempt((value) => value + 1)
            }}
          >
            Scan again
          </CardAction>
        )}
      </div>
    </FadingDialog>
  )
}

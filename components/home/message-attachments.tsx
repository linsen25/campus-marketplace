import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AccessibleAction } from '@/components/accessible-action'
import WorkButton from '@/components/animata/button/work-button'
import { CardAction } from '@/components/listings/card-actions'
import uploaderStyles from '@/components/listings/listing-uploader.module.css'
import { FileDrop } from '@/components/velora/file-drop'
import { StatefulButton } from '@/components/velora/stateful-button'
import { messageImageLimit, validateMessageImages } from '@/lib/message-images'
import {
  cancelImageSubmission,
  finalizeImageSubmission,
  prepareImageSubmission,
  uploadImageSlot,
} from '@/lib/messages-api'
import type { ImageSubmission } from '@/lib/messages-api'
import type { ImageAttachment, Message } from '@/types/message'

import styles from './message-attachments.module.css'

type PendingPhoto = { file: File; image: ImageAttachment }

/** Owns local files/URLs until a canonical durable send succeeds. */
export function MessageAttachments({
  onCancel,
  onSend,
  onComplete,
  sendClassName,
  sendEnabled = true,
  conversationId,
}: {
  onCancel: () => void
  onSend: (message: Message) => Promise<void>
  onComplete: () => void
  sendClassName: string
  sendEnabled?: boolean
  conversationId: string
}) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const pending = useRef<PendingPhoto[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [reserved, setReserved] = useState(false)
  const submission = useRef<ImageSubmission | null>(null)
  const nonce = useRef<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const finalizedAttempt = useRef(false)
  const mounted = useRef(true)
  const completed = useRef(false)
  const cancelling = useRef(false)
  const inFlight = useRef<Promise<unknown> | null>(null)
  useEffect(
    () => () => {
      mounted.current = false
      controller.current?.abort()
      const id = submission.current?.id
      if (id && !finalizedAttempt.current) {
        ;(inFlight.current || Promise.resolve())
          .catch(() => undefined)
          .then(() => cancelImageSubmission(id))
          .catch(() => undefined)
      }
      pending.current.forEach(({ image }) =>
        URL.revokeObjectURL(image.previewUrl)
      )
      pending.current = []
    },
    []
  )
  const cards = useMemo(
    () =>
      photos.length
        ? photos.map(({ image }) => ({
            id: image.id,
            image: image.previewUrl,
          }))
        : [
            {
              id: 'empty',
              color: '#2a2134',
              content: (
                <span className={uploaderStyles.choose}>
                  No photos selected
                </span>
              ),
            },
          ],
    [photos]
  )
  const select = (files: File[]) => {
    if (sending || reserved) return
    try {
      validateMessageImages(files, pending.current.length)
      const additions = files.map((file) => ({
        file,
        image: {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mimeType: file.type,
          previewUrl: URL.createObjectURL(file),
        },
      }))
      pending.current = [...pending.current, ...additions]
      setPhotos(pending.current)
      setError('')
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to add photos.'
      )
    }
  }
  const discard = () => {
    const removed = pending.current[index]
    if (!removed || sending || reserved) return
    URL.revokeObjectURL(removed.image.previewUrl)
    pending.current = pending.current.filter(
      (_, position) => position !== index
    )
    setPhotos(pending.current)
    setIndex(Math.min(index, Math.max(0, pending.current.length - 1)))
    setError('')
  }
  const send = () => {
    if (!sendEnabled || !pending.current.length || sending) return undefined
    setSending(true)
    setReserved(true)
    setError('')
    nonce.current ||= crypto.randomUUID()
    const task = async () => {
      try {
        const files = pending.current.map((item) => item.file)
        submission.current = await prepareImageSubmission(
          conversationId,
          files,
          nonce.current as string
        )
        const reservation = submission.current
        if (!mounted.current || cancelling.current) {
          if (reservation.state === 'pending')
            await cancelImageSubmission(reservation.id)
          return
        }
        if (reservation.state === 'abandoned')
          throw new Error(
            'This upload was cancelled. Close it and select photos again.'
          )
        controller.current = new AbortController()
        if (reservation.state === 'pending') {
          for (let slotIndex = 0; slotIndex < files.length; slotIndex += 1) {
            await uploadImageSlot(
              reservation.id,
              reservation.manifest[slotIndex].id,
              files[slotIndex],
              controller.current.signal
            )
          }
        }
        if (!mounted.current || cancelling.current) return
        finalizedAttempt.current = true
        const message = await finalizeImageSubmission(reservation.id)
        completed.current = true
        await onSend(message)
        pending.current.forEach(({ image }) =>
          URL.revokeObjectURL(image.previewUrl)
        )
        pending.current = []
      } catch (reason) {
        if (mounted.current) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Unable to send photos. Retry the same selection.'
          )
          setSending(false)
        }
        throw reason
      }
    }
    inFlight.current = task()
    return inFlight.current
  }
  const cancel = async () => {
    if (cancelling.current) return
    cancelling.current = true
    const id = submission.current?.id
    try {
      if (id) await cancelImageSubmission(id)
      controller.current?.abort()
      await inFlight.current?.catch(() => undefined)
      if (submission.current?.id)
        await cancelImageSubmission(submission.current.id)
      onCancel()
    } catch {
      cancelling.current = false
      if (mounted.current)
        setError(
          'Send may already have completed. Retry Send to confirm it before closing.'
        )
    }
  }
  return (
    <section className={styles.composer} aria-label="Add attachment">
      <div className={styles.actions}>
        <button type="button" className={styles.back} onClick={cancel}>
          <ArrowLeft size={18} aria-hidden="true" />
          Add attachment
        </button>
        <StatefulButton
          className={sendClassName}
          disabled={!sendEnabled || (!photos.length && !sending)}
          minLoadingMs={300}
          resetAfter={800}
          onClick={send}
          onStateChange={(state) => {
            if (state === 'idle' && completed.current) onComplete()
          }}
        >
          Send
        </StatefulButton>
      </div>
      <div className={styles.content}>
        {!sendEnabled && (
          <p role="status" className={styles.hint}>
            Image sending is not available yet. Selected photos are temporary
            and will not be uploaded.
          </p>
        )}
        <FileDrop
          inputId="message-photos"
          inputLabel="Attachment photos"
          accept="image/jpeg,image/png,image/webp"
          files={photos.map(({ file }) => file)}
          showFiles={false}
          disabled={sending || reserved}
          onFiles={select}
        />
        <p className={styles.hint}>
          1-4 photos. JPEG, PNG or WebP. Maximum 3 MB each.
        </p>
        {error && <p role="alert">{error}</p>}
        <div data-selected-photos="true">
          <div className={uploaderStyles.action}>
            <AccessibleAction
              items={cards}
              activeIndex={index}
              maxVisible={messageImageLimit}
              disabled={sending || reserved}
            />
          </div>
          {photos.length > 0 && (
            <div className={uploaderStyles.controls}>
              <WorkButton
                appearance="pagination"
                aria-label="Previous selected photo"
                disabled={sending || reserved || index === 0}
                onClick={() => setIndex((current) => current - 1)}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </WorkButton>
              <CardAction disabled={sending || reserved} onClick={discard}>
                Discard
              </CardAction>
              <WorkButton
                appearance="pagination"
                aria-label="Next selected photo"
                disabled={sending || reserved || index >= photos.length - 1}
                onClick={() => setIndex((current) => current + 1)}
              >
                <ArrowRight size={18} aria-hidden="true" />
              </WorkButton>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

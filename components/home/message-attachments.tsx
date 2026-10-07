import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AccessibleAction } from '@/components/accessible-action'
import WorkButton from '@/components/animata/button/work-button'
import { CardAction } from '@/components/listings/card-actions'
import uploaderStyles from '@/components/listings/listing-uploader.module.css'
import { FileDrop } from '@/components/velora/file-drop'
import { StatefulButton } from '@/components/velora/stateful-button'
import { messageImageLimit, validateMessageImages } from '@/lib/message-images'
import type { ImageAttachment } from '@/types/message'

import styles from './message-attachments.module.css'

type PendingPhoto = { file: File; image: ImageAttachment }

/** Owns unsent URLs only. OnSend synchronously transfers them to Messages. */
export function MessageAttachments({
  onCancel,
  onSend,
  onComplete,
  sendClassName,
  sendEnabled = true,
}: {
  onCancel: () => void
  onSend: (images: ImageAttachment[]) => void
  onComplete: () => void
  sendClassName: string
  sendEnabled?: boolean
}) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const pending = useRef<PendingPhoto[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(
    () => () => {
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
    if (sending) return
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
    if (!removed || sending) return
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
    onSend(pending.current.map(({ image }) => image))
    // URLs now belong to the parent message history, not this draft's cleanup.
    pending.current = []
    setSending(true)
    return Promise.resolve()
  }
  return (
    <section className={styles.composer} aria-label="Add attachment">
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.back}
          disabled={sending}
          onClick={onCancel}
        >
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
            if (state === 'idle' && sending) onComplete()
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
          disabled={sending}
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
              disabled={sending}
            />
          </div>
          {photos.length > 0 && (
            <div className={uploaderStyles.controls}>
              <WorkButton
                appearance="pagination"
                aria-label="Previous selected photo"
                disabled={sending || index === 0}
                onClick={() => setIndex((current) => current - 1)}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </WorkButton>
              <CardAction disabled={sending} onClick={discard}>
                Discard
              </CardAction>
              <WorkButton
                appearance="pagination"
                aria-label="Next selected photo"
                disabled={sending || index >= photos.length - 1}
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

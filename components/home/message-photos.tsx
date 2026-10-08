/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- Image load failures are network events, not user interactions. */
/* eslint-disable @next/next/no-img-element -- Short-lived private URLs bypass image optimizers/caches. */
import { useCallback, useEffect, useRef, useState } from 'react'

import ExpandableGallery from '@/components/expandable-gallery'
import { refreshMessageImages } from '@/lib/messages-api'
import type { ImageMessage } from '@/types/message'

import styles from './messages-chat.module.css'

export function MessagePhotos({ message }: { message: ImageMessage }) {
  const [images, setImages] = useState(message.images)
  const [error, setError] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  const lastRenewal = useRef(0)
  useEffect(() => {
    setImages((current) =>
      message.images.map((image) => {
        const previous = current.find((item) => item.id === image.id)
        return previous &&
          Date.parse(previous.expiresAt || '') >
            Date.parse(image.expiresAt || '')
          ? previous
          : image
      })
    )
  }, [message.images])
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )
  const renew = useCallback(async () => {
    if (busy.current || Date.now() - lastRenewal.current < 3000) return
    busy.current = true
    lastRenewal.current = Date.now()
    try {
      const result = await refreshMessageImages(message.id)
      if (mounted.current) {
        setImages(result.images)
        setError(false)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      busy.current = false
    }
  }, [message.id])
  useEffect(() => {
    const expiry = images[0]?.expiresAt
    if (!expiry) return undefined
    const timer = setTimeout(
      () => renew(),
      Math.max(3000, Date.parse(expiry) - Date.now() - 60000)
    )
    return () => clearTimeout(timer)
  }, [images, renew])
  return (
    <>
      {images.length === 1 ? (
        <img
          className={styles.singlePhoto}
          src={images[0].previewUrl}
          alt={images[0].name}
          onError={() => renew()}
        />
      ) : (
        <ExpandableGallery images={images} onImageError={() => renew()} />
      )}
      {error && (
        <button type="button" onClick={() => renew()}>
          Retry loading photos
        </button>
      )}
    </>
  )
}

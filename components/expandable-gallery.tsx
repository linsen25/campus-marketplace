/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- Image error callbacks renew private media. */
/* eslint @next/next/no-img-element: off -- Local message object URLs. */
'use client'

import { AnimatePresence as DialogPresence } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react'
import {
  useCallback,
  useMemo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'

import { FadingDialog } from '@/components/ui/fading-dialog'
import { ImageSlider } from '@/components/velora/image-slider'
import type { ImageAttachment } from '@/types/message'

import styles from './expandable-gallery.module.css'

const spring = { type: 'spring', stiffness: 160, damping: 18, mass: 1 } as const
const positions = [
  { rotate: -15, x: -42, y: 10 },
  { rotate: -3, x: -5, y: -10 },
  { rotate: 12, x: 40, y: 5 },
]

/** Supplied stacked/shared-layout gallery, adapted to local chat photos. */
export default function ExpandableGallery({
  images,
  onImageError,
  singlePhotoClassName,
}: {
  images: readonly ImageAttachment[]
  onImageError?: () => void
  singlePhotoClassName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [naturalRatios, setNaturalRatios] = useState<Record<string, number>>({})
  const [frameRatio, setFrameRatio] = useState(0.8)
  const selectedRatio =
    viewerIndex === null ? null : naturalRatios[images[viewerIndex]?.id]
  useLayoutEffect(() => {
    if (!selectedRatio) return
    const target = Math.max(0.6, Math.min(1.8, selectedRatio))
    // Three-percent hysteresis avoids resizing for insignificant ratio changes.
    setFrameRatio((current) =>
      Math.abs(target - current) / current >= 0.03 ? target : current
    )
  }, [selectedRatio])
  const slides = useMemo(
    () => images.map((image) => ({ src: image.previewUrl, alt: image.name })),
    [images]
  )
  const recordRatio = (id: string, image: HTMLImageElement) => {
    if (image.naturalWidth && image.naturalHeight) {
      const ratio = image.naturalWidth / image.naturalHeight
      setNaturalRatios((current) =>
        current[id] === ratio ? current : { ...current, [id]: ratio }
      )
    }
  }
  const openViewer = (index: number) => {
    const ratio = naturalRatios[images[index].id] || 0.8
    setFrameRatio(Math.max(0.6, Math.min(1.8, ratio)))
    setViewerIndex(index)
  }
  const restoring = useRef(false)
  const oldAnchor = useRef('')
  const restoringHistory = useRef<HTMLElement | null>(null)
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const scrollPosition = useRef<number | null>(null)
  const reduced = useReducedMotion()
  const transition = reduced ? { duration: 0 } : spring
  const history = useCallback(
    () => container.current?.closest<HTMLElement>('[data-message-history]'),
    []
  )
  const close = useCallback(() => {
    const viewport = history()
    if (viewport && !restoring.current) {
      restoringHistory.current = viewport
      restoring.current = true
      oldAnchor.current = viewport.style.overflowAnchor
      viewport.dataset.galleryRestoring = 'true'
      viewport.style.overflowAnchor = 'none'
    }
    setExpanded(false)
  }, [history])
  const restoreScroll = useCallback(() => {
    const viewport = restoringHistory.current
    if (restoring.current && viewport && scrollPosition.current !== null)
      viewport.scrollTop = scrollPosition.current
  }, [])
  const finishRestoring = useCallback(() => {
    if (!restoring.current) return
    restoreScroll()
    const viewport = restoringHistory.current
    restoring.current = false
    restoringHistory.current = null
    if (viewport) {
      delete viewport.dataset.galleryRestoring
      viewport.style.overflowAnchor = oldAnchor.current
      viewport.dispatchEvent(new Event('scroll'))
    }
  }, [restoreScroll])
  useLayoutEffect(() => {
    if (expanded) return undefined
    restoreScroll()
    if (!reduced) return undefined
    const frame = requestAnimationFrame(finishRestoring)
    return () => cancelAnimationFrame(frame)
  }, [expanded, reduced, restoreScroll, finishRestoring])
  useEffect(() => () => finishRestoring(), [finishRestoring])
  useEffect(() => {
    if (!expanded || viewerIndex !== null) return undefined
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded, viewerIndex, close])
  const open = () => {
    finishRestoring()
    scrollPosition.current =
      container.current?.closest<HTMLElement>('[data-message-history]')
        ?.scrollTop ?? null
    setExpanded(true)
  }
  return (
    <div
      ref={container}
      className={
        images.length === 1 && !expanded ? styles.singleGallery : styles.gallery
      }
      data-image-gallery={images.length > 1 || undefined}
      data-expanded={expanded}
    >
      <LayoutGroup id={id}>
        <AnimatePresence
          onExitComplete={() => {
            restoreScroll()
            // Single-photo return replaces the grid rather than animating it.
            if (images.length === 1) finishRestoring()
          }}
        >
          {expanded && (
            <motion.button
              type="button"
              transition={reduced ? { duration: 0 } : undefined}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={styles.back}
              onClick={close}
            >
              ← Go back to chat
            </motion.button>
          )}
        </AnimatePresence>
        {images.length === 1 && !expanded ? (
          <button
            type="button"
            className={styles.singleTrigger}
            data-image-open="true"
            aria-label="Open photo"
            onClick={open}
          >
            <img
              className={singlePhotoClassName}
              src={images[0].previewUrl}
              alt={images[0].name}
              onError={onImageError}
              onLoad={(event) => recordRatio(images[0].id, event.currentTarget)}
            />
          </button>
        ) : (
          <motion.div
            layout={true}
            className={expanded ? styles.grid : styles.stack}
            transition={transition}
            onLayoutAnimationComplete={finishRestoring}
          >
            {images.map((image, index) => {
              if (index >= 3 && !expanded) return null
              const position = positions[index] ?? positions[1]
              return (
                <motion.button
                  layout={true}
                  key={image.id}
                  type="button"
                  layoutId={`card-container-${image.id}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    rotate: expanded ? 0 : position.rotate,
                    x: expanded ? 0 : position.x,
                    y: expanded ? 0 : position.y,
                    zIndex: expanded ? 10 : (index + 1) * 10,
                  }}
                  transition={transition}
                  whileHover={
                    !expanded && !reduced
                      ? {
                          scale: 1.05,
                          y: position.y - 15,
                          rotate: position.rotate * 0.8,
                          zIndex: 50,
                        }
                      : undefined
                  }
                  className={expanded ? styles.expandedPhoto : styles.photo}
                  aria-label={`View photo ${index + 1} of ${images.length}`}
                  data-image-open={(index === 0 && !expanded) || undefined}
                  onClick={expanded ? () => openViewer(index) : open}
                >
                  <motion.div
                    layoutId={`image-inner-${image.id}`}
                    layout="position"
                    className={styles.image}
                    transition={transition}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      draggable={false}
                      onError={onImageError}
                      onLoad={(event) =>
                        recordRatio(image.id, event.currentTarget)
                      }
                    />
                  </motion.div>
                </motion.button>
              )
            })}
          </motion.div>
        )}
      </LayoutGroup>
      <DialogPresence>
        {viewerIndex !== null && (
          <FadingDialog
            className={styles.viewer}
            aria-label="Full image viewer"
            onRequestClose={() => setViewerIndex(null)}
          >
            <button
              type="button"
              className={styles.back}
              onClick={() => setViewerIndex(null)}
            >
              <ArrowLeft size={16} aria-hidden={true} />
              Back to gallery
            </button>
            <div
              className={styles.viewerMedia}
              style={{ '--viewer-ratio': frameRatio } as CSSProperties}
            >
              <ImageSlider
                images={slides}
                imageTransition="fade"
                activeIndex={viewerIndex}
                autoplay={false}
                playbackControls={false}
                scrim={false}
                label="Message photos"
                onIndexChange={setViewerIndex}
              />
            </div>
          </FadingDialog>
        )}
      </DialogPresence>
    </div>
  )
}

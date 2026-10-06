import type { ReactNode } from 'react'

import { ImageSlider } from '@/components/velora/image-slider'

import styles from './listing-media.module.css'

// The outer shared-layout region continues to own every accepted aspect ratio.
export function ListingMedia({
  images,
  alt,
  children,
  activeIndex,
  onIndexChange,
}: {
  images: readonly string[]
  alt: string
  children?: ReactNode
  activeIndex?: number
  onIndexChange?: (index: number) => void
}) {
  return (
    <span className={styles.media}>
      {children ??
        (images.length > 1 ? (
          <ImageSlider
            images={images.map((src) => ({ src, alt }))}
            autoplay={false}
            playbackControls={false}
            scrim={false}
            activeIndex={activeIndex}
            label={`${alt} photos`}
            onIndexChange={onIndexChange}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- Local visual fixture, inside a shared media slot.
          <img src={images[0]} alt={alt} loading="lazy" />
        ))}
    </span>
  )
}

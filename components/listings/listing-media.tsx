import type { ReactNode } from 'react'

import styles from './listing-media.module.css'

// The outer shared-layout region owns aspect ratios. A future carousel replaces
// only this component's contents, retaining the full images array at this boundary.
export function ListingMedia({
  images,
  alt,
  children,
}: {
  images: readonly string[]
  alt: string
  children?: ReactNode
}) {
  return (
    <span className={styles.media}>
      {children ?? (
        // eslint-disable-next-line @next/next/no-img-element -- Local visual fixture, inside a shared media slot.
        <img src={images[0]} alt={alt} loading="lazy" />
      )}
    </span>
  )
}

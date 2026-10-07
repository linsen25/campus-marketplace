import cn from 'classnames'
import type { ComponentProps } from 'react'

import styles from './skeleton.module.css'

/** Supplied shadcn Skeleton primitive, with its utility classes translated to CSS Modules. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(styles.skeleton, className)}
      {...props}
    />
  )
}

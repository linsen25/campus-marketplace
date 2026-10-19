/* eslint jsx-a11y/no-noninteractive-tabindex: off -- Focusable native overflow region enables keyboard table scrolling. */
'use client'
// Supplied shadcn semantic Table primitives, with isolated CSS Modules presentation.
import cn from 'classnames'
import type { ComponentProps } from 'react'

import styles from './analytics-primitives.module.css'

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className={styles.tableContainer}
      role="region"
      aria-label="Product performance table"
      tabIndex={0}
    >
      <table
        data-slot="table"
        className={cn(styles.table, className)}
        {...props}
      />
    </div>
  )
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(styles.tableHeader, className)}
      {...props}
    />
  )
}
export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" {...props} />
}
export function TableFooter(props: ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" {...props} />
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(styles.tableRow, className)}
      {...props}
    />
  )
}
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn(styles.tableHead, className)}
      {...props}
    />
  )
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(styles.tableCell, className)}
      {...props}
    />
  )
}
export function TableCaption({
  className,
  ...props
}: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn(styles.caption, className)}
      {...props}
    />
  )
}

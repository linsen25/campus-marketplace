import type { ReactNode } from 'react'

export default function TearTicket(props: {
  children?: ReactNode
  onActivate?: () => void
  resetToken?: number
  [key: string]: unknown
}): JSX.Element

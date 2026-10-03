import type { ReactNode } from 'react'

export default function HoldButton(props: {
  children?: ReactNode
  doneLabel?: string
  icon?: ReactNode
  doneIcon?: ReactNode
  backgroundColor?: string
  fillColor?: string
  textColor?: string
  fillTextColor?: string
  size?: 'lg' | 'md' | 'sm'
  radius?: number
  fillDirection?: 'right' | 'up'
  holdTime?: number
  releaseTime?: number
  pressScale?: number
  wave?: boolean
  waveAmplitude?: number
  glow?: boolean
  resetAfter?: number
  disabled?: boolean
  onHold?: () => void
  onTap?: () => void
  className?: string
}): JSX.Element

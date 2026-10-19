import type { ReactNode } from 'react'

type Option = string | { value: string; label: ReactNode; tag?: string }
export default function GlideSelect(props: {
  placement?: 'bottom' | 'top-desktop' | 'top'
  overlay?: boolean
  placeholder?: string
  accentColor?: string
  options: readonly Option[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  ariaLabel: string
  size?: 'lg' | 'md' | 'sm'
  className?: string
  surfaceColor?: string
  highlightColor?: string
  showTags?: boolean
  disabled?: boolean
}): JSX.Element

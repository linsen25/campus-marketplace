import type { ReactNode } from 'react'
type Option = string | { value: string; label: ReactNode; tag?: string }
export default function GlideSelect(props: {
  options: readonly Option[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  ariaLabel: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  surfaceColor?: string
  highlightColor?: string
  showTags?: boolean
}): JSX.Element

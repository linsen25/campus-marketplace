import type { ButtonHTMLAttributes } from 'react'

export default function AlgoliaWhiteButton({
  children = 'About',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`algolia-white-btn ${className}`}
    >
      {children}
    </button>
  )
}

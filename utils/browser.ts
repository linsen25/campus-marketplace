export const isBrowser = typeof window !== 'undefined'

export const isomorphicWindow = isBrowser ? window : undefined
export const isomorphicDocument = isBrowser ? document : undefined

export function getScrollbarWidth() {
  return isBrowser
    ? window.innerWidth - document.documentElement.clientWidth
    : 0
}

// Stable root gutters remain reserved even with overflow:hidden. Compensate only
// when the browser/root does not already preserve that space.
export function getScrollLockPadding() {
  if (!isBrowser) return 0
  const gutter = getComputedStyle(document.documentElement).getPropertyValue(
    'scrollbar-gutter'
  )
  return gutter.includes('stable') ? 0 : Math.max(0, getScrollbarWidth())
}

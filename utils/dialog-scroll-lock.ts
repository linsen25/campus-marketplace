import { getScrollLockPadding } from '@/utils/browser'

// A native top-layer dialog traps focus, but does not lock the document scroll.
// Keep one snapshot until the last FadingDialog (including its exit) unmounts.
const locks = new Set<symbol>()
let restore: (() => void) | undefined

export function acquireDialogScrollLock() {
  const token = Symbol('dialog-scroll-lock')
  if (!locks.size) {
    const root = document.documentElement
    const body = document.body
    const x = window.scrollX
    const y = window.scrollY
    const snapshots = [root, body].map((element) => ({
      element,
      overflow: ['overflow-x', 'overflow-y'].map((property) => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      })),
    }))
    const padding = body.style.getPropertyValue('padding-right')
    const paddingPriority = body.style.getPropertyPriority('padding-right')
    const gutter = getScrollLockPadding()
    if (gutter > 0)
      body.style.setProperty(
        'padding-right',
        `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`
      )
    for (const { element } of snapshots) {
      element.style.setProperty('overflow-x', 'hidden', 'important')
      element.style.setProperty('overflow-y', 'hidden', 'important')
    }
    restore = () => {
      for (const { element, overflow } of snapshots)
        for (const { property, value, priority } of overflow) {
          if (value) element.style.setProperty(property, value, priority)
          else element.style.removeProperty(property)
        }
      if (gutter > 0) {
        if (padding)
          body.style.setProperty('padding-right', padding, paddingPriority)
        else body.style.removeProperty('padding-right')
      }
      // The app uses scroll-smooth on html. Restoration must be instantaneous.
      const behavior = root.style.getPropertyValue('scroll-behavior')
      const priority = root.style.getPropertyPriority('scroll-behavior')
      root.style.setProperty('scroll-behavior', 'auto', 'important')
      window.scrollTo(x, y)
      if (behavior)
        root.style.setProperty('scroll-behavior', behavior, priority)
      else root.style.removeProperty('scroll-behavior')
    }
  }
  locks.add(token)
  return () => {
    if (!locks.delete(token) || locks.size) return
    restore?.()
    restore = undefined
  }
}

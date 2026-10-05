import type { RefObject } from 'react'
import { useEffect } from 'react'

// A destination-owned first-paint handshake, independent of router events.
export function useMarketReady(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const current = root.current
    if (!current) return undefined
    const element: HTMLElement = current
    let cancelled = false
    let frame = 0
    element.dataset.marketReady = 'false'
    element.dataset.marketPreparation = 'fonts'
    async function prepare() {
      // Wait for the fonts actually used by the initial Market viewport, not
      // unrelated Welcome/decorative font requests still in flight.
      const textNodes = [
        element,
        ...Array.from(
          element.querySelectorAll<HTMLElement>('header, [data-market-card]')
        ).slice(0, 5),
      ]
      // Failed font downloads still render the CSS fallback; they must not
      // turn a fully painted destination into a navigation failure.
      await Promise.allSettled(
        textNodes.map((node) => {
          const style = getComputedStyle(node)
          return document.fonts.load(
            `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          )
        })
      )
      const check = async () => {
        if (cancelled) return
        element.dataset.marketPreparation = 'assets'
        const toolbar = element.querySelector('#listing-sort-label')
        const background = element.querySelector('canvas[data-rendered="true"]')
        const images = Array.from(
          element.querySelectorAll<HTMLImageElement>('[data-market-card] img')
        ).filter((image) => {
          const bounds = image.getBoundingClientRect()
          return bounds.top < innerHeight && bounds.bottom > 0
        })
        // A top-layer loading cover must not defer viewport lazy images.
        for (const image of images) {
          image.loading = 'eager'
        }
        if (
          !toolbar?.getBoundingClientRect().width ||
          !background ||
          images.some((image) => !image.complete || !image.naturalWidth)
        ) {
          frame = requestAnimationFrame(check)
          return
        }
        try {
          await Promise.all(images.map((image) => image.decode()))
        } catch {
          if (!cancelled) element.dataset.marketPreparation = 'failed'
          return
        }
        element.dataset.marketPreparation = 'paint'
        // Header ResizeObserver state and decoded images get a committed paint.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (!cancelled) element.dataset.marketReady = 'true'
          })
        })
      }
      frame = requestAnimationFrame(check)
    }
    prepare().catch(() => {
      if (!cancelled) element.dataset.marketPreparation = 'failed'
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [root])
}

export function waitForMarketReady(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0
    const abort = () => {
      cancelAnimationFrame(frame)
      reject(new Error('Market preparation cancelled.'))
    }
    const check = () => {
      if (signal.aborted) {
        abort()
        return
      }
      if (document.querySelector('[data-market-ready="true"]')) {
        signal.removeEventListener('abort', abort)
        resolve()
      } else if (document.querySelector('[data-market-preparation="failed"]')) {
        signal.removeEventListener('abort', abort)
        reject(new Error('Market preparation failed.'))
      } else frame = requestAnimationFrame(check)
    }
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

import { useRouter } from 'next/router'
import type { MouseEvent, ReactNode } from 'react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'

import { waitForMarketReady } from '@/hooks/use-market-ready'

import styles from './desktop-route-transition.module.css'

type Navigation = { source: string; destination: string }
const PendingDestinationContext = createContext<string | null>(null)
export function usePendingDestination() {
  return useContext(PendingDestinationContext)
}

const TransitionContext = createContext<
  (destination: string, event?: MouseEvent<HTMLAnchorElement>) => void
>(() => {})

export function useDesktopRouteTransition() {
  const navigate = useContext(TransitionContext)
  return (event: MouseEvent<HTMLAnchorElement>, destination: string) =>
    navigate(destination, event)
}
export function usePageSlide() {
  return useContext(TransitionContext)
}

function homeReady(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0
    const abort = () => {
      cancelAnimationFrame(frame)
      reject(new Error('Navigation cancelled.'))
    }
    const check = () => {
      if (signal.aborted) {
        abort()
        return
      }
      const root = document.querySelector('[data-slot="home-sidebar-demo"]')
      const desktop = matchMedia('(min-width: 1024px)').matches
      const region = root?.querySelector(
        desktop ? '[data-slot="sidebar-body"]' : '[data-home-mobile-header]'
      )
      const background = root?.querySelector('canvas[data-rendered="true"]')
      if (
        !root?.getBoundingClientRect().width ||
        !region?.getBoundingClientRect().width ||
        !background
      ) {
        frame = requestAnimationFrame(check)
        return
      }
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        })
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

// Freeze rendered geometry/appearance, rather than copying hundreds of unrelated
// computed longhands for every node before starting the router request.
const snapshotProperties = `display position top right bottom left z-index width
height min-width min-height max-width max-height box-sizing padding margin gap
flex flex-direction flex-wrap align-items align-content justify-content order
grid-template-columns grid-template-rows grid-column grid-row overflow
background color filter border border-radius box-shadow opacity visibility transform
transform-origin font font-weight line-height letter-spacing text-align
text-transform white-space object-fit object-position isolation`.split(/\s+/)

function painted(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (signal.aborted) reject(new Error('Navigation cancelled.'))
        else resolve()
      })
    )
  })
}

// A visual snapshot keeps the source stable without mounting another live page,
// issuing duplicate requests, or retaining interactive duplicate controls.
function snapshot(page: HTMLElement, host: HTMLElement) {
  const copy = page.cloneNode(true) as HTMLElement
  const originals = [
    page,
    ...Array.from(page.querySelectorAll<HTMLElement>('*')),
  ]
  const copies = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))]
  originals.forEach((original, index) => {
    const target = copies[index]
    const computed = getComputedStyle(original)
    target.style.cssText += snapshotProperties
      .map((property) => `${property}: ${computed.getPropertyValue(property)};`)
      .join('')
    target.style.animation = 'none'
    target.style.transition = 'none'
    target.removeAttribute('id')
    for (const attribute of [
      'data-route-surface',
      'data-market-ready',
      'data-market-preparation',
      'data-market-card',
      'data-slot',
    ])
      target.removeAttribute(attribute)
    if (
      original instanceof HTMLCanvasElement &&
      target instanceof HTMLCanvasElement
    ) {
      target.width = original.width
      target.height = original.height
      original.dispatchEvent(new Event('page-slide-snapshot'))
      target.getContext('2d')?.drawImage(original, 0, 0)
    }
    if (
      original instanceof HTMLInputElement &&
      target instanceof HTMLInputElement
    )
      target.value = original.value
    target.scrollTop = original.scrollTop
  })
  copy.style.position = 'absolute'
  copy.style.top = `${-window.scrollY}px`
  copy.style.left = '0'
  copy.style.width = `${innerWidth}px`
  host.replaceChildren(copy)
}

export function DesktopRouteTransitionProvider({
  children,
}: {
  children: ReactNode
}) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const trackView = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const sourceView = useRef<HTMLDivElement>(null)
  const pressedControl = useRef<HTMLElement | null>(null)
  const busy = useRef(false)
  const navigate = (
    destination: string,
    event?: MouseEvent<HTMLAnchorElement>
  ) => {
    if (
      event &&
      (event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey)
    )
      return
    const source = router.pathname
    if (
      !(
        (source === '/listings' && destination === '/home') ||
        (source === '/home' && destination === '/listings')
      )
    )
      return
    event?.preventDefault()
    if (busy.current) return
    performance.mark('page-slide:click')
    busy.current = true
    if (event) {
      const control = event.currentTarget
      pressedControl.current = control
      control.dataset.routePending = 'true'
    }
    router.prefetch(destination).catch(() => {})
    setNavigation({ source, destination })
  }
  useEffect(() => {
    if (!navigation) return undefined
    const track = trackView.current
    const page = surface.current
    const source = sourceView.current
    if (!track || !page || !source) return undefined
    const controller = new AbortController()
    const previousOverflowX = document.documentElement.style.overflowX
    document.documentElement.style.overflowX = 'clip'
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = matchMedia('(max-width: 1023px)').matches
    const slideDuration = mobile ? 320 : 380
    const duration = reduced ? 60 : slideDuration
    const direction = navigation.destination === '/home' ? 1 : -1
    let active = true
    let animation: Animation | undefined
    let timeout: ReturnType<typeof setTimeout>
    const restore = () => {
      controller.abort()
      clearTimeout(timeout)
      animation?.cancel()
      track.removeAttribute('style')
      page.removeAttribute('style')
      page.removeAttribute('inert')
      delete page.dataset.routeEnter
      document.documentElement.style.overflowX = previousOverflowX
      if (pressedControl.current)
        delete pressedControl.current.dataset.routePending
      pressedControl.current = null
      busy.current = false
    }
    const clear = () => {
      active = false
      restore()
      setNavigation(null)
    }
    window.addEventListener('popstate', clear)
    const run = async () => {
      performance.mark('page-slide:prepare')
      // Start the request before the synchronous snapshot; React cannot replace
      // the source DOM until this task yields.
      const route = routerRef.current.push(navigation.destination)
      snapshot(page, source)
      performance.mark('page-slide:snapshot')
      source.setAttribute('inert', '')
      page.setAttribute('inert', '')
      track.style.position = 'fixed'
      track.style.inset = '0'
      track.style.height = '100dvh'
      track.style.zIndex = '100000'
      track.style.transform = 'translateX(0)'
      page.style.visibility = 'hidden'
      page.style.position = 'absolute'
      page.style.inset = '0'
      page.style.left = `${direction * 100}%`
      page.style.right = 'auto'
      page.style.width = '100%'
      page.style.height = '100dvh'
      page.style.overflow = 'auto'
      // Each page owns its fixed background within the shared moving track.
      page.style.transform = 'translateX(0)'
      const destination = async () => {
        const navigated = await route
        if (
          !active ||
          !navigated ||
          location.pathname !== navigation.destination
        )
          throw new Error('Navigation cancelled.')
        performance.mark('page-slide:route-mounted')
        if (navigation.destination === '/listings')
          await waitForMarketReady(controller.signal)
        else await homeReady(controller.signal)
      }
      await Promise.race([
        destination(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Destination timed out.'))
          }, 20000)
        }),
      ])
      if (!active) return
      clearTimeout(timeout)
      performance.mark('page-slide:ready')
      source.dataset.routePhase = 'enter'
      page.style.zIndex = '100001'
      page.style.visibility = 'visible'
      page.dataset.routeEnter = navigation.destination
      // One physical track supplies identical progress to both adjacent pages.
      animation = track.animate(
        [
          {
            transform: reduced
              ? `translateX(${-direction * 100}%)`
              : 'translateX(0)',
          },
          { transform: `translateX(${-direction * 100}%)` },
        ],
        {
          duration,
          easing: mobile
            ? 'cubic-bezier(0.22, 0.61, 0.36, 1)'
            : 'cubic-bezier(0.42, 0, 1, 1)',
          fill: 'forwards',
        }
      )
      await animation.finished
      if (!active) return
      performance.mark('page-slide:land')
      // Keep the destination on top at its final position through a painted
      // frame. Hide the source synchronously BEFORE restoring normal layering;
      // its React node may remain mounted until the next commit.
      track.style.transform = `translateX(${-direction * 100}%)`
      animation?.cancel()
      source.dataset.routePhase = 'landed'
      await painted(controller.signal)
      if (!active) return
      source.style.visibility = 'hidden'
      source.replaceChildren()
      source.dataset.routePhase = 'handoff'
      // Commit the source's removal to the compositor while the destination
      // still owns its covering layer. Combining both layer changes in one
      // task can expose the old texture for a frame on mobile Chromium.
      await painted(controller.signal)
      if (!active) return
      performance.mark('page-slide:release')
      clear()
    }
    run().catch(async () => {
      if (!active) return
      controller.abort()
      clearTimeout(timeout)
      if (location.pathname !== navigation.source)
        await Promise.race([
          routerRef.current.replace(navigation.source).catch(() => false),
          new Promise((resolve) => {
            setTimeout(resolve, 3000)
          }),
        ])
      if (active) clear()
    })
    return () => {
      active = false
      restore()
      window.removeEventListener('popstate', clear)
    }
  }, [navigation])
  return (
    <TransitionContext.Provider value={navigate}>
      <PendingDestinationContext.Provider
        value={navigation?.destination ?? null}
      >
        <div ref={trackView} className={styles.track} data-route-track="true">
          {navigation && (
            <div
              ref={sourceView}
              className={styles.source}
              data-route-phase="waiting"
              data-route-source={navigation.source}
              data-route-destination={navigation.destination}
              aria-hidden="true"
            />
          )}
          <div
            ref={surface}
            className={styles.surface}
            data-route-surface="true"
          >
            {children}
          </div>
        </div>
      </PendingDestinationContext.Provider>
    </TransitionContext.Provider>
  )
}

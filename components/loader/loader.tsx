import classNames from 'classnames'
import { atom } from 'jotai'
import { useAtomValue, useUpdateAtom } from 'jotai/utils'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'

import { isSearchStalledAtom } from '@instantsearch/widgets/virtual-state-results/virtual-state-results'

export type LoaderProps = {
  layout?: 'bar' | 'overlay'
}

const routeLoadingThreshold = 400 // im ms
export const loaderFinishedAtom = atom(false)

export function Loader({ layout = 'overlay' }: LoaderProps) {
  const router = useRouter()
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routePending, setRoutePending] = useState(false)
  const setLoaderFinished = useUpdateAtom(loaderFinishedAtom)
  const loaderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    const handleRouteChangeStart = (
      url: string,
      { shallow }: { shallow: boolean }
    ) => {
      if (shallow) return

      setLoaderFinished(false)
      setRoutePending(true)

      timeout = setTimeout(() => {
        setIsRouteLoading(true)
      }, routeLoadingThreshold)
    }

    const handleRouteChangeComplete = (
      url: string,
      { shallow }: { shallow: boolean }
    ) => {
      if (shallow) return

      clearTimeout(timeout)
      setIsRouteLoading(false)
      setRoutePending(false)
    }

    const handleRouteChangeError = (
      _: any,
      url: string,
      { shallow }: { shallow: boolean }
    ) => {
      handleRouteChangeComplete(url, { shallow })
    }

    router.events.on('routeChangeStart', handleRouteChangeStart)
    router.events.on('routeChangeComplete', handleRouteChangeComplete)
    router.events.on('routeChangeError', handleRouteChangeError)

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart)
      router.events.off('routeChangeComplete', handleRouteChangeComplete)
      router.events.off('routeChangeError', handleRouteChangeError)
    }
  }, [router?.events, setLoaderFinished])

  const isSearchStalled = useAtomValue(isSearchStalledAtom)
  const isLoading = Boolean(isSearchStalled || isRouteLoading)
  useEffect(() => {
    if (routePending || isLoading || !router.isReady) {
      setLoaderFinished(false)
      return undefined
    }
    let active = true
    // Wait for the existing loader's CSS fade to finish, without a new timer.
    const animations = loaderRef.current?.getAnimations() ?? []
    Promise.allSettled(animations.map((animation) => animation.finished)).then(
      () => {
        if (active) setLoaderFinished(true)
      }
    )
    return () => {
      active = false
    }
  }, [routePending, isLoading, router.isReady, layout, setLoaderFinished])

  const cn = classNames('loader', `loader--${layout}`, {
    'loader--loading': isLoading,
  })

  return (
    <div ref={loaderRef} className={cn}>
      {layout === 'overlay' && (
        <div className="loading-spinner">
          <div className="loading-spinner-dot"></div>
          <div className="loading-spinner-dot"></div>
          <div className="loading-spinner-dot"></div>
          <div className="loading-spinner-dot"></div>
          <div className="loading-spinner-dot"></div>
          <div className="loading-spinner-dot"></div>
        </div>
      )}
    </div>
  )
}

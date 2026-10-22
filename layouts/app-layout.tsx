import { LazyMotion } from 'framer-motion'
import { Provider as JotaiProvider } from 'jotai'
import { Context as ResponsiveContext } from 'react-responsive'

import { useIsMounted } from '@/hooks/useIsMounted'

export type AppLayoutProps = {
  children: React.ReactNode
}

const loadFramerMotionFeatures = () =>
  import(/* webpackChunkName: 'lib' */ '@/lib/framer-motion-features').then(
    (mod) => mod.default
  )

export function AppLayout({ children }: AppLayoutProps) {
  const isMounted = useIsMounted(true)

  return (
    <JotaiProvider>
      <LazyMotion features={loadFramerMotionFeatures} strict={true}>
        {isMounted() ? (
          children
        ) : (
          <ResponsiveContext.Provider value={{ width: 1440, height: 980 }}>
            {children}
          </ResponsiveContext.Provider>
        )}
      </LazyMotion>
    </JotaiProvider>
  )
}

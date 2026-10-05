import { AnimatePresence } from 'framer-motion'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import Script from 'next/script'
import { useMemo } from 'react'

/// #if DEV
// eslint-disable-next-line import/order
import { Dev } from '@dev/dev'
/// #endif

import { AuthModalProvider } from '@/components/auth/auth-modal'
import { MarketMobileNavigation } from '@/components/listings/market-mobile-nav'
import { MarketplaceSessionProvider } from '@/components/listings/marketplace-session'
import {
  MarketplaceHeader,
  MarketplaceContent,
  MarketplaceFooter,
} from '@/components/listings/marketplace-shell'
import { Loader } from '@/components/loader/loader'
import { DesktopRouteTransitionProvider } from '@/components/navigation/desktop-route-transition'
import { Overlay } from '@/components/overlay/overlay'
import { AppLayout } from '@/layouts/app-layout'
import { gaTrackingId, isDev, isProd } from '@/utils/env'
import { scrollToTop } from '@/utils/scrollToTop'

import '@/styles/_index.css'
import '@/styles/desktop-app-tokens.css'
import '@/components/ui/GradientWaves.css'
import '@/components/ui/MaskedHeading.css'
import '@/components/ui/TextType.css'
import '@/components/ui/Lanyard.css'
import '@/components/ui/TearTicket.css'
import '@/components/animata/button/shining-button.css'
import '@/components/animata/button/algolia-white-button.css'

function MarketplaceApp({ Component, pageProps, router }: AppProps) {
  const isCatalogPage = useMemo(
    () => router?.pathname === '/catalog/[[...slugs]]',
    [router?.pathname]
  )

  return (
    <AppLayout>
      <Head>
        <title>Campus Marketplace</title>
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"
        />
      </Head>

      {/* Google Analytics */}
      {isProd && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaTrackingId}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){window.dataLayer.push(arguments);}
              gtag('js', new Date());

              gtag('config', '${gaTrackingId}');
            `}
          </Script>
        </>
      )}

      <MarketplaceContent>
        {router.pathname !== '/' &&
          router.pathname !== '/listings' &&
          router.pathname !== '/home' && <MarketplaceHeader />}

        <AnimatePresence exitBeforeEnter={true} onExitComplete={scrollToTop}>
          <Component {...pageProps} key={router.route} />
        </AnimatePresence>

        {router.pathname !== '/' && router.pathname !== '/home' && (
          <MarketplaceFooter />
        )}
      </MarketplaceContent>

      <Loader
        layout={
          isCatalogPage ||
          router.pathname === '/' ||
          router.pathname === '/listings' ||
          router.pathname === '/home'
            ? 'bar'
            : 'overlay'
        }
      />
      <Overlay />
      <MarketMobileNavigation />

      {isDev && isCatalogPage && <Dev />}
    </AppLayout>
  )
}

export default function App(props: AppProps) {
  return (
    <MarketplaceSessionProvider>
      <AuthModalProvider>
        <DesktopRouteTransitionProvider>
          <MarketplaceApp {...props} />
        </DesktopRouteTransitionProvider>
      </AuthModalProvider>
    </MarketplaceSessionProvider>
  )
}

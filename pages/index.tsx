import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { HomepageScene } from '@/components/listings/homepage-scene'
import type { HeroParallaxProduct } from '@/components/ui/hero-parallax'
import type { Listing } from '@/types/listing'

import { getServerSideProps as getBrowseProps } from './listings/index'

// Share the existing request-scoped listing query without duplicating domain logic.
export const getServerSideProps: GetServerSideProps = async (context) => {
  const result = await getBrowseProps(context)
  if (!('props' in result)) return result
  const props = await result.props
  if (process.env.NODE_ENV !== 'development') return { props }
  const { heroParallaxDemoProducts } = await import(
    /* webpackChunkName: 'hero-parallax-demo' */ '@/lib/fixtures/hero-parallax-demo-products'
  )
  return { props: { ...props, demoProducts: heroParallaxDemoProducts } }
}

export default function WelcomePage({
  listings,
  error,
  demoProducts,
}: {
  listings: Listing[]
  error: string | null
  demoProducts?: HeroParallaxProduct[]
}) {
  return (
    <>
      <Head>
        <title>Campus Marketplace</title>
      </Head>
      <main>
        {error && <p role="alert">{error}</p>}
        <HomepageScene listings={listings} demoProducts={demoProducts} />
      </main>
    </>
  )
}

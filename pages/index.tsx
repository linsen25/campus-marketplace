import Head from 'next/head'

import { HomepageScene } from '@/components/listings/homepage-scene'

export default function WelcomePage() {
  return (
    <>
      <Head>
        <title>Usual & Unusual</title>
      </Head>
      <main>
        <HomepageScene />
      </main>
    </>
  )
}

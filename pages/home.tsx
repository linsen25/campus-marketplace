import Head from 'next/head'

import { AnimatedSidebarDemo } from '@/components/home/animated-sidebar-demo'

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Home | Campus Marketplace</title>
      </Head>
      <AnimatedSidebarDemo />
    </>
  )
}

import Head from 'next/head'

import { AnimatedSidebarDemo } from '@/components/home/animated-sidebar-demo'
import { OrderVisualProvider } from '@/components/home/order-visual-context'

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Home | Usual & Unusual</title>
      </Head>
      <OrderVisualProvider>
        <AnimatedSidebarDemo />
      </OrderVisualProvider>
    </>
  )
}

import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useRef } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { Container } from '@/components/container/container'
import { safeMarketplaceNext } from '@/lib/marketplace-auth'

// Compatibility entry for existing server-side auth redirects. Welcome triggers
// open this same modal directly without navigating away from Home.
export default function SignInPage() {
  const router = useRouter()
  const { openAuth } = useAuthModal()
  const opened = useRef(false)
  useEffect(() => {
    if (!router.isReady || opened.current) return
    opened.current = true
    openAuth({ next: safeMarketplaceNext(router.query.next) })
  }, [router.isReady, router.query.next, openAuth])
  return (
    <>
      <Head>
        <title>Log in | Campus Marketplace</title>
      </Head>
      <main className="py-8">
        <Container>
          <h1 className="text-2xl font-bold">Western email required.</h1>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() =>
              openAuth({ next: safeMarketplaceNext(router.query.next) })
            }
          >
            Log in
          </button>
        </Container>
      </main>
    </>
  )
}

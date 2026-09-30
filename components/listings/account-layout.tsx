import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from 'react-responsive'

import { Container } from '@/components/container/container'
import { BackButton } from '@/components/listings/back-button'
import { MarketplaceActions } from '@/components/listings/marketplace-actions'

import styles from './account-layout.module.css'

const ParentHistoryContext = createContext(false)

export function AccountBackLink() {
  const hasParent = useContext(ParentHistoryContext)
  return (
    <BackButton
      href="/account"
      className={styles.back}
      useHistory={hasParent}
    />
  )
}

export function AccountLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const desktop = useMediaQuery({ minWidth: 1024 })
  const reduceMotion = useReducedMotion()
  const root = router.pathname === '/account'
  useEffect(() => {
    if (desktop && root && router.isReady) router.replace('/profile/listings')
  }, [desktop, root, router])
  const wasRoot = useRef(root)
  const [hasParent, setHasParent] = useState(false)
  useEffect(() => {
    if (root) setHasParent(false)
    else if (wasRoot.current) setHasParent(true)
    wasRoot.current = root
  }, [root])
  const sidebar = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!desktop && !root) sidebar.current?.setAttribute('inert', '')
    else sidebar.current?.removeAttribute('inert')
  }, [desktop, root])
  return (
    <ParentHistoryContext.Provider value={hasParent}>
      <main className="overflow-x-clip py-4 laptop:py-12">
        <Container>
          <h1 className={`${styles.desktopTitle} mb-6 text-2xl font-bold`}>
            My Account
          </h1>
          <div className={styles.layout}>
            <aside
              ref={sidebar}
              className={`${styles.sidebar} ${!root ? styles.covered : ''}`}
              aria-label="Account navigation"
              aria-hidden={!desktop && !root ? true : undefined}
            >
              <h1 className={`${styles.mobileTitle} mb-6 text-2xl font-bold`}>
                My Account
              </h1>
              <MarketplaceActions />
            </aside>
            {desktop ? (
              <div className={styles.pane}>{children}</div>
            ) : (
              <AnimatePresence initial={false}>
                {!root && (
                  <m.div
                    key={router.asPath}
                    className={styles.mobilePage}
                    initial={{ x: reduceMotion ? 0 : '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: reduceMotion ? 0 : '100%' }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.24,
                      ease: 'easeOut',
                    }}
                  >
                    {children}
                  </m.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </Container>
      </main>
    </ParentHistoryContext.Provider>
  )
}

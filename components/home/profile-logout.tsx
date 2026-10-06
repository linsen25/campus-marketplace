import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import { createContext, useContext, useRef, useState } from 'react'

import { LogoutReveal } from '@/components/auth/logout-reveal'
import { marketplaceRequest } from '@/lib/listings-api'

const LogoutContext = createContext<
  (username?: string | null) => Promise<() => void>
>(() => Promise.resolve(() => {}))
export const useProfileLogout = () => useContext(LogoutContext)

function welcomeReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const check = () => {
      const title = document.getElementById('welcome-title')
      const background = document.querySelector('canvas[data-rendered="true"]')
      const visual = document.querySelector(
        '.tear-ticket, .lanyard-wrapper canvas'
      )
      if (
        visual?.getBoundingClientRect().width &&
        location.pathname === '/' &&
        title?.getBoundingClientRect().width &&
        background
      ) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      } else if (performance.now() - started > 20000)
        reject(new Error('Welcome did not become ready.'))
      else requestAnimationFrame(check)
    }
    check()
  })
}

// Lives above routed pages so the modal cover survives Home unmounting.
export function ProfileLogoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const busy = useRef(false)
  const [stage, setStage] = useState(0)
  const [run, setRun] = useState<{
    username?: string | null
    preparation: Promise<void>
    key: number
    handleCovered: () => void
  } | null>(null)
  const attempt = (username?: string | null, signedOut = false) => {
    busy.current = true
    setStage(0)
    let covered = () => {}
    const sourceCovered = new Promise<void>((resolve) => {
      covered = resolve
    })
    // Start on the next painted frame after the dialog locks the source UI.
    const preparation = new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    }).then(async () => {
      setStage(1)
      if (!signedOut) {
        await marketplaceRequest('/api/auth/sign-out', 'POST', {})
        const session = await marketplaceRequest<{ seller: unknown }>(
          '/api/auth/session',
          'GET'
        )
        if (session.seller)
          throw new Error('Your session is still active. Please retry.')
      }
      setStage(2)
      // A fast provider response must not expose the destination through the
      // still-closing panels. Use their actual animation completion event.
      await sourceCovered
      if (location.pathname !== '/' && !(await router.replace('/')))
        throw new Error('Unable to open Welcome.')
      await welcomeReady()
    })
    // The reveal subscribes immediately; also prevent an unhandled rejection.
    preparation.catch(() => {})
    setRun({
      username,
      preparation,
      key: performance.now(),
      handleCovered: covered,
    })
  }
  return (
    <LogoutContext.Provider
      value={async (username) => {
        if (busy.current) throw new Error('Sign-out is already in progress.')
        busy.current = true
        try {
          await marketplaceRequest('/api/auth/sign-out', 'POST', {})
          const session = await marketplaceRequest<{ seller: unknown }>(
            '/api/auth/session',
            'GET'
          )
          if (session.seller)
            throw new Error('Your session is still active. Please retry.')
          return () => attempt(username, true)
        } catch (error) {
          busy.current = false
          throw error
        }
      }}
    >
      {children}
      {run && (
        <LogoutReveal
          key={run.key}
          username={run.username ?? undefined}
          stage={stage}
          preparation={run.preparation}
          onCovered={run.handleCovered}
          onRetry={() => attempt(run.username)}
          onComplete={() => {
            setRun(null)
            busy.current = false
          }}
        />
      )}
    </LogoutContext.Provider>
  )
}

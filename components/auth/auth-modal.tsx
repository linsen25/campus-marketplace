// Native showModal() dialogs own keyboard/backdrop interaction and focus trapping.
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import { useRouter } from 'next/router'
import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  SyntheticEvent,
} from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { AuthSuccessReveal } from '@/components/auth/auth-success-reveal'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { AuthSignupCard } from '@/components/velora/auth-signup-card'
import styles from '@/components/velora/auth-signup-card.module.css'

type AuthMode = 'signin' | 'signup'
type AuthRequest = {
  mode?: AuthMode
  intent?: 'contact-seller' | 'join' | 'login' | 'navigate'
  next?: string
  onDismiss?: () => void
}
type AuthIntent = Pick<AuthRequest, 'onDismiss'> &
  Required<Omit<AuthRequest, 'onDismiss'>>
const AuthContext = createContext<{
  openAuth: (request?: AuthRequest) => void
}>({
  openAuth: () => {},
})

function AuthDialog({
  initialMode,
  onClose,
  onAuthenticated,
  navigationError,
}: {
  initialMode: AuthMode
  onClose: () => void
  onAuthenticated: (mode: 'recovery' | 'signin' | 'signup') => Promise<void>
  navigationError: string
}) {
  const present = useIsPresent()
  const reduced = useReducedMotion()
  const fadeDuration = present ? 0.22 : 0.16
  const ref = useRef<HTMLDialogElement>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!present) setIsScrolling(false)
    return () => clearTimeout(scrollTimer.current)
  }, [present])
  useLayoutEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const body = document.body
    const html = document.documentElement
    const x = window.scrollX
    const y = window.scrollY
    const dialog = ref.current
    const previous = {
      body: body.style.overflow,
      html: html.style.overflow,
      padding: body.style.paddingRight,
      behavior: html.style.scrollBehavior,
    }
    const gutter = innerWidth - html.clientWidth
    body.style.paddingRight = `${
      parseFloat(getComputedStyle(body).paddingRight) + gutter
    }px`
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    html.style.scrollBehavior = 'auto'
    dialog?.showModal()
    dialog
      ?.querySelector<HTMLInputElement>('input')
      ?.focus({ preventScroll: true })
    window.scrollTo({ left: x, top: y, behavior: 'auto' })
    return () => {
      // Close explicitly before removal so native automatic focus restoration
      // cannot scroll the page after our own restoration has already run.
      dialog?.close()
      body.style.overflow = previous.body
      html.style.overflow = previous.html
      body.style.paddingRight = previous.padding
      window.scrollTo({ left: x, top: y, behavior: 'auto' })
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      html.style.scrollBehavior = previous.behavior
    }
  }, [])
  return createPortal(
    <div className={styles.overlay}>
      <motion.dialog
        ref={ref}
        className={styles.dialog}
        data-exiting={present ? undefined : ''}
        data-scrolling={isScrolling ? '' : undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: reduced ? 0 : fadeDuration,
          ease: 'easeOut',
        }}
        aria-labelledby="auth-title"
        onScroll={() => {
          if (!present) return
          setIsScrolling(true)
          clearTimeout(scrollTimer.current)
          scrollTimer.current = setTimeout(() => setIsScrolling(false), 600)
        }}
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault()
          event.stopPropagation()

          onClose()
        }}
        onClick={(event: MouseEvent<HTMLDialogElement>) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect()
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              onClose()
          }
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDialogElement>) => {
          if ((event.target as HTMLElement).closest('dialog') !== ref.current)
            return
          // Keep a listing dialog underneath from handling auth's keys.
          event.stopPropagation()
          if (event.key === 'Tab') {
            const controls = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
              ) || []
            ).filter((element) => element.getClientRects().length > 0)
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <AuthSignupCard
          initialMode={initialMode}
          initialError={navigationError}
          onClose={onClose}
          onAuthenticated={onAuthenticated}
        />
      </motion.dialog>
    </div>,
    document.body
  )
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { refresh } = useMarketplaceSession()
  const [intent, setIntent] = useState<AuthIntent | null>(null)
  const sessionId = useRef(0)
  const [navigationError, setNavigationError] = useState('')
  const [success, setSuccess] = useState<{
    request: AuthIntent
    username: string | undefined
    complete: () => void
  } | null>(null)
  const pendingIntent = useRef<AuthIntent | null>(null)
  const afterDismiss = useRef<(() => void) | undefined>()
  function openAuth(request: AuthRequest = {}) {
    if (success) return
    sessionId.current += 1
    setNavigationError('')
    // An explicit auth entry opens in place; a session snapshot must not turn
    // it into an early redirect or execute an unauthenticated continuation.
    const next: AuthIntent = {
      mode: request.mode || 'signin',
      intent: request.intent || 'navigate',
      next: request.next || '/listings',
      onDismiss: request.onDismiss,
    }
    pendingIntent.current = next
    setIntent(next)
  }
  const close = () => {
    if (success) return
    if (!pendingIntent.current) return
    afterDismiss.current = pendingIntent.current?.onDismiss
    pendingIntent.current = null
    setIntent(null)
  }
  async function authenticated(
    request: AuthIntent,
    mode: 'recovery' | 'signin' | 'signup'
  ) {
    const seller = await refresh()
    // A request completing after dismissal must not resurrect an old intent.
    const next = pendingIntent.current
    if (next !== request) return
    if (next.intent === 'contact-seller' || mode === 'recovery') {
      pendingIntent.current = null
      setIntent(null)
      if (next.intent !== 'contact-seller') await router.push(next.next)
      return
    }
    await new Promise<void>((resolve) => {
      setSuccess({
        request: next,
        username: seller?.displayName,
        complete: resolve,
      })
    })
  }
  const onAuthenticated = async (mode: 'recovery' | 'signin' | 'signup') => {
    if (intent) await authenticated(intent, mode)
  }
  return (
    <AuthContext.Provider value={{ openAuth }}>
      {children}
      <AnimatePresence
        onExitComplete={() => {
          const reset = afterDismiss.current
          afterDismiss.current = undefined
          reset?.()
        }}
      >
        {intent && (
          <AuthDialog
            key={`auth-modal-${sessionId.current}`}
            initialMode={intent.mode}
            navigationError={navigationError}
            onClose={close}
            onAuthenticated={onAuthenticated}
          />
        )}
      </AnimatePresence>
      {success && (
        <AuthSuccessReveal
          username={success.username}
          onCovered={async () => {
            pendingIntent.current = null
            setIntent(null)
            let navigationTimeout: ReturnType<typeof setTimeout> | undefined
            try {
              const navigated = await Promise.race([
                router.push('/listings'),
                new Promise<never>((_, reject) => {
                  navigationTimeout = setTimeout(
                    () => reject(new Error('Navigation timed out.')),
                    10000
                  )
                }),
              ])
              if (!navigated) throw new Error('Navigation was cancelled.')
              // Let the destination commit and paint behind the opaque cover.
              await new Promise<void>((resolve, reject) => {
                const deadline = performance.now() + 5000
                const check = () => {
                  if (document.querySelector('#listing-sort-label')) {
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve())
                    )
                  } else if (performance.now() > deadline) {
                    reject(new Error('Listings did not render.'))
                  } else requestAnimationFrame(check)
                }
                requestAnimationFrame(check)
              })
            } catch {
              sessionId.current += 1
              setNavigationError(
                'You are signed in, but Listings could not open. Please try again.'
              )
              pendingIntent.current = success.request
              setIntent(success.request)
            } finally {
              clearTimeout(navigationTimeout)
            }
          }}
          onComplete={() => {
            success.complete()
            setSuccess(null)
          }}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuthModal() {
  return useContext(AuthContext)
}

import { loadConnectAndInitialize } from '@stripe/connect-js/pure'
import { useCallback, useEffect, useRef, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import { OrderProgress } from '@/components/home/order-progress'

import styles from './stripe-account-onboarding.module.css'

type OnboardingElement = HTMLElement & {
  setOnLoadError?: (
    listener: ((value: { error: { type?: string } }) => void) | undefined
  ) => void
  setOnLoaderStart?: (listener: (() => void) | undefined) => void
  setOnExit?: (listener: (() => void) | undefined) => void
  setOnStepChange?: (
    listener: ((value: { step: string }) => void) | undefined
  ) => void
}
type Session = { clientSecret: string; publishableKey: string }
const onboardingPhases = ['Account', 'Personal', 'Business', 'Payout'] as const

function onboardingPhase(step: string) {
  const value = step.toLowerCase()
  if (
    /(business|company|entity|organization|representative_details)/.test(value)
  )
    return 2
  if (/(account|authentication|identity)/.test(value)) return 0
  if (/(personal|individual|person|contact)/.test(value)) return 1
  if (/(payout|external_account|bank|financial)/.test(value)) return 3
  return null
}

export function StripeAccountOnboarding({
  onComplete,
  onCancel,
  mode = 'onboarding',
}: {
  onComplete: () => Promise<void>
  onCancel?: () => void
  mode?: 'onboarding' | 'management'
}) {
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<
    'loading' | 'ready' | 'waiting' | 'error' | 'complete' | 'timeout'
  >('loading')
  const [message, setMessage] = useState('Preparing secure Stripe onboarding…')
  const [currentPhase, setCurrentPhase] = useState(0)
  const [readyConfirmed, setReadyConfirmed] = useState(false)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let active = true
    let connect: Awaited<ReturnType<typeof loadConnectAndInitialize>> | null =
      null
    let element: OnboardingElement | null = null
    let mount: HTMLDivElement | null = null
    let poll: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let sessionRequest: Promise<Session> | null = null
    let timedOut = false
    setCurrentPhase(0)
    setReadyConfirmed(false)
    const stopTimers = () => {
      if (poll) clearInterval(poll)
      if (timeout) clearTimeout(timeout)
      poll = undefined
      timeout = undefined
    }
    const reconcile = async () => {
      try {
        const result = await marketplaceRequest<{
          capabilities?: { payoutAccount?: { status?: string } }
        }>('/api/stripe/reconcile', 'POST', { kind: 'payout_account' })
        const status = result.capabilities?.payoutAccount?.status
        if (status === 'ready' && active) {
          stopTimers()
          setReadyConfirmed(true)
          setState('complete')
          setMessage(
            'Stripe verification is complete. Confirming your payout status…'
          )
          await onComplete()
          return true
        }
      } catch {}
      return false
    }
    timeout = setTimeout(() => {
      if (!active) return
      timedOut = true
      setState('timeout')
      setMessage(
        'Stripe onboarding is taking longer than expected. Retry to establish a new secure session.'
      )
    }, 60 * 1000)
    const loadSession = () => {
      if (!sessionRequest) {
        sessionRequest = (async () => {
          for (let retry = 0; ; retry += 1) {
            try {
              return await marketplaceRequest<Session>(
                '/api/stripe/account-session',
                'POST',
                { mode }
              )
            } catch (error) {
              // Settings reconciliation and Account Session creation share a
              // short database lease. A user can open onboarding while the
              // initial status refresh still owns it; retry that exact,
              // transient conflict without weakening the server lock.
              if (
                retry >= 2 ||
                !(error instanceof Error) ||
                !error.message.includes('already being updated')
              )
                throw error
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (retry + 1))
              )
            }
          }
        })().finally(() => {
          sessionRequest = null
        })
      }
      return sessionRequest
    }
    loadSession()
      .then(async (session) => {
        if (timedOut) throw new Error('Onboarding session timed out')
        if (timeout) clearTimeout(timeout)
        timeout = undefined
        let initialClientSecret: string | null = session.clientSecret
        connect = await loadConnectAndInitialize({
          publishableKey: session.publishableKey,
          // Connect.js calls this again when its short-lived Account Session
          // expires. Reusing the original secret leaves the embedded surface
          // blank after an authentication popup or a long verification step.
          fetchClientSecret: async () => {
            if (initialClientSecret) {
              const value = initialClientSecret
              initialClientSecret = null
              return value
            }
            return (await loadSession()).clientSecret
          },
          locale: 'en-CA',
          appearance: {
            variables: {
              colorPrimary: '#7c3aed',
              colorBackground: '#101521',
              colorText: '#f3edf8',
              colorSecondaryText: '#c9bdd3',
              buttonPrimaryColorBackground: '#7c3aed',
              buttonPrimaryColorBorder: '#7c3aed',
              buttonPrimaryColorText: '#ffffff',
              buttonLabelFontWeight: '600',
              borderRadius: '12px',
              spacingUnit: '4px',
            },
          },
        })
        mount = host.current
        if (!active || !mount) return
        element = connect.create(
          mode === 'management' ? 'account-management' : 'account-onboarding'
        ) as OnboardingElement
        element.setOnLoaderStart?.(() => {
          if (active) setState('loading')
        })
        element.setOnLoadError?.(({ error }) => {
          if (active) {
            setState('error')
            setMessage(
              `Unable to load secure Stripe onboarding (${
                error?.type || 'render_error'
              }). Retry.`
            )
          }
        })
        element.setOnExit?.(() => {
          if (!active) return
          void reconcile().then((ready) => {
            if (!active || ready) return
            setState('ready')
            setMessage('')
          })
        })
        element.setOnStepChange?.(({ step }) => {
          if (!active) return
          const phase = onboardingPhase(step)
          if (phase !== null) setCurrentPhase(phase)
          setState((current) => (current === 'waiting' ? current : 'ready'))
        })
        mount.replaceChildren(element)
        setState('ready')
        setMessage('Complete the secure Stripe onboarding steps below.')
      })
      .catch((error: unknown) => {
        if (active) {
          setState('error')
          setMessage(
            error instanceof Error && error.message
              ? `Unable to load secure onboarding: ${error.message}`
              : 'Unable to load secure onboarding. Check your connection and retry.'
          )
        }
      })
    return () => {
      active = false
      stopTimers()
      if (element && mount?.contains(element)) mount.removeChild(element)
      // `logout()` is an explicit connected-account sign-out, not component
      // disposal. Calling it while a Stripe login/identity popup owns focus
      // invalidates the recoverable embedded session and forces another login.
    }
  }, [attempt, mode, onComplete])

  const waiting = state === 'waiting'
  const retryable = state === 'error' || state === 'timeout'
  return (
    <div className={styles.root} aria-busy={state === 'loading'}>
      {mode === 'onboarding' && (
        <section className={styles.verificationIntro}>
          <h3>Verify your identity with Stripe</h3>
          <p>
            To receive protected payments through Stripe, you may need to verify
            your identity. Stripe securely collects and reviews your
            verification information.
          </p>
          <div className={styles.verificationOptions}>
            <div>
              <strong>Option 1 — Photo ID + selfie</strong>
              <p>
                Scan a government-issued photo ID, then take a selfie to verify
                that it&apos;s you.
              </p>
            </div>
            <div>
              <strong>Option 2 — Photo ID + proof of address</strong>
              <p>
                Provide two different documents: one proving your identity and
                another showing your name and home address. No selfie is
                required for this option.
              </p>
            </div>
          </div>
          <p className={styles.requirementsNote}>
            Stripe determines which verification options are available. The
            requirements may vary by account and location.
          </p>
        </section>
      )}
      {state !== 'ready' && state !== 'waiting' && (
        <p role={state === 'error' || state === 'timeout' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      {state !== 'loading' && (
        <div className={styles.timeline} data-stripe-onboarding-timeline="true">
          <p className={styles.phaseSummary}>
            Current: {onboardingPhases[currentPhase]}
            {currentPhase < onboardingPhases.length - 1 &&
              ` · Next: ${onboardingPhases[currentPhase + 1]}`}
          </p>
          <OrderProgress
            title="Stripe onboarding"
            current={currentPhase}
            steps={onboardingPhases}
            completed={readyConfirmed ? onboardingPhases.length : 0}
            emphasizeCurrentAndNext
          />
        </div>
      )}
      <div
        ref={host}
        className={styles.host}
        aria-hidden={waiting || undefined}
        data-stripe-account-onboarding={mode === 'onboarding' || undefined}
        data-stripe-account-management={mode === 'management' || undefined}
      />
      <p className={styles.privacyNote}>
        Stripe collects identity and payout information directly to verify your
        account. UU does not display these private details to buyers.
      </p>
      {waiting && (
        <div
          className={styles.waiting}
          role="dialog"
          aria-modal="true"
          aria-label="Waiting for Stripe verification"
        >
          <div className={styles.waitingCard}>
            <p className={styles.waitingTitle}>
              Waiting for Stripe verification
            </p>
            <p>Complete verification in the Stripe window to continue.</p>
            <p>{message}</p>
            <div className={styles.actions}>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" onClick={retry}>
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
      {retryable && (
        <button type="button" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}

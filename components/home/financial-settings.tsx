import { AnimatePresence } from 'framer-motion'
import {
  CalendarDays,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Globe,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import sortStyles from '@/components/filter-interaction.module.css'
import { StripeAccountOnboarding } from '@/components/payments/stripe-account-onboarding'
import { StripeFlowPanel } from '@/components/payments/stripe-flow-panel'
import { Skeleton } from '@/components/ui/skeleton'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { marketplaceRequest } from '@/lib/listings-api'
import type { StripeIdentityVerification } from '@/types/financial-capabilities'

import financialStyles from './financial-settings.module.css'
import styles from './profile.module.css'
import { StripeCardSetup, stripeSetupAvailable } from './stripe-card-setup'

const labels = {
  unset: 'Unset',
  set: 'Set',
  ready: 'Ready',
  needs_attention: 'Needs attention',
}
type Capability = 'payment_method' | 'payout_account'
type VerificationStatus =
  | StripeIdentityVerification['status']
  | 'refresh_failed'
type SetupAction = { pending?: boolean; error?: string; onStart: () => unknown }

// Each section owns its action presentation. Phase 1B can provide independent
// pending/error state and a real async onStart without changing this layout.
export function FinancialCapabilitySection({
  capability,
  status,
  summary,
  action,
  verificationStatus,
}: {
  capability: Capability
  status: keyof typeof labels
  summary?: string
  action: SetupAction
  verificationStatus?: VerificationStatus
}) {
  const payment = capability === 'payment_method'
  const ready = status === 'set' || status === 'ready'
  const attention = status === 'needs_attention'
  const errorId = useId()
  const title = payment ? 'Payment method' : 'Payout account'
  const copy = {
    payment_method: {
      initial:
        'Add a payment method to pay securely for purchases on Usual & Unusual.',
      warning:
        'Your payment method needs to be updated before it can be used for future purchases.',
      unset: 'Set up payment method',
      set: 'Change payment method',
      ready: 'Change payment method',
      needs_attention: 'Set up payment method',
      pending: 'Preparing secure payment setup?',
    },
    payout_account: {
      initial: 'Set up payouts to receive money from completed sales.',
      warning:
        'Additional information is required before you can receive payouts.',
      unset: 'Set up payouts',
      set: 'Manage payouts',
      ready: 'Manage payouts',
      needs_attention: 'Resolve issue',
      pending: 'Preparing payout setup?',
    },
  }[capability]
  const description = attention ? copy.warning : copy.initial
  const handleStart = () => action.onStart()
  const verificationCopy = verificationStatus
    ? {
        action_required: {
          title: 'Action required',
          body: 'Stripe needs additional information to enable payouts.',
        },
        pending_review: {
          title: 'Submitted / Pending review',
          body: 'Stripe will review your information. Your payout status will update when verification is complete.',
        },
        ready: {
          title: 'Ready',
          body: 'Your identity and payout account are ready for protected payments.',
        },
        refresh_failed: {
          title: 'Unable to refresh',
          body: "We couldn't refresh Stripe's latest verification status. Return to Settings to retry.",
        },
        not_available: {
          title: 'Not available',
          body: "Stripe hasn't provided a confirmed identity verification status yet.",
        },
      }[verificationStatus]
    : null
  return (
    <section
      className={financialStyles.setupSection}
      aria-label={title}
      data-financial-capability={capability}
    >
      <div className={financialStyles.sectionHeading}>
        <h4>{title}</h4>
        {summary && <p className={financialStyles.summary}>{summary}</p>}
        {(!ready || attention) && (
          <p className={styles.caption}>{description}</p>
        )}
      </div>
      {verificationCopy && (
        <div
          className={financialStyles.identityStatus}
          data-stripe-identity-status={verificationStatus}
          role="status"
        >
          <span>Identity verification</span>
          <strong>{verificationCopy.title}</strong>
          <p>{verificationCopy.body}</p>
        </div>
      )}
      <StatefulButton
        className={financialStyles.setupAction}
        disabled={action.pending}
        aria-busy={action.pending || undefined}
        aria-describedby={action.error ? errorId : undefined}
        onClick={handleStart}
      >
        {action.pending ? copy.pending : copy[status]}
      </StatefulButton>
      {action.error && (
        <p id={errorId} className={styles.error} role="alert">
          {action.error}
        </p>
      )}
    </section>
  )
}

// Presentation-only shells: no inputs, form controls, or card-data collection.
function CardFormPreview() {
  return (
    <div
      className={financialStyles.cardPreview}
      role="group"
      aria-label="Card form preview, not interactive"
    >
      <div className={financialStyles.previewGroup}>
        <p className={financialStyles.previewLabel}>Name on card</p>
        <div className={financialStyles.previewField}>
          <UserRound size={18} aria-hidden="true" />
          <span>Full name</span>
        </div>
      </div>
      <div className={financialStyles.previewGroup}>
        <p className={financialStyles.previewLabel}>Country or region</p>
        <div
          className={`${sortStyles.trigger} ${financialStyles.countryPreview}`}
        >
          <Globe size={18} aria-hidden="true" />
          <span className={financialStyles.country}>Canada</span>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        <div className={financialStyles.previewField}>Postal code</div>
      </div>
      <div className={financialStyles.previewGroup}>
        <p className={financialStyles.previewLabel}>Card information</p>
        <div className={financialStyles.previewField}>
          <CreditCard size={18} aria-hidden="true" />
          <span>Card number</span>
          <span className={financialStyles.brandHost} aria-hidden="true" />
        </div>
        <div className={financialStyles.cardDetailsRow}>
          <div className={financialStyles.previewField}>
            <CalendarDays size={18} aria-hidden="true" />
            <span>MM / YY</span>
          </div>
          <div className={financialStyles.previewField}>
            <span>CVC</span>
            <CircleHelp size={16} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function FinancialSettings({
  settings,
  onManage,
}: {
  settings: boolean
  onManage?: () => void
}) {
  const { data, error, refresh, loading, userId } = useFinancialCapabilities()
  const [surface, setSurface] = useState<Capability | null>(null)
  const [renderedSurface, setRenderedSurface] = useState<Capability | null>(
    null
  )
  const [reconcileErrors, setReconcileErrors] = useState<
    Record<Capability, string>
  >({ payment_method: '', payout_account: '' })
  const [identityVerification, setIdentityVerification] =
    useState<StripeIdentityVerification['status']>('not_available')
  const currentOwner = useRef(userId)
  currentOwner.current = userId
  const mounted = useRef(true)
  const currentSettings = useRef(settings)
  currentSettings.current = settings
  const [interacEmail, setInteracEmail] = useState<string | null>(null)
  const [interacDraft, setInteracDraft] = useState('')
  const [interacVerified, setInteracVerified] = useState(false)
  const [interacBusy, setInteracBusy] = useState(false)
  const [interacError, setInteracError] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (
      settings &&
      new URLSearchParams(window.location.search).get('focus') ===
        'payments-payouts'
    ) {
      document
        .getElementById('payments-payouts')
        ?.scrollIntoView({ block: 'start' })
    }
  }, [settings])
  useEffect(() => {
    setSurface(null)
    setReconcileErrors({ payment_method: '', payout_account: '' })
    setIdentityVerification('not_available')
    setInteracEmail(null)
    setInteracDraft('')
    setInteracVerified(false)
    setInteracError('')
  }, [userId])
  useEffect(() => {
    if (!settings || !userId) return undefined
    let active = true
    fetch('/api/interac/settings', { credentials: 'same-origin' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok)
          throw new Error(body.error || 'Unable to load Interac settings.')
        if (active) {
          setInteracEmail(body.receivingEmail || null)
          setInteracDraft(body.accountEmail || body.receivingEmail || '')
          setInteracVerified(Boolean(body.verified))
        }
      })
      .catch((error) => {
        if (active)
          setInteracError(
            error instanceof Error
              ? error.message
              : 'Unable to load Interac settings.'
          )
      })
    return () => {
      active = false
    }
  }, [settings, userId])
  const saveInterac = async (value = interacDraft) => {
    setInteracBusy(true)
    setInteracError('')
    try {
      const response = await fetch('/api/interac/settings', {
        method: value.trim() ? 'PUT' : 'DELETE',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Marketplace-Request': '1',
        },
        body: JSON.stringify({ receivingEmail: value }),
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Unable to save Interac settings.')
      setInteracEmail(body.receivingEmail || null)
      setInteracDraft(body.receivingEmail || '')
      setInteracVerified(Boolean(body.verified))
    } catch (error) {
      setInteracError(
        error instanceof Error
          ? error.message
          : 'Unable to save Interac settings.'
      )
    } finally {
      setInteracBusy(false)
    }
  }
  useEffect(() => {
    if (!settings || !userId || !stripeSetupAvailable()) return undefined
    const lifecycle = { active: true }
    const running = new Set<Capability>()
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    const url = new URL(window.location.href)
    const returning = url.searchParams.has('stripe_return')
    if (returning) {
      for (const key of [
        'stripe_return',
        'setup_intent',
        'setup_intent_client_secret',
        'redirect_status',
      ])
        url.searchParams.delete(key)
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash
      )
    }
    const reconcile = (showPersistentError: boolean) => {
      for (const kind of ['payment_method', 'payout_account'] as const) {
        if (running.has(kind)) continue
        running.add(kind)
        marketplaceRequest<{
          identityVerification?: StripeIdentityVerification
        }>('/api/stripe/reconcile', 'POST', { kind })
          .then((result) => {
            if (lifecycle.active) {
              if (kind === 'payout_account')
                setIdentityVerification(
                  result.identityVerification?.status || 'not_available'
                )
              setReconcileErrors((current) => ({ ...current, [kind]: '' }))
              refresh().catch(() => {})
            }
          })
          .catch(() => {
            // A Stripe login/identity popup can transfer focus several times
            // while its Account Session is still settling. Keep that transient
            // failure local to the embedded flow instead of replacing the
            // Settings status with a durable-looking error.
            if (lifecycle.active && showPersistentError) {
              setReconcileErrors((current) => ({
                ...current,
                [kind]:
                  'Unable to refresh this setup. Return to Settings to retry.',
              }))
            }
          })
          .finally(() => running.delete(kind))
      }
    }
    const onFocus = () => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => reconcile(false), 750)
    }
    reconcile(true)
    window.addEventListener('focus', onFocus)
    return () => {
      lifecycle.active = false
      if (focusTimer) clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
    }
  }, [settings, userId, refresh])
  const close = useCallback(() => setSurface(null), [])
  const handleCardComplete = useCallback(async () => {
    await refresh()
    window.dispatchEvent(new Event('marketplace-financial-changed'))
    setSurface(null)
  }, [refresh])
  const handlePayoutComplete = useCallback(async () => {
    await refresh()
    close()
  }, [close, refresh])
  const activeSurface = surface ?? renderedSurface
  const payment = activeSurface === 'payment_method'
  const paymentMode = data?.paymentMethod.status === 'set' ? 'change' : 'setup'
  const paymentTitle =
    paymentMode === 'change' ? 'Change payment method' : 'Set up payment method'
  const payoutMode =
    data?.payoutAccount.status === 'ready' ? 'management' : 'onboarding'
  return (
    <section
      id="payments-payouts"
      className={financialStyles.section}
      aria-label="Payments & payouts"
      aria-busy={loading}
    >
      <header className={styles.panelHeader}>
        <h3>Payments &amp; payouts</h3>
      </header>
      {settings && (
        <section
          className={financialStyles.setupSection}
          aria-label="Interac e-Transfer"
          data-financial-capability="interac_etransfer"
        >
          <div className={financialStyles.sectionHeading}>
            <h4>Interac e-Transfer</h4>
            <p className={styles.caption}>
              Use your verified email address to receive Interac e-Transfers.
              Make sure this email is registered with your bank. UU cannot
              verify bank deposits.
            </p>
          </div>
          <label
            className={styles.fieldLabel}
            htmlFor="interac-receiving-email"
          >
            Receiving email
          </label>
          <input
            id="interac-receiving-email"
            type="email"
            autoComplete="email"
            value={interacDraft}
            readOnly
            disabled={interacBusy}
            aria-describedby={
              interacError ? 'interac-settings-error' : undefined
            }
          />
          <div className={financialStyles.actionRow}>
            <StatefulButton
              className={financialStyles.setupAction}
              disabled={interacBusy}
              onClick={() => void saveInterac()}
            >
              {interacBusy ? 'Saving…' : interacEmail ? 'Save changes' : 'Save'}
            </StatefulButton>
            {interacEmail && (
              <button
                type="button"
                onClick={() => {
                  setInteracDraft('')
                  void saveInterac('')
                }}
              >
                Remove
              </button>
            )}
          </div>
          {interacDraft && (
            <p className={styles.caption} role="status">
              {interacVerified
                ? 'Receiving email verified.'
                : 'Receiving email pending ownership verification.'}
            </p>
          )}
          {interacError && (
            <p
              id="interac-settings-error"
              className={styles.error}
              role="alert"
            >
              {interacError}{' '}
              <button type="button" onClick={() => setInteracError('')}>
                Dismiss
              </button>
            </p>
          )}
        </section>
      )}
      {(['payment_method', 'payout_account'] as const).map((capability) => {
        const isPayment = capability === 'payment_method'
        const value = isPayment ? data?.paymentMethod : data?.payoutAccount
        const display = isPayment
          ? data?.paymentMethod.brand
          : data?.payoutAccount.institution
        if (settings && !loading && value) {
          const summary =
            value.status !== 'unset' && (display || value.last4)
              ? `${display || (isPayment ? 'Payment method' : 'Bank account')}${
                  value.last4 ? ` •••• ${value.last4}` : ''
                }`
              : undefined
          return (
            <FinancialCapabilitySection
              key={capability}
              capability={capability}
              status={value.status}
              summary={summary}
              verificationStatus={
                capability === 'payout_account' && value.status !== 'unset'
                  ? reconcileErrors.payout_account
                    ? 'refresh_failed'
                    : identityVerification
                  : undefined
              }
              action={{
                onStart: () => {
                  setRenderedSurface(capability)
                  setSurface(capability)
                },
                error: reconcileErrors[capability],
              }}
            />
          )
        }
        return (
          <div
            className={`${styles.accountRow} ${financialStyles.row}`}
            key={capability}
            data-financial-capability={capability}
          >
            <div>
              <span className={styles.fieldLabel}>
                {isPayment ? 'Payment method' : 'Payout account'}
              </span>
            </div>
            {loading && (
              <Skeleton
                className={
                  settings ? styles.actionSkeleton : styles.badgeSkeleton
                }
              />
            )}
            {!loading && !settings && (
              <span
                className={
                  value?.status === 'set' || value?.status === 'ready'
                    ? styles.verified
                    : styles.readOnly
                }
              >
                {value ? labels[value.status] : 'Unavailable'}
              </span>
            )}
          </div>
        )
      })}
      {error && (
        <p className={styles.error} role="alert">
          {error}{' '}
          <button type="button" onClick={() => refresh().catch(() => {})}>
            Retry
          </button>
        </p>
      )}
      {!settings && onManage && (
        <button
          type="button"
          className={financialStyles.link}
          onClick={onManage}
        >
          Manage in Settings
        </button>
      )}
      <AnimatePresence>
        {settings && (
          <StripeFlowPanel
            open={surface !== null}
            title={payment ? paymentTitle : 'Set up payouts'}
            description={
              payment
                ? 'Your payment information is securely handled by Stripe.'
                : 'Secure verification powered by Stripe.'
            }
            onClose={close}
            onExitComplete={() => setRenderedSurface(null)}
            confirmClose={!payment && payoutMode === 'onboarding'}
            preventScrimClose={!payment && payoutMode === 'onboarding'}
          >
            {activeSurface && payment ? (
              <StripeCardSetup
                mode={paymentMode}
                preview={<CardFormPreview />}
                onCancel={close}
                onComplete={handleCardComplete}
              />
            ) : activeSurface ? (
              <StripeAccountOnboarding
                onComplete={handlePayoutComplete}
                onCancel={close}
                mode={payoutMode}
              />
            ) : null}
          </StripeFlowPanel>
        )}
      </AnimatePresence>
    </section>
  )
}

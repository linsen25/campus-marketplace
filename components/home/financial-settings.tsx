import { AnimatePresence } from 'framer-motion'
import {
  CalendarDays,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Globe,
  UserRound,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import sortStyles from '@/components/filter-interaction.module.css'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { marketplaceRequest } from '@/lib/listings-api'

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
type SetupAction = { pending?: boolean; error?: string; onStart: () => unknown }

// Each section owns its action presentation. Phase 1B can provide independent
// pending/error state and a real async onStart without changing this layout.
export function FinancialCapabilitySection({
  capability,
  status,
  summary,
  action,
}: {
  capability: Capability
  status: keyof typeof labels
  summary?: string
  action: SetupAction
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
  const [payoutPending, setPayoutPending] = useState(false)
  const [payoutError, setPayoutError] = useState('')
  const [reconcileErrors, setReconcileErrors] = useState<
    Record<Capability, string>
  >({ payment_method: '', payout_account: '' })
  const currentOwner = useRef(userId)
  currentOwner.current = userId
  const mounted = useRef(true)
  const currentSettings = useRef(settings)
  currentSettings.current = settings
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const titleId = useId()
  const descriptionId = useId()
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
    setPayoutError('')
    setPayoutPending(false)
    setReconcileErrors({ payment_method: '', payout_account: '' })
  }, [userId])
  useEffect(() => {
    if (!settings || !userId || !stripeSetupAvailable()) return undefined
    const lifecycle = { active: true }
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
    const reconcile = () => {
      for (const kind of ['payment_method', 'payout_account'] as const)
        marketplaceRequest('/api/stripe/reconcile', 'POST', { kind })
          .then(() => {
            if (lifecycle.active) {
              setReconcileErrors((current) => ({ ...current, [kind]: '' }))
              refresh().catch(() => {})
            }
          })
          .catch(() => {
            if (lifecycle.active)
              setReconcileErrors((current) => ({
                ...current,
                [kind]:
                  'Unable to refresh this setup. Return to Settings to retry.',
              }))
          })
    }
    reconcile()
    window.addEventListener('focus', reconcile)
    return () => {
      lifecycle.active = false
      window.removeEventListener('focus', reconcile)
    }
  }, [settings, userId, refresh])
  const handleCardComplete = async () => {
    await refresh()
    window.dispatchEvent(new Event('marketplace-financial-changed'))
    setSurface(null)
  }
  const handlePayoutContinue = async () => {
    if (payoutPending) return
    setPayoutPending(true)
    setPayoutError('')
    const owner = userId
    try {
      const result = await marketplaceRequest<{ url: string }>(
        '/api/stripe/payout-setup',
        'POST',
        {}
      )
      if (
        !mounted.current ||
        !currentSettings.current ||
        currentOwner.current !== owner
      )
        return
      const destination = new URL(result.url)
      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== 'connect.stripe.com'
      )
        throw Error('Invalid setup link')
      window.location.assign(destination.href)
    } catch {
      if (mounted.current && currentOwner.current === owner)
        setPayoutError('Unable to start payout setup. Please try again.')
    } finally {
      if (mounted.current && currentOwner.current === owner)
        setPayoutPending(false)
    }
  }
  const payment = surface === 'payment_method'
  const paymentMode = data?.paymentMethod.status === 'set' ? 'change' : 'setup'
  const paymentTitle =
    paymentMode === 'change' ? 'Change payment method' : 'Set up payment method'
  const close = () => {
    if (!payoutPending) setSurface(null)
  }
  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDialogElement>
  ) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'iframe:not([tabindex="-1"]), button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
      )
    ).filter(
      (control) =>
        control.getBoundingClientRect().height > 0 &&
        getComputedStyle(control).visibility !== 'hidden'
    )
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (
      (!event.shiftKey && document.activeElement === last) ||
      (event.shiftKey && document.activeElement === first)
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  }
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
              action={{
                onStart: () => setSurface(capability),
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
        {settings && surface && (
          <FadingDialog
            className={`${styles.dialog} ${financialStyles.setupDialog} ${
              payment ? financialStyles.paymentDialog : ''
            }`}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onRequestClose={close}
            onKeyDownCapture={handleDialogKeyDown}
          >
            <h3 id={titleId}>
              {payment ? paymentTitle : 'Continue to Stripe'}
            </h3>
            <p id={descriptionId}>
              {payment
                ? 'Your payment information will be securely handled by Stripe.'
                : "Stripe securely handles your payout account and verification details. You'll return to Usual & Unusual when you're done."}
            </p>
            {payment ? (
              <StripeCardSetup
                mode={paymentMode}
                preview={<CardFormPreview />}
                onCancel={close}
                onComplete={handleCardComplete}
              />
            ) : (
              <>
                {payoutError && (
                  <p className={styles.error} role="alert">
                    {payoutError}
                  </p>
                )}
                <div className={financialStyles.actions}>
                  <DynamicAction
                    variant="red"
                    showArrow={false}
                    disabled={payoutPending}
                    onClick={close}
                  >
                    Cancel
                  </DynamicAction>
                  <DynamicAction
                    variant="green"
                    disabled={!stripeSetupAvailable() || payoutPending}
                    onClick={handlePayoutContinue}
                  >
                    Continue
                  </DynamicAction>
                </div>
              </>
            )}
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}

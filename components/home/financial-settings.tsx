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
import { X } from 'lucide-react'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { DialogActions } from '@/components/ui/dialog-actions'
import sortStyles from '@/components/filter-interaction.module.css'
import ShiningButton from '@/components/animata/button/shining-button'
import { ActionRow } from '@/components/ui/action-row'
import { Skeleton } from '@/components/ui/skeleton'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { marketplaceRequest } from '@/lib/listings-api'

import financialStyles from './financial-settings.module.css'
import styles from './profile.module.css'
import { ProfileStatus } from './profile-status'
import type { ProfileStatusTone } from './profile-status'
import { StripeCardSetup, stripeSetupAvailable } from './stripe-card-setup'

const labels = {
  unset: 'Unset',
  set: 'Set',
  ready: 'Ready',
  needs_attention: 'Needs attention',
}

type Capability = 'payment_method' | 'payout_account'
type SetupAction = { pending?: boolean; error?: string; onStart: () => unknown }
type InteracSettings = { receivingEmail: string | null; verified: boolean }

function capabilityTitle(capability: Capability) {
  return capability === 'payment_method'
    ? 'Stripe payment method'
    : 'Stripe payouts'
}

function capabilityDescription(capability: Capability) {
  return capability === 'payment_method'
    ? 'For secure UU purchases'
    : 'For receiving eligible seller payouts'
}

function capabilityState(
  status: keyof typeof labels | undefined,
  failed: boolean
) {
  if (failed)
    return {
      label: 'Unable to load',
      tone: 'error' as ProfileStatusTone,
    }
  if (status === 'set' || status === 'ready')
    return { label: 'Configured', tone: 'success' as ProfileStatusTone }
  if (status === 'needs_attention')
    return {
      label: 'Action required',
      tone: 'warning' as ProfileStatusTone,
    }
  return { label: 'Not set up', tone: 'warning' as ProfileStatusTone }
}

function CapabilityAction({
  configured,
  failed,
  pending,
  onClick,
}: {
  configured: boolean
  failed: boolean
  pending?: boolean
  onClick: () => unknown
}) {
  const outline = configured || failed
  return (
    <span className={financialStyles.setupAction}>
      <ShiningButton
        variant={outline ? 'outline' : 'purple'}
        size="compact"
        showArrow={false}
        disabled={pending}
        loading={pending}
        onClick={() => void onClick()}
      >
        {failed ? 'Retry' : configured ? 'Manage' : 'Set up'}
      </ShiningButton>
    </span>
  )
}

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
  const ready = status === 'set' || status === 'ready'
  const attention = status === 'needs_attention'
  const failed = Boolean(action.error)
  const title = capabilityTitle(capability)
  const state = capabilityState(status, failed)
  const handleStart = () => action.onStart()
  return (
    <section
      className={financialStyles.setupSection}
      aria-label={title}
      data-financial-capability={capability}
    >
      <div className={financialStyles.serviceIcon} aria-hidden="true">
        {capability === 'payment_method' ? (
          <img
            className={financialStyles.brandIllustration}
            src="/static/images/create-product/shop-payment-stripe.png"
            alt=""
            width={40}
            height={40}
          />
        ) : (
          <img
            className={financialStyles.brandIllustration}
            src="/static/images/create-product/shop-payment-stripe.png"
            alt=""
            width={40}
            height={40}
          />
        )}
      </div>
      <div className={financialStyles.sectionHeading}>
        <h4>{title}</h4>
        <p className={financialStyles.serviceDescription}>
          {capabilityDescription(capability)}
        </p>
        {summary && <p className={financialStyles.summary}>{summary}</p>}
        <ProfileStatus tone={state.tone} alert={failed}>
          {state.label}
        </ProfileStatus>
      </div>
      <CapabilityAction
        configured={ready && !attention}
        failed={failed}
        pending={action.pending}
        onClick={handleStart}
      />
    </section>
  )
}

function InteracReceivingEmail({
  userId,
  settings,
  onManage,
}: {
  userId?: string | null
  settings: boolean
  onManage?: () => void
}) {
  const [data, setData] = useState<InteracSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const inputId = useId()
  const errorId = useId()
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await marketplaceRequest<InteracSettings>(
        '/api/interac/settings',
        'GET'
      )
      setData({
        receivingEmail: result.receivingEmail || null,
        verified: result.verified === true,
      })
    } catch {
      setData(null)
      setError('Unable to load e-Transfer settings.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!userId) return undefined
    let active = true
    void load().then(() => {
      if (!active) return
    })
    return () => {
      active = false
    }
  }, [load, userId])
  useEffect(() => {
    setOpen(false)
    setDraft('')
  }, [userId])
  const configured = Boolean(data?.receivingEmail)
  const openDialog = () => {
    setDraft(data?.receivingEmail || '')
    setError('')
    setOpen(true)
  }
  const save = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = await marketplaceRequest<InteracSettings>(
        '/api/interac/settings',
        'PUT',
        { receivingEmail: draft }
      )
      setData({
        receivingEmail: result.receivingEmail || null,
        verified: result.verified === true,
      })
      setOpen(false)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to save e-Transfer settings.'
      )
    } finally {
      setSaving(false)
    }
  }
  let status: { label: string; tone: ProfileStatusTone } = {
    label: 'Not set up',
    tone: 'warning',
  }
  if (error) status = { label: 'Unable to load', tone: 'error' }
  else if (configured && data?.verified)
    status = { label: 'Verified for orders', tone: 'success' }
  else if (configured)
    status = { label: 'Email needs verification', tone: 'warning' }
  return (
    <>
      <section
        className={financialStyles.setupSection}
        aria-label="Interac e-Transfer email"
        data-financial-capability="interac_etransfer"
        aria-busy={loading}
      >
        <div className={financialStyles.serviceIcon} aria-hidden="true">
          <img
            className={financialStyles.brandIllustration}
            src="/static/images/create-product/shop-payment-interac.png"
            alt=""
            width={40}
            height={40}
          />
        </div>
        <div className={financialStyles.sectionHeading}>
          <h4>Interac e-Transfer email</h4>
          <p className={financialStyles.serviceDescription}>
            For receiving direct Interac e-Transfers
          </p>
          {configured && (
            <p className={financialStyles.summary}>{data?.receivingEmail}</p>
          )}
          {!loading && (
            <ProfileStatus tone={status.tone}>{status.label}</ProfileStatus>
          )}
        </div>
        {loading ? (
          <Skeleton className={styles.actionSkeleton} />
        ) : (
          <span className={financialStyles.setupAction}>
            <ShiningButton
              variant={error || configured ? 'outline' : 'purple'}
              size="compact"
              showArrow={false}
              onClick={
                error
                  ? () => void load()
                  : settings
                  ? openDialog
                  : () => onManage?.()
              }
            >
              {error
                ? 'Retry'
                : configured
                ? settings
                  ? 'Change'
                  : 'Manage'
                : 'Set up'}
            </ShiningButton>
          </span>
        )}
      </section>
      <AnimatePresence>
        {open && (
          <FadingDialog
            className={`${styles.dialog} ${financialStyles.setupDialog}`}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onRequestClose={() => !saving && setOpen(false)}
          >
            <h3 id={titleId}>Set up e-Transfer email</h3>
            <p id={descriptionId}>
              This email is used to receive direct Interac e-Transfers from
              buyers. Saving it does not confirm a bank deposit.
            </p>
            <label className={styles.fieldLabel} htmlFor={inputId}>
              Receiving email
            </label>
            <input
              id={inputId}
              className={financialStyles.interacInput}
              type="email"
              autoComplete="email"
              value={draft}
              disabled={saving}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            {error && (
              <p id={errorId} className={styles.error} role="alert">
                {error}
              </p>
            )}
            <DialogActions>
              <span>
                <ShiningButton
                  variant="red"
                  size="compact"
                  showArrow={false}
                  disabled={saving}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </ShiningButton>
              </span>
              <span>
                <ShiningButton
                  variant="green"
                  size="compact"
                  showArrow={false}
                  disabled={saving || !draft.trim()}
                  loading={saving}
                  onClick={() => void save()}
                >
                  Save
                </ShiningButton>
              </span>
            </DialogActions>
          </FadingDialog>
        )}
      </AnimatePresence>
    </>
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
  focusToken = 0,
}: {
  settings: boolean
  onManage?: () => void
  focusToken?: number
}) {
  const { data, error, refresh, loading, userId } = useFinancialCapabilities()
  const [surface, setSurface] = useState<Capability | null>(null)
  const [showPaymentInfo, setShowPaymentInfo] = useState(false)
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
      (focusToken > 0 ||
        new URLSearchParams(window.location.search).get('focus') ===
          'payments-payouts')
    ) {
      document
        .getElementById('payments-payouts')
        ?.scrollIntoView({ block: 'start' })
    }
  }, [focusToken, settings])
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
      aria-label="Payment & transfer setup"
      aria-busy={loading}
    >
      <header className={`${styles.panelHeader} ${financialStyles.infoHeader}`}>
        <h3>Payment &amp; transfer setup</h3>
        <button
          type="button"
          className={financialStyles.infoButton}
          aria-label="About payment and transfer setup"
          onClick={() => setShowPaymentInfo(true)}
        >
          <CircleHelp size={20} aria-hidden="true" />
        </button>
      </header>
      {showPaymentInfo && (
        <FadingDialog
          className={`${styles.dialog} ${financialStyles.infoDialog}`}
          aria-label="About payment and transfer setup"
          onRequestClose={() => setShowPaymentInfo(false)}
        >
          <button
            type="button"
            className={financialStyles.infoClose}
            aria-label="Close information"
            onClick={() => setShowPaymentInfo(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <h3>About payment &amp; transfer setup</h3>
          <div className={financialStyles.infoBody}>
            <p>
              Manage how you pay for purchases and receive money from sales.
            </p>
            <div>
              <h4>Stripe payment method</h4>
              <p>
                Save a payment method for eligible UU purchases. Setup does not
                charge you immediately.
              </p>
            </div>
            <div>
              <h4>Stripe payouts</h4>
              <p>
                Set up a separate seller payout account for eligible UU Pay
                proceeds. Stripe may require identity and bank account
                verification.
              </p>
            </div>
            <div>
              <h4>Interac e-Transfer email</h4>
              <p>
                Set an email for receiving direct Interac e-Transfers. Saving it
                does not enable bank Autodeposit or confirm payment.
              </p>
            </div>
            <p>
              Buying and receiving seller payouts are separate payment flows.
            </p>
          </div>
        </FadingDialog>
      )}
      {(['payment_method', 'payout_account'] as const).map((capability) => {
        const isPayment = capability === 'payment_method'
        const value = isPayment ? data?.paymentMethod : data?.payoutAccount
        const display = isPayment
          ? data?.paymentMethod.brand
          : data?.payoutAccount.institution
        const capabilityError = error || reconcileErrors[capability]
        if (!loading) {
          const summary =
            value && value.status !== 'unset' && (display || value.last4)
              ? `${display || (isPayment ? 'Payment method' : 'Bank account')}${
                  value.last4 ? ` 閳モ懇鈧懇鈧懇鈧?${value.last4}` : ''
                }`
              : undefined
          return (
            <FinancialCapabilitySection
              key={capability}
              capability={capability}
              status={value?.status || 'unset'}
              summary={settings ? summary : undefined}
              action={{
                onStart: () => {
                  if (!settings) {
                    onManage?.()
                    return
                  }
                  if (capabilityError) return refresh()
                  setSurface(capability)
                },
                error: capabilityError,
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
                {capabilityTitle(capability)}
              </span>
            </div>
            {loading && (
              <Skeleton
                className={
                  settings ? styles.actionSkeleton : styles.badgeSkeleton
                }
              />
            )}
          </div>
        )
      })}
      <InteracReceivingEmail
        userId={userId}
        settings={settings}
        onManage={onManage}
      />
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
                <ActionRow align="between" compactBetween>
                  <span>
                    <ShiningButton
                      variant="red"
                      size="compact"
                      showArrow={false}
                      disabled={payoutPending}
                      onClick={close}
                    >
                      Cancel
                    </ShiningButton>
                  </span>
                  <span>
                    <ShiningButton
                      variant="green"
                      size="compact"
                      showArrow={false}
                      disabled={!stripeSetupAvailable() || payoutPending}
                      loading={payoutPending}
                      onClick={() => void handlePayoutContinue()}
                    >
                      Continue
                    </ShiningButton>
                  </span>
                </ActionRow>
              </>
            )}
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}

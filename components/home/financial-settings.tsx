import { useEffect, useRef, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { marketplaceRequest } from '@/lib/listings-api'

import financialStyles from './financial-settings.module.css'
import styles from './profile.module.css'

const labels = {
  unset: 'Unset',
  set: 'Set',
  ready: 'Ready',
  needs_attention: 'Needs attention',
}
export function FinancialSettings({
  settings,
  onManage,
}: {
  settings: boolean
  onManage?: () => void
}) {
  const { data, error, refresh, loading } = useFinancialCapabilities()
  const [pending, setPending] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const busy = useRef(false)
  const staging =
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
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
  async function change(capability: string, status: string) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setMutationError('')
    try {
      await marketplaceRequest(
        '/api/financial-capabilities/test-state',
        'POST',
        { capability, status }
      )
      await refresh()
      window.dispatchEvent(new Event('marketplace-financial-changed'))
    } catch {
      setMutationError('Unable to update test state. Please retry.')
      throw new Error('Test state update failed.')
    } finally {
      busy.current = false
      setPending(false)
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
        const payment = capability === 'payment_method'
        const value = payment ? data?.paymentMethod : data?.payoutAccount
        const display = payment
          ? data?.paymentMethod.brand
          : data?.payoutAccount.institution
        return (
          <div
            className={`${styles.accountRow} ${financialStyles.row}`}
            key={capability}
            data-financial-capability={capability}
          >
            <div>
              <span className={styles.fieldLabel}>
                {payment ? 'Payment method' : 'Payout account'}
              </span>
              {settings && (
                <p className={styles.caption}>
                  {payment
                    ? 'Used when you purchase an item.'
                    : 'Used to receive money when you sell an item.'}
                </p>
              )}
              {settings &&
                value &&
                value.status !== 'unset' &&
                (display || value.last4) && (
                  <p>
                    {display}
                    {value.last4 ? ` •••• ${value.last4}` : ''}
                  </p>
                )}
              {settings && value?.status === 'needs_attention' && (
                <p className={styles.caption}>
                  This capability needs attention before it can be used.
                </p>
              )}
            </div>
            {loading ? (
              <Skeleton className={styles.badgeSkeleton} />
            ) : (
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
      {settings && staging && (
        <aside
          className={financialStyles.testControls}
          aria-label="Staging financial test controls"
        >
          <strong>STAGING ONLY</strong>
          <p className={styles.caption}>
            Test states only. This is not real financial onboarding.
          </p>
          {(['payment_method', 'payout_account'] as const).map((capability) => (
            <div key={capability}>
              <p>
                {capability === 'payment_method'
                  ? 'Payment method test state'
                  : 'Payout account test state'}
              </p>
              <div className={financialStyles.actions}>
                {[
                  capability === 'payment_method' ? 'set' : 'ready',
                  'needs_attention',
                  'unset',
                ].map((status) => (
                  <StatefulButton
                    key={status}
                    disabled={pending || !data}
                    onClick={() => change(capability, status)}
                  >
                    {status === 'unset'
                      ? 'Clear'
                      : `Simulate ${labels[status as keyof typeof labels]}`}
                  </StatefulButton>
                ))}
              </div>
            </div>
          ))}
          {mutationError && (
            <p className={styles.error} role="alert">
              {mutationError}
            </p>
          )}
        </aside>
      )}
    </section>
  )
}

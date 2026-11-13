import { useCallback, useEffect, useRef, useState } from 'react'

import { StatefulButton } from '@/components/velora/stateful-button'
import { marketplaceRequest } from '@/lib/listings-api'

import styles from './profile.module.css'

export function UwoEmailVerification() {
  const [verified, setVerified] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const result = await marketplaceRequest<{ verified: boolean }>(
        '/api/profile/uwo-verification',
        'GET'
      )
      if (current === generation.current) setVerified(result.verified)
    } catch (reason) {
      if (current === generation.current) {
        setVerified(null)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to load UWO verification status.'
        )
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  async function send() {
    if (busy || loading) return
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'send',
        email,
      })
      if (current === generation.current) setSent(true)
    } catch (reason) {
      if (current === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to send verification code.'
        )
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  async function verify() {
    if (busy || loading) return
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'verify',
        code,
      })
      if (current === generation.current) {
        setVerified(true)
        setSent(false)
        setCode('')
      }
    } catch (reason) {
      if (current === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to verify UWO email.'
        )
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  return (
    <section className={styles.accountRow} aria-label="UWO Email Verification">
      <div>
        <span className={styles.fieldLabel}>UWO identity</span>
        <p>
          {loading
            ? 'Loading verification status...'
            : verified
            ? 'UWO email verified'
            : 'Optional UWO email verification'}
        </p>
      </div>
      <div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!loading && verified === false && !sent && (
          <>
            <label className={styles.fieldLabel} htmlFor="uwo-email">
              UWO email
            </label>
            <input
              id="uwo-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@uwo.ca"
              autoComplete="email"
              disabled={busy}
            />
            <StatefulButton disabled={busy} onClick={() => void send()}>
              {busy ? 'Sending...' : 'Send code'}
            </StatefulButton>
          </>
        )}
        {!loading && verified === false && sent && (
          <>
            <label
              className={styles.fieldLabel}
              htmlFor="uwo-verification-code"
            >
              Verification code
            </label>
            <input
              id="uwo-verification-code"
              inputMode="numeric"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              autoComplete="one-time-code"
              disabled={busy}
            />
            <StatefulButton
              disabled={busy || code.length !== 6}
              onClick={() => void verify()}
            >
              {busy ? 'Verifying...' : 'Verify UWO email'}
            </StatefulButton>
          </>
        )}
        {error && (
          <StatefulButton
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Retry
          </StatefulButton>
        )}
      </div>
    </section>
  )
}

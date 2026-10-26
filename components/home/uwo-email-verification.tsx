import { useCallback, useEffect, useRef, useState } from 'react'

import { StatefulButton } from '@/components/velora/stateful-button'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { marketplaceRequest } from '@/lib/listings-api'

export function UwoEmailVerification() {
  const { seller } = useMarketplaceSession()
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
    generation.current++
    const effectGeneration = generation.current
    setVerified(null)
    setError('')
    setEmail('')
    setSent(false)
    setCode('')
    void load()
    return () => {
      if (generation.current === effectGeneration)
        generation.current = effectGeneration + 1
    }
  }, [load, seller?.id])
  async function send() {
    if (busy || loading) return
    const operationGeneration = generation.current
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'send',
        email,
      })
      if (operationGeneration === generation.current) setSent(true)
    } catch (reason) {
      if (operationGeneration === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to send verification code.'
        )
    } finally {
      if (operationGeneration === generation.current) setBusy(false)
    }
  }
  async function verify() {
    if (busy || loading) return
    const operationGeneration = generation.current
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'verify',
        code,
      })
      if (operationGeneration === generation.current) {
        setVerified(true)
        setSent(false)
        setCode('')
      }
    } catch (reason) {
      if (operationGeneration === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to verify UWO email.'
        )
    } finally {
      if (operationGeneration === generation.current) setBusy(false)
    }
  }
  return (
    <section aria-label="UWO Email Verification">
      <div>
        <span>UWO Email Verified</span>
        <p>
          {loading
            ? 'Loading verification status...'
            : verified === true
            ? 'Verified'
            : 'Optional identity confirmation'}
        </p>
      </div>
      {error && (
        <div>
          <p role="alert">{error}</p>
          <StatefulButton disabled={busy || loading} onClick={load}>
            Retry
          </StatefulButton>
        </div>
      )}
      {!loading && verified === false && !error && (
        <>
          {!sent ? (
            <>
              <label>
                UWO email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@uwo.ca"
                  autoComplete="email"
                />
              </label>
              <StatefulButton disabled={busy} onClick={send}>
                {busy ? 'Sending...' : 'Send verification code'}
              </StatefulButton>
            </>
          ) : (
            <>
              <StatefulButton
                disabled={busy}
                onClick={() => {
                  setSent(false)
                  setCode('')
                  setError('')
                }}
              >
                Change UWO email
              </StatefulButton>
              <StatefulButton disabled={busy} onClick={send}>
                {busy ? 'Sending...' : 'Resend verification code'}
              </StatefulButton>
              <label>
                Verification code
                <input
                  inputMode="numeric"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  autoComplete="one-time-code"
                />
              </label>
              <StatefulButton
                disabled={busy || code.length !== 6}
                onClick={verify}
              >
                {busy ? 'Verifying...' : 'Verify UWO email'}
              </StatefulButton>
            </>
          )}
        </>
      )}
    </section>
  )
}

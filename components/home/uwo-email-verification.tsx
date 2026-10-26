import { useEffect, useState } from 'react'

import { StatefulButton } from '@/components/velora/stateful-button'
import { marketplaceRequest } from '@/lib/listings-api'

export function UwoEmailVerification() {
  const [verified, setVerified] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    marketplaceRequest<{ verified: boolean }>(
      '/api/profile/uwo-verification',
      'GET'
    )
      .then((result) => setVerified(result.verified))
      .catch(() => setVerified(null))
  }, [])
  async function send() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'send',
        email,
      })
      setSent(true)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to send verification code.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await marketplaceRequest('/api/profile/uwo-verification', 'POST', {
        action: 'verify',
        code,
      })
      setVerified(true)
      setSent(false)
      setCode('')
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to verify UWO email.'
      )
    } finally {
      setBusy(false)
    }
  }
  if (verified === null) return null
  return (
    <section aria-label="UWO Email Verification">
      <div>
        <span>UWO Email Verified</span>
        <p>{verified ? 'Verified' : 'Optional identity confirmation'}</p>
      </div>
      {!verified && (
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
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

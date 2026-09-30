import Head from 'next/head'
import { useRouter } from 'next/router'
import type { FormEvent } from 'react'
import { useCallback, useState } from 'react'

import { Container } from '@/components/container/container'
import { BackButton } from '@/components/listings/back-button'
import { marketplaceRequest } from '@/lib/listings-api'
import { isWesternEmail, safeMarketplaceNext } from '@/lib/marketplace-auth'
import { Input } from '@ui/input/input'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setError('')
      setBusy(true)
      try {
        if (!isWesternEmail(email))
          throw new Error('Use an email address ending in @uwo.ca.')
        if (sent) {
          await marketplaceRequest('/api/auth/verify', 'POST', {
            email,
            code: String(data.get('code') || '').trim(),
          })
          window.location.assign(safeMarketplaceNext(router.query.next))
        } else {
          await marketplaceRequest('/api/auth/email', 'POST', {
            email,
            displayName: String(data.get('displayName') || ''),
          })
          setSent(true)
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Sign in failed.')
      } finally {
        setBusy(false)
      }
    },
    [email, sent, router.query.next]
  )
  return (
    <>
      <Head>
        <title>Sign In | Campus Marketplace</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <BackButton href="/listings" />
            <h1 className="text-2xl font-bold">Sign In</h1>
            <p>
              Use your @uwo.ca email to receive a sign-in code. Email
              verification does not verify current student status.
            </p>
            <form className="flex max-w-lg flex-col gap-4" onSubmit={submit}>
              {error && <p role="alert">{error}</p>}
              <label className="flex flex-col gap-2">
                <span>Email</span>
                <Input
                  type="email"
                  name="email"
                  required={true}
                  autoComplete="email"
                  value={email}
                  disabled={sent || busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              {sent ? (
                <>
                  <p role="status">Check your inbox for a code.</p>
                  <label className="flex flex-col gap-2">
                    <span>Email code</span>
                    <Input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required={true}
                      pattern="[0-9]{6,10}"
                      maxLength={10}
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="button"
                    className="underline text-left"
                    disabled={busy}
                    onClick={() => {
                      setSent(false)
                      setError('')
                    }}
                  >
                    Change email or request another code
                  </button>
                </>
              ) : (
                <label className="flex flex-col gap-2">
                  <span>Display name (for new accounts)</span>
                  <Input
                    name="displayName"
                    maxLength={60}
                    autoComplete="nickname"
                    disabled={busy}
                  />
                  <span className="text-sm text-neutral-dark">
                    Shown on listings. Your email is not shown.
                  </span>
                </label>
              )}
              <button
                type="submit"
                className="btn btn-primary btn-small"
                disabled={busy}
              >
                {sent ? 'Verify and sign in' : 'Send sign-in code'}
              </button>
            </form>
          </div>
        </Container>
      </main>
    </>
  )
}

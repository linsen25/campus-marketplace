import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { findConversation } from '@/lib/messages-api'

import { useMarketplaceSession } from './marketplace-session'

/** Resume this exact listing after the existing Western sign-in flow. */
export function useMessageSeller(listingId: string) {
  const { seller } = useMarketplaceSession()
  const { openAuth } = useAuthModal()
  const router = useRouter()
  const pending = useRef(false)
  const running = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current = false
    }
  }, [])
  async function contact() {
    if (running.current) return
    if (!seller) {
      pending.current = true
      openAuth({
        mode: 'signin',
        intent: 'contact-seller',
        onDismiss: () => {
          pending.current = false
        },
      })
      return
    }
    pending.current = false
    running.current = true
    setBusy(true)
    setError('')
    try {
      const conversation = await findConversation(listingId)
      if (mounted.current)
        await router.push(
          `/home?section=messages&destination=${conversation.role}&conversation=${conversation.id}`
        )
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error ? reason.message : 'Unable to contact seller.'
        )
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }
  useEffect(() => {
    if (seller && pending.current) contact()
    // contact intentionally captures this render's authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seller?.id, listingId])
  return { contact, busy, error }
}

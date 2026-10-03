import { useEffect, useState } from 'react'

import {
  usernameTakenMessage,
  usernameReservedMessage,
  reservedUsername,
  validUsername,
} from '@/lib/auth-username'
import { marketplaceRequest } from '@/lib/listings-api'

export function useUsernameAvailability(username: string, enabled: boolean) {
  const [result, setResult] = useState<{
    value: string
    state: 'available' | 'checking' | 'error' | 'taken'
    message?: string
  }>({ value: '', state: 'checking' })
  useEffect(() => {
    if (!enabled || !validUsername(username) || reservedUsername(username))
      return undefined
    let cancelled = false
    setResult({ value: username, state: 'checking' })
    const timer = setTimeout(async () => {
      try {
        const response = await marketplaceRequest<{ available: boolean }>(
          `/api/auth/username-availability?username=${encodeURIComponent(
            username
          )}`,
          'GET'
        )
        if (!cancelled)
          setResult({
            value: username,
            state: response.available ? 'available' : 'taken',
            message: response.available
              ? 'Username is available.'
              : usernameTakenMessage,
          })
      } catch {
        if (!cancelled)
          setResult({
            value: username,
            state: 'error',
            message: 'Unable to check username. Please try again.',
          })
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username, enabled])
  if (!validUsername(username))
    return { state: 'invalid' as const, message: undefined }
  if (reservedUsername(username))
    return { state: 'invalid' as const, message: usernameReservedMessage }
  if (result.value !== username)
    return { state: 'checking' as const, message: 'Checking username…' }
  return {
    state: result.state,
    message:
      result.state === 'checking' ? 'Checking username…' : result.message,
  }
}

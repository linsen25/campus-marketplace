export type PasswordChangeResult = {
  passwordUpdated: boolean | null
  otherSessionsRevoked: boolean
  error?: string
}

// A lost response must not prompt another password write: it may already have
// committed. Known API rejections remain safely retryable in the existing dialog.
export async function requestPasswordChange(input: {
  currentPassword: string
  password: string
  confirmation: string
}): Promise<PasswordChangeResult> {
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      body: JSON.stringify(input),
    })
    const result = await response.json()
    if (
      !response.ok &&
      (response.status < 500 || result?.passwordUpdated === false) &&
      typeof result?.error === 'string'
    )
      return {
        passwordUpdated: false,
        otherSessionsRevoked: false,
        error: result.error,
      }
    if (
      response.ok &&
      [true, false, null].includes(result?.passwordUpdated) &&
      typeof result.otherSessionsRevoked === 'boolean'
    )
      return result
  } catch {
    // Never expose response bodies, passwords or transport internals.
  }
  return {
    passwordUpdated: null,
    otherSessionsRevoked: false,
    error:
      'Unable to confirm whether your password changed. Do not submit again; check by signing in or use password recovery.',
  }
}

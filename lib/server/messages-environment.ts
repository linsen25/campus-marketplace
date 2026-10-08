import { ListingApiError } from '@/lib/listing-validation'

const messagesProjects: Record<string, string> = {
  staging: 'pcaqxezdfxofysghssyo',
  production: 'yzvchumzyonegujucyqs',
}
export function requireMessagesEnvironment() {
  const designation = process.env.APP_ENV || ''
  const ref = Object.prototype.hasOwnProperty.call(
    messagesProjects,
    designation
  )
    ? messagesProjects[designation]
    : undefined
  let valid = false
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    if (!publicKey && key.split('.').length === 3) {
      const claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString()
      )
      publicKey = claims.role === 'anon' && claims.ref === ref
    }
    valid = Boolean(
      ref &&
        url.origin === `https://${ref}.supabase.co` &&
        url.pathname === '/' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        publicKey
    )
  } catch {
    valid = false
  }
  if (!valid || !ref)
    throw new ListingApiError(
      'Messages environment configuration is unavailable.',
      503
    )
  return ref
}
export function messageUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new ListingApiError('A valid UUID is required.')
  return value
}

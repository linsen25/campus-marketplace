// @ts-ignore -- Deno resolves the pinned npm-compatible URL at Edge runtime.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

declare const Deno: {
  env: { get: (name: string) => string | undefined }
  serve: (handler: (request: Request) => Promise<Response>) => void
}

const templates = {
  signup: '0fc1b618-3f90-4914-832e-eda2e8817886',
  recovery: '81b22b0f-1c58-4ab2-a0c6-ba313fe2aa34',
} as const

type EmailData = {
  token?: unknown
  token_hash?: unknown
  redirect_to?: unknown
  email_action_type?: unknown
}
type HookEvent = { user?: { email?: unknown }; email_data?: EmailData }

type FailureCode =
  | 'CONFIG_UNAVAILABLE'
  | 'INVALID_METHOD'
  | 'SIGNATURE_INVALID'
  | 'MISSING_EMAIL'
  | 'MISSING_ACTION'
  | 'TEST_RECIPIENT_BLOCKED'
  | 'TOKEN_NOT_STRING'
  | 'TOKEN_NON_NUMERIC'
  | 'TOKEN_LENGTH_UNSUPPORTED'
  | 'INVALID_RECOVERY_PAYLOAD'
  | 'UNSUPPORTED_ACTION'
  | 'PROVIDER_UNAVAILABLE'

const reply = (status: number, code?: FailureCode) => {
  // Fixed codes are safe operational diagnostics. Never log request data.
  if (code) console.info(code)
  return new Response(
    status === 200 ? '{}' : JSON.stringify({ error: 'Email delivery unavailable.', code }),
    {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  )
}

function secret() {
  const value = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
  return value.replace(/^v1,whsec_/, '')
}
function value(input: unknown, limit: number) {
  return typeof input === 'string' && input.length > 0 && input.length <= limit
    ? input
    : null
}
function signupToken(input: unknown): { token: string } | { code: FailureCode } {
  if (typeof input !== 'string') return { code: 'TOKEN_NOT_STRING' }
  if (!/^\d+$/.test(input)) return { code: 'TOKEN_NON_NUMERIC' }
  // Match the application's 6–10 digit Auth OTP contract. Do not coerce, pad,
  // or otherwise accept a value that Supabase will not verify authoritatively.
  if (input.length < 6 || input.length > 10) return { code: 'TOKEN_LENGTH_UNSUPPORTED' }
  return { token: input }
}
function resetUrl(data: EmailData) {
  const tokenHash = value(data.token_hash, 2048)
  const redirect = value(data.redirect_to, 2048)
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!tokenHash || !redirect || !/^https:\/\/uqhyjpjiznpgomuizfqe\.supabase\.co$/.test(url))
    return null
  const target = new URL(`${url}/auth/v1/verify`)
  target.searchParams.set('token', tokenHash)
  target.searchParams.set('type', 'recovery')
  target.searchParams.set('redirect_to', redirect)
  return target.toString()
}
async function idempotencyKey(action: string, email: string, data: EmailData) {
  const source = `${action}\n${email}\n${value(data.token_hash, 2048) || ''}`
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `uu-auth/${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, 'INVALID_METHOD')
  const hookSecret = secret()
  const apiKey = Deno.env.get('RESEND_API_KEY') || ''
  const from = Deno.env.get('AUTH_EMAIL_FROM') || ''
  if (!hookSecret || !apiKey || !from) return reply(503, 'CONFIG_UNAVAILABLE')

  let event: HookEvent
  try {
    const raw = await request.text()
    event = new Webhook(hookSecret).verify(
      raw,
      Object.fromEntries(request.headers)
    ) as HookEvent
  } catch {
    // Do not log signed payloads, tokens, recipients, provider keys, or errors.
    return reply(401, 'SIGNATURE_INVALID')
  }

  try {
    const email = value(event.user?.email, 320)
    const action = value(event.email_data?.email_action_type, 80)
    const data = event.email_data || {}
    if (!email) return reply(400, 'MISSING_EMAIL')
    if (!action) return reply(400, 'MISSING_ACTION')

    const testRecipient = Deno.env.get('RESEND_TEST_RECIPIENT') || ''
    if (/@resend\.dev(?:>|$)/i.test(from) && email !== testRecipient)
      return reply(503, 'TEST_RECIPIENT_BLOCKED')

    let templateId: string
    let variables: Record<string, string>
    if (action === 'signup') {
      const result = signupToken(data.token)
      if ('code' in result) return reply(400, result.code)
      templateId = templates.signup
      variables = { OTP_CODE: result.token, EXPIRY_TEXT: '1 hour' }
    } else if (action === 'recovery') {
      const url = resetUrl(data)
      if (!url) return reply(400, 'INVALID_RECOVERY_PAYLOAD')
      templateId = templates.recovery
      variables = { RESET_URL: url, EXPIRY_TEXT: '1 hour' }
    } else {
      // Email-change has two recipients/tokens. It must get a reviewed, separate
      // template and mapping rather than receiving a signup or recovery template.
      return reply(400, 'UNSUPPORTED_ACTION')
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': await idempotencyKey(action, email, data),
      },
      body: JSON.stringify({
        from,
        to: [email],
        template: { id: templateId, variables },
      }),
    })
    if (!response.ok) return reply(503, 'PROVIDER_UNAVAILABLE')
    return reply(200)
  } catch {
    // Do not log signed payloads, tokens, recipients, provider keys, or errors.
    return reply(503, 'PROVIDER_UNAVAILABLE')
  }
})
